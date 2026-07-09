import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pill, initials, avatarFor } from '../lib/ui'
import { Pad, ErrorCard, Loading, Empty, Chip, PagerBar } from '../components/View'
import CampaignForm from '../components/CampaignForm'
import SidePanel, { PanelHeader } from '../components/SidePanel'

const STATUS_PILL = {
  new: pill('#E9F0EF', '#2F6E5E'),
  contacted: pill('#FBEAD9', '#C28A2A'),
  registered: pill('#EAF2E5', '#4E7C3F'),
  active: pill('#EAF2E5', '#4E7C3F'),
  done: pill('#F1EADD', '#8C7E6B'),
  dropped: pill('#FBE6E0', '#B5532F'),
}
const SEG_PILL = {
  volunteering: pill('#F6E8D8', '#C2691F'),
  advanced: pill('#F3E3D2', '#9C4A14'),
}
// Derived segments (filter combinations over real fields), not hardcoded categories.
const TABS = [
  { key: 'all', label: 'All' },
  { key: 'volunteering', label: 'Volunteering Interest' },
  { key: 'advanced', label: 'Advanced Program Interest' },
  { key: 'events', label: 'Event Interests' },
]
const CONVERT = { volunteer_profiles: 'active', ie_completion_volunteer: 'active', advanced_interest: 'registered' }
const stepOf = (s) => (['new', null, undefined].includes(s) ? 0 : s === 'contacted' ? 1 : 2)
const normPhone = (p) => (p || '').replace(/\D/g, '').slice(-10)
const normName = (n) => (n || '').toLowerCase().replace(/\s+/g, ' ').trim()
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null)

function ago(d) {
  if (!d) return '—'
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
const waNum = (p) => (p || '').replace(/\D/g, '').replace(/^0+/, '').slice(-10)
const VP_SEL = 'person_id, status, interests, interest_source, interest_date, preferred_timing, screening_notes, person:people!volunteer_profiles_person_id_fkey(id, full_name, phone)'
const IE_SEL = 'id, full_name, phone, ie_date, program_name, status, source, notes'
const mapVp = (v) => ({ key: 'vp:' + v.person_id, kind: 'volunteering', table: 'volunteer_profiles', id: v.person_id, idCol: 'person_id', personId: v.person_id, name: v.person?.full_name || 'Unknown', phone: v.person?.phone || '', status: v.status || 'new', ieo: false, tags: [], availability: v.preferred_timing || '—', activity: (v.interests || []).join(', ') || '—', activityList: v.interests || [], notes: v.screening_notes, src: v.interest_source, date: v.interest_date, origin: { label: v.interest_source || 'Volunteering form', date: v.interest_date, verb: 'submitted' } })
const mapIe = (r) => ({ key: 'ie:' + r.id, kind: 'volunteering', table: 'ie_completion_volunteer', id: r.id, idCol: 'id', personId: null, name: r.full_name || 'Unknown', phone: r.phone || '', status: r.status || 'new', ieo: true, tags: ['IEO'], availability: '—', activity: r.program_name || 'Inner Engineering Online', activityList: [], notes: r.notes, src: r.source, date: r.ie_date, origin: { label: r.program_name || 'Inner Engineering Online', date: r.ie_date, verb: 'completed' } })

export default function Interest({ onToast, eventScopeId = null, onScopeConsumed }) {
  const [advItems, setAdvItems] = useState([]) // advanced grouped-by-person (small, bounded)
  const [vpCount, setVpCount] = useState(0)
  const [ieCount, setIeCount] = useState(0)
  const [eiCount, setEiCount] = useState(0) // event_interest rows — drives the Event Interests tab badge
  const [pageItems, setPageItems] = useState([]) // current page (server-side window)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [ready, setReady] = useState(false)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [tab, setTab] = useState('all')
  const [ieoOnly, setIeoOnly] = useState(false)
  const [selItem, setSelItem] = useState(null)
  const [newTag, setNewTag] = useState('')
  const [busy, setBusy] = useState(false)
  const [uid, setUid] = useState(null)
  const [nurturers, setNurturers] = useState([])
  const [nurSel, setNurSel] = useState('')
  const [campaignPid, setCampaignPid] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)

  // Arriving from an event hub → jump to the Event Interests tab, scoped to it.
  useEffect(() => { if (eventScopeId) setTab('events') }, [eventScopeId])

  const loadStatic = useCallback(async () => {
    try {
      const [advRes, vpc, iec, eic] = await Promise.all([
        supabase.from('advanced_interest').select('id, program, status, interest_date, source, notes, person:people!advanced_interest_person_id_fkey(id, full_name, phone)').order('interest_date', { ascending: false }).limit(2000),
        supabase.from('volunteer_profiles').select('person_id', { count: 'exact', head: true }).eq('status', 'new'),
        supabase.from('ie_completion_volunteer').select('id', { count: 'exact', head: true }),
        supabase.from('event_interest').select('id', { count: 'exact', head: true }),
      ])
      if (advRes.error) throw advRes.error
      const byPerson = {}
      for (const a of advRes.data || []) {
        const pid = a.person?.id || 'x:' + a.id
        const g = (byPerson[pid] ||= { key: 'adv:' + pid, kind: 'advanced', personId: a.person?.id || null, name: a.person?.full_name || 'Unknown', phone: a.person?.phone || '', src: a.source, date: a.interest_date, programmes: [], origin: { label: a.source || 'Advance programme', date: a.interest_date, verb: 'submitted' } })
        g.programmes.push({ id: a.id, program: a.program, status: a.status || 'new', date: a.interest_date, source: a.source, notes: a.notes })
        if (new Date(a.interest_date) > new Date(g.date)) { g.date = a.interest_date; g.origin.date = a.interest_date }
      }
      setAdvItems(Object.values(byPerson))
      setVpCount(vpc.count || 0)
      setIeCount(iec.count || 0)
      setEiCount(eic.count || 0)
      setReady(true)
    } catch (e) { setErr(e.message || String(e)) }
  }, [])

  useEffect(() => {
    loadStatic()
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id || null))
    supabase.from('nurturers').select('id, full_name').order('full_name').then(({ data }) => setNurturers(data || []))
  }, [loadStatic])

  useEffect(() => { setPage(0) }, [tab, ieoOnly, pageSize])

  // Ordered sources for the active tab; each is server-side range-fetched.
  const sources = useMemo(() => {
    const vpSrc = { count: vpCount, fetch: async (off, lim) => { const { data } = await supabase.from('volunteer_profiles').select(VP_SEL).eq('status', 'new').order('interest_date', { ascending: false }).range(off, off + lim - 1); return (data || []).map(mapVp) } }
    const ieSrc = { count: ieCount, fetch: async (off, lim) => { const { data } = await supabase.from('ie_completion_volunteer').select(IE_SEL).order('ie_date', { ascending: false, nullsFirst: false }).range(off, off + lim - 1); return (data || []).map(mapIe) } }
    const advSrc = { count: advItems.length, fetch: async (off, lim) => advItems.slice(off, off + lim) }
    if (tab === 'advanced') return [advSrc]
    if (ieoOnly) return [ieSrc]
    if (tab === 'volunteering') return [vpSrc, ieSrc]
    return [vpSrc, ieSrc, advSrc]
  }, [tab, ieoOnly, vpCount, ieCount, advItems])

  const total = sources.reduce((s, x) => s + x.count, 0)
  const counts = { all: vpCount + ieCount + advItems.length, volunteering: vpCount + ieCount, advanced: advItems.length, events: eiCount }
  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  useEffect(() => {
    if (!ready) return
    let alive = true
    ;(async () => {
      setLoading(true)
      const out = []
      let base = 0, remaining = pageSize, cursor = page * pageSize
      for (const s of sources) {
        const end = base + s.count
        if (remaining > 0 && cursor >= base && cursor < end) {
          const take = Math.min(remaining, end - cursor)
          const items = await s.fetch(cursor - base, take)
          out.push(...items); cursor += take; remaining -= take
        }
        base = end
      }
      if (alive) { setPageItems(out); setLoading(false) }
    })()
    return () => { alive = false }
  }, [ready, sources, page, pageSize])

  const shown = pageItems
  const sel = selItem

  const patchVol = (key, fields) => {
    setPageItems((prev) => prev.map((x) => (x.key === key ? { ...x, ...fields } : x)))
    setSelItem((s) => (s && s.key === key ? { ...s, ...fields } : s))
  }
  const patchAdvProg = (advKey, progId, fields) => {
    const upd = (g) => (g.key === advKey ? { ...g, programmes: g.programmes.map((p) => (p.id === progId ? { ...p, ...fields } : p)) } : g)
    setAdvItems((prev) => prev.map(upd))
    setPageItems((prev) => prev.map(upd))
    setSelItem((s) => (s && s.key === advKey ? upd(s) : s))
  }
  async function addTag() {
    const tag = newTag.trim()
    if (!tag || !sel) return
    setBusy(true)
    try {
      const pid = await ensurePerson(sel)
      const { error } = await supabase.from('manual_tags').insert({ person_id: pid, tag })
      if (error) throw error
      setNewTag(''); onToast(`Tag "${tag}" added to ${sel.name}.`)
    } catch (e) { onToast((e.message || '').includes('duplicate') ? 'Tag already exists.' : 'Could not add tag: ' + (e.message || e)) } finally { setBusy(false) }
  }

  async function ensurePerson(it) {
    if (it.personId) return it.personId
    const phone = normPhone(it.phone)
    if (phone) {
      const { data } = await supabase.from('people').select('id').eq('phone', phone).maybeSingle()
      if (data) { patchVol(it.key, { personId: data.id }); return data.id }
    }
    const { data, error } = await supabase.from('people').insert({ full_name: it.name, phone: phone || null }).select('id').single()
    if (error) throw error
    patchVol(it.key, { personId: data.id })
    return data.id
  }

  async function setVolStep(idx) {
    const status = idx === 0 ? 'new' : idx === 1 ? 'contacted' : CONVERT[sel.table]
    setBusy(true)
    try {
      const { error } = await supabase.from(sel.table).update({ status }).eq(sel.idCol, sel.id)
      if (error) throw error
      patchVol(sel.key, { status })
      onToast(`${sel.name} → ${['New', 'Reached out', 'Converted'][idx]}.`)
    } catch (e) { onToast('Could not update: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function setAdvStep(prog, idx) {
    const status = idx === 0 ? 'new' : idx === 1 ? 'contacted' : 'registered'
    setBusy(true)
    try {
      const { error } = await supabase.from('advanced_interest').update({ status }).eq('id', prog.id)
      if (error) throw error
      patchAdvProg(sel.key, prog.id, { status })
      onToast(`${sel.name} · ${prog.program.toUpperCase()} → ${['New', 'Reached out', 'Registered'][idx]}.`)
    } catch (e) { onToast('Could not update: ' + (e.message || e)) } finally { setBusy(false) }
  }

  async function logContact() {
    setBusy(true)
    try {
      const pid = await ensurePerson(sel)
      let jid
      const { data: ex } = await supabase.from('journeys').select('id').eq('person_id', pid).order('created_at', { ascending: false }).limit(1)
      if (ex && ex.length) jid = ex[0].id
      else { const { data: nj, error } = await supabase.from('journeys').insert({ person_id: pid, type: 'volunteer_nurture', status: 'active' }).select('id').single(); if (error) throw error; jid = nj.id }
      const { error } = await supabase.from('call_logs').insert({ journey_id: jid, person_id: pid, reachability: 'answered', remarks: 'Logged from Interest inbox', logged_by: uid })
      if (error) throw error
      onToast(`Contact with ${sel.name} logged.`)
    } catch (e) { onToast('Could not log: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function convertVolunteer() {
    setBusy(true)
    try {
      const pid = await ensurePerson(sel)
      let e = (await supabase.from('people').update({ is_volunteer: true }).eq('id', pid)).error; if (e) throw e
      // Carry preferred activity over as skills (wireframe), without clobbering existing.
      const payload = { person_id: pid, status: 'active', interest_source: sel.ieo ? 'ieo' : 'interest_inbox' }
      if (sel.activityList && sel.activityList.length) payload.interests = sel.activityList
      e = (await supabase.from('volunteer_profiles').upsert(payload, { onConflict: 'person_id' })).error; if (e) throw e
      if (sel.table !== 'volunteer_profiles') await supabase.from(sel.table).update({ status: 'active' }).eq(sel.idCol, sel.id)
      patchVol(sel.key, { status: 'active' })
      onToast(`${sel.name} converted to volunteer.`)
    } catch (e) { onToast('Could not convert: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function markMeditator() {
    setBusy(true)
    try { const pid = await ensurePerson(sel); const { error } = await supabase.from('people').update({ is_meditator: true }).eq('id', pid); if (error) throw error; onToast(`${sel.name} marked as a meditator.`) }
    catch (e) { onToast('Could not mark: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function assignNurturer() {
    if (!nurSel) return onToast('Pick a nurturer first.')
    setBusy(true)
    try { const pid = await ensurePerson(sel); const { error } = await supabase.from('nurturer_assignments').insert({ meditator_id: pid, nurturer_id: nurSel, assigned_by: uid }); if (error) throw error; onToast(`${sel.name} assigned to ${nurturers.find((n) => n.id === nurSel)?.full_name}.`); setNurSel('') }
    catch (e) { onToast('Could not assign: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function addToCallList() {
    setBusy(true)
    try { const pid = await ensurePerson(sel); setCampaignPid(pid) } catch (e) { onToast('Could not prepare: ' + (e.message || e)) } finally { setBusy(false) }
  }

  function exportCsv() {
    const header = ['Name', 'Phone', 'Segment', 'Detail', 'Status']
    const rows = shown.map((it) => it.kind === 'advanced'
      ? [it.name, it.phone, 'Advanced Program', it.programmes.map((p) => p.program).join('|'), it.programmes.map((p) => p.status).join('|')]
      : [it.name, it.phone, 'Volunteering' + (it.ieo ? ' (IEO)' : ''), it.activity, it.status])
    const csv = [header, ...rows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = `interest-${tab}.csv`; a.click(); URL.revokeObjectURL(a.href)
    onToast(`Exported ${shown.length} rows.`)
  }

  const btn = { padding: '9px 13px', fontSize: 12.5 }

  return (
    <Pad>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          {TABS.map((t) => (<Chip key={t.key} on={tab === t.key} label={t.label} count={counts[t.key] || 0} onClick={() => setTab(t.key)} />))}
          {tab !== 'advanced' && tab !== 'events' && (
            <button onClick={() => setIeoOnly((v) => !v)} className="btn" style={{ padding: '6px 11px', fontSize: 12, borderRadius: 20, background: ieoOnly ? '#2F6E5E' : '#fff', color: ieoOnly ? '#fff' : 'var(--ink-soft)', border: ieoOnly ? 'none' : '1px solid var(--border)' }}>IEO only</button>
          )}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" style={btn} onClick={() => setScanOpen(true)}>Scan / match form</button>
          <button className="btn btn-ghost" style={btn} onClick={() => setAddOpen(true)}>Add / import</button>
          <button className="btn btn-ghost" style={btn} onClick={exportCsv}>Export</button>
        </div>
      </div>
      {err && <ErrorCard>Couldn't load interest inbox: {err}</ErrorCard>}

      {tab === 'events' ? <EventInterests onToast={onToast} scopeEventId={eventScopeId} onScopeConsumed={onScopeConsumed} /> : (
      <div className="card" style={{ overflow: 'hidden' }}>
          {loading && <Loading label="Loading interest inbox…" />}
          {!loading && shown.length === 0 && <Empty label="Nothing to triage here." />}
          {shown.map((it, i) => (
            <div key={it.key} className="rowhover" onClick={() => setSelItem(it)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', borderBottom: '1px solid #F1E9DB', cursor: 'pointer', background: it.key === selItem?.key ? '#FBF1E6' : 'transparent' }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(it.name)}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.name}</div>
                <div style={{ fontSize: 11.5, color: it.phone ? 'var(--muted)' : '#B5532F' }}>{it.phone || 'No phone on record'}</div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 3, flexWrap: 'wrap' }}>
                  <span className="pill" style={SEG_PILL[it.kind]}>{it.kind === 'advanced' ? 'Advanced' : 'Volunteering'}</span>
                  {it.ieo && <span className="pill" style={pill('#E9F0EF', '#2F6E5E')}>IEO</span>}
                  {it.kind === 'advanced'
                    ? it.programmes.map((p) => <span key={p.id} className="pill" style={pill('#F3E3D2', '#9C4A14')}>{p.program.toUpperCase()}</span>)
                    : <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{ago(it.date)}</span>}
                </div>
              </div>
              {it.kind === 'volunteering' && <span className="pill" style={STATUS_PILL[it.status] || STATUS_PILL.new}>{it.status}</span>}
            </div>
          ))}
          {!loading && total > 0 && <PagerBar page={page} pageCount={pageCount} total={total} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />}
        </div>
      )}

      {sel && (
        <SidePanel onClose={() => setSelItem(null)}>
          <PanelHeader onClose={() => setSelItem(null)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
                  <div style={{ width: 48, height: 48, borderRadius: '50%', background: avatarFor(2), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 600 }}>{initials(sel.name)}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 3px' }}>{sel.name}</h2>
                    <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{sel.kind === 'advanced' ? `${sel.programmes.length} programme(s)` : sel.activity} · via {sel.src || 'unknown'}</div>
                  </div>
                  <span className="pill" style={SEG_PILL[sel.kind]}>{sel.kind === 'advanced' ? 'Advanced' : 'Volunteering'}</span>
                  {sel.ieo && <span className="pill" style={pill('#E9F0EF', '#2F6E5E')}>IEO</span>}
                </div>
          </PanelHeader>
          <div style={{ padding: '20px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {sel.origin && (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginTop: 14, background: '#FBF6EC', border: '1px dashed var(--border)', borderRadius: 9, padding: '10px 13px' }}>
                    <div style={{ width: 26, height: 26, borderRadius: 6, background: '#F3E3D2', color: '#9C4A14', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21c4-2.5 7-6 7-10a7 7 0 0 0-14 0c0 4 3 7.5 7 10Z" /></svg>
                    </div>
                    <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
                      <strong style={{ color: 'var(--ink)' }}>From:</strong> {sel.origin.label}
                      {fmtDate(sel.origin.date) ? ` · ${sel.origin.verb} ${fmtDate(sel.origin.date)}` : ''}
                    </div>
                  </div>
                )}

              {sel.kind === 'volunteering' ? (
                <>
                  <div className="card" style={{ padding: 20 }}>
                    <SecH>Form responses</SecH>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '14px 22px' }}>
                      <F label="Phone" value={sel.phone || 'No phone on record'} />
                      <F label="Availability" value={sel.availability} />
                      <F label="Preferred activity" value={sel.activity} />
                      <F label="Origin" value={sel.ieo ? 'IEO (Inner Engineering Online)' : sel.src || '—'} />
                      <div style={{ gridColumn: '1 / -1' }}><F label="Notes" value={sel.notes || '—'} /></div>
                    </div>
                  </div>
                  <div className="card" style={{ padding: '16px 20px' }}>
                    <SecH>Status</SecH>
                    <Stepper labels={['New', 'Reached out', 'Converted']} idx={stepOf(sel.status)} busy={busy} onStep={setVolStep} />
                  </div>
                </>
              ) : (
                <div className="card" style={{ padding: 20 }}>
                  <SecH>Programmes &amp; status</SecH>
                  <F label="Phone" value={sel.phone || 'No phone on record'} />
                  <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {sel.programmes.map((p) => (
                      <div key={p.id} style={{ paddingTop: 12, borderTop: '1px solid #F2EBDD' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>{p.program.toUpperCase()} <span style={{ fontWeight: 400, color: 'var(--muted)' }}>· added {ago(p.date)}</span></div>
                        <Stepper labels={['New', 'Reached out', 'Registered']} idx={stepOf(p.status)} busy={busy} onStep={(i) => setAdvStep(p, i)} />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="card" style={{ padding: 20 }}>
                <SecH>Actions</SecH>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                  <a className="btn btn-primary" href={sel.phone ? `tel:${sel.phone}` : undefined} style={{ ...btn, textDecoration: 'none', opacity: sel.phone ? 1 : 0.5, pointerEvents: sel.phone ? 'auto' : 'none' }}>Call</a>
                  <a className="btn btn-ghost" href={sel.phone ? `https://wa.me/91${waNum(sel.phone)}` : undefined} target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: 'none', opacity: sel.phone ? 1 : 0.5, pointerEvents: sel.phone ? 'auto' : 'none' }}>Message</a>
                  <button className="btn btn-ghost" style={btn} disabled={busy} onClick={logContact}>Log contact</button>
                  {sel.kind === 'advanced'
                    ? <button className="btn btn-ghost" style={btn} disabled={busy} onClick={markMeditator}>Mark → Meditators</button>
                    : <button className="btn btn-ghost" style={btn} disabled={busy} onClick={convertVolunteer}>Convert to volunteer</button>}
                  <button className="btn btn-ghost" style={btn} disabled={busy} onClick={addToCallList}>Add to call list</button>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <select value={nurSel} onChange={(e) => setNurSel(e.target.value)} style={{ flex: 1, padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12.5, fontFamily: 'inherit', background: '#fff' }}>
                    <option value="">Assign nurturer…</option>
                    {nurturers.map((n) => (<option key={n.id} value={n.id}>{n.full_name}</option>))}
                  </select>
                  <button className="btn btn-ghost" style={btn} disabled={busy || !nurSel} onClick={assignNurturer}>Assign</button>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <input value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()} placeholder="Add a tag…" style={{ flex: 1, padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', outline: 'none' }} />
                  <button className="btn btn-ghost" style={btn} disabled={busy} onClick={addTag}>Add tag</button>
                </div>
              </div>
          </div>
        </SidePanel>
      )}

      {campaignPid && <CampaignForm audience={sel?.kind === 'advanced' ? 'meditator' : 'volunteer'} personIds={[campaignPid]} segmentLabel={sel?.name || ''} onClose={() => setCampaignPid(null)} onToast={onToast} />}
      {addOpen && <AddImport onClose={() => setAddOpen(false)} onToast={onToast} onDone={() => { setAddOpen(false); loadStatic() }} />}
      {scanOpen && <ScanMatch onClose={() => setScanOpen(false)} onToast={onToast} onDone={() => { setScanOpen(false); loadStatic() }} />}
    </Pad>
  )
}

function F({ label, value }) {
  return (<div><div style={{ fontSize: 10.5, color: 'var(--muted-2)', marginBottom: 4 }}>{label}</div><div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', wordBreak: 'break-word' }}>{value}</div></div>)
}
function SecH({ children }) {
  return <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted-2)', marginBottom: 13 }}>{children}</div>
}
function Stepper({ labels, idx, busy, onStep }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {labels.map((label, i) => {
        const active = idx >= i
        return (
          <div key={label} style={{ display: 'contents' }}>
            {i > 0 && <div style={{ flex: 1, height: 2, background: active ? '#C2691F' : '#EFE7D8' }} />}
            <button disabled={busy} onClick={() => onStep(i)} style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 600, padding: '7px 13px', borderRadius: 9, background: active ? '#C2691F' : '#F1EADD', color: active ? '#fff' : '#8C7E6B' }}>{label}</button>
          </div>
        )
      })}
    </div>
  )
}

// --- Add / import: pick target SEGMENT; always resolve to a canonical people row by phone ---
async function ensurePersonId(name, phone) {
  const ph = normPhone(phone)
  if (ph) {
    const { data } = await supabase.from('people').select('id').eq('phone', ph).maybeSingle()
    if (data) return data.id
  }
  const { data, error } = await supabase.from('people').insert({ full_name: name, phone: ph || null }).select('id').single()
  if (error) throw error
  return data.id
}

export function AddImport({ onClose, onToast, onDone, lockEventId = null }) {
  const [mode, setMode] = useState('single')
  const [segment, setSegment] = useState(lockEventId ? 'event' : 'volunteering')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [program, setProgram] = useState('bsp')
  const [csv, setCsv] = useState('')
  const [events, setEvents] = useState([])
  const [eventId, setEventId] = useState(lockEventId || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // Load selectable events lazily when the Event target is chosen (skip when locked).
  useEffect(() => {
    if (lockEventId || segment !== 'event' || events.length) return
    supabase.from('activities').select('id, name, activity_date').is('archived_at', null).order('start_date', { ascending: false }).limit(200)
      .then(({ data }) => { setEvents(data || []); if (!eventId && data?.[0]) setEventId(data[0].id) })
  }, [segment, events.length, eventId, lockEventId])

  const parsed = useMemo(() => csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const [nm, ph, pg] = l.split(',').map((s) => (s || '').trim()); return { name: nm, phone: ph, program: pg } }).filter((r) => r.name), [csv])

  async function insertOne(row) {
    if (segment === 'event') {
      // Phone is the key — reject rows we can't resolve to a canonical person.
      if (!normPhone(row.phone)) throw new Error(`"${row.name}" has no valid 10-digit phone — event interest is phone-keyed.`)
      const pid = await ensurePersonId(row.name, row.phone)
      const { error } = await supabase.from('event_interest').upsert(
        { activity_id: eventId, person_id: pid, source: 'import' }, { onConflict: 'activity_id,person_id' })
      if (error) throw error
      return
    }
    const pid = await ensurePersonId(row.name, row.phone) // canonical people, no unlinked rows
    if (segment === 'volunteering') {
      const { error } = await supabase.from('volunteer_profiles').upsert({ person_id: pid, status: 'new', interest_source: 'manual' }, { onConflict: 'person_id' })
      if (error) throw error
    } else {
      const { error } = await supabase.from('advanced_interest').upsert({ person_id: pid, program: (row.program || program || 'bsp').toLowerCase(), status: 'new', source: 'manual' }, { onConflict: 'person_id,program' })
      if (error) throw error
    }
  }
  async function submit() {
    setBusy(true); setErr(null)
    try {
      if (segment === 'event' && !eventId) throw new Error('Pick an event.')
      const rows = mode === 'single' ? [{ name: name.trim(), phone, program }].filter((r) => r.name) : parsed
      if (!rows.length) throw new Error('Nothing to add.')
      for (const r of rows) await insertOne(r)
      const dest = segment === 'volunteering' ? 'Volunteering' : segment === 'advanced' ? 'Advanced Program' : `event “${events.find((e) => e.id === eventId)?.name || ''}”`
      onToast(`Added ${rows.length} to ${dest} interest.`)
      onDone()
    } catch (e) { setErr(e.message || String(e)) } finally { setBusy(false) }
  }

  const field = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13.5, fontFamily: 'inherit', background: '#fff', outline: 'none' }
  return (
    <Modal onClose={onClose} title="Add / import interest">
      {err && <ErrBox>{err}</ErrBox>}
      {lockEventId ? (
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>Adding volunteer interest to <strong>this event</strong> · phone-keyed, deduped.</div>
      ) : (
        <>
          <Lbl>Target segment</Lbl>
          <select value={segment} onChange={(e) => setSegment(e.target.value)} style={{ ...field, marginBottom: 14 }}>
            <option value="volunteering">Volunteering Interest</option>
            <option value="advanced">Advanced Program Interest</option>
            <option value="event">Event Interest</option>
          </select>
          {segment === 'event' && (
            <div style={{ marginBottom: 14 }}>
              <Lbl>Event</Lbl>
              <select value={eventId} onChange={(e) => setEventId(e.target.value)} style={field}>
                <option value="">— select an event —</option>
                {events.map((e) => <option key={e.id} value={e.id}>{e.name}{e.activity_date ? ` · ${e.activity_date}` : ''}</option>)}
              </select>
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>Phone-keyed to this event’s interest pool · deduped per person.</div>
            </div>
          )}
        </>
      )}
      <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
        {[{ k: 'single', l: 'Add one' }, { k: 'import', l: 'Import CSV' }].map((t) => (
          <button key={t.k} onClick={() => setMode(t.k)} className="btn" style={{ padding: '7px 12px', fontSize: 12.5, background: mode === t.k ? '#241B14' : '#fff', color: mode === t.k ? '#F6ECDC' : 'var(--ink-soft)', border: mode === t.k ? 'none' : '1px solid var(--border)' }}>{t.l}</button>
        ))}
      </div>
      {mode === 'single' ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name *" style={field} />
          <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (10-digit)" style={field} />
          {segment === 'advanced' && <input value={program} onChange={(e) => setProgram(e.target.value)} placeholder="Programme (bsp/shoonya/samyama)" style={field} />}
        </div>
      ) : (
        <div>
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={6} placeholder={'One per line: Name, Phone' + (segment === 'advanced' ? ', Programme' : '')} style={{ ...field, resize: 'vertical' }} />
          <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{parsed.length} row(s) ready · resolved to a people row by phone.</div>
        </div>
      )}
      <Actions onClose={onClose} busy={busy} onSubmit={submit} label={mode === 'single' ? 'Add entry' : `Import ${parsed.length}`} />
    </Modal>
  )
}

// --- #5 Scan / match form: typed input now (OCR wired later). Match by PHONE; name is confirmation only. ---
export function ScanMatch({ onClose, onToast, onDone, lockEventId = null }) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [segment, setSegment] = useState(lockEventId ? 'event' : 'volunteering')
  const [program, setProgram] = useState('bsp')
  const [events, setEvents] = useState([])
  const [eventId, setEventId] = useState(lockEventId || '')
  const [result, setResult] = useState(null) // {rule, person, outcome}
  const [busy, setBusy] = useState(false)
  const [ocrBusy, setOcrBusy] = useState(false)
  const [ocrErr, setOcrErr] = useState(null)

  useEffect(() => {
    if (lockEventId || segment !== 'event' || events.length) return
    supabase.from('activities').select('id, name, activity_date').is('archived_at', null).order('start_date', { ascending: false }).limit(200)
      .then(({ data }) => { setEvents(data || []); if (!eventId && data?.[0]) setEventId(data[0].id) })
  }, [segment, events.length, eventId, lockEventId])

  // Google Vision OCR via the ocr-form edge function (key stays server-side).
  async function onFile(e) {
    const file = e.target.files?.[0]
    if (!file) return
    setOcrErr(null)
    setOcrBusy(true)
    try {
      const b64 = await new Promise((res, rej) => {
        const r = new FileReader()
        r.onload = () => res(String(r.result).split(',')[1])
        r.onerror = rej
        r.readAsDataURL(file)
      })
      const { data, error } = await supabase.functions.invoke('ocr-form', { body: { image: b64 } })
      if (error) throw new Error(error.message || 'OCR request failed')
      if (data?.error) throw new Error(data.error)
      setResult(null)
      if (data?.name) setName(data.name)
      if (data?.phone) setPhone(data.phone)
      if (!data?.phone) setOcrErr('Read the form, but no phone detected — enter it manually.')
    } catch (err) {
      setOcrErr(err.message || String(err))
    } finally {
      setOcrBusy(false)
      e.target.value = ''
    }
  }

  async function runMatch() {
    setBusy(true); setResult(null)
    try {
      const ph = normPhone(phone)
      if (!ph) { setResult({ rule: 'no_phone', label: 'No phone read → manual review (cannot match without phone)', can: false }); return }
      const { data } = await supabase.from('people').select('id, full_name, phone').eq('phone', ph).maybeSingle()
      if (!data) { setResult({ rule: 'create', label: 'Phone has no existing match → create new person (after review)', person: null, can: true }); return }
      const consistent = normName(data.full_name) === normName(name) || (name && (normName(data.full_name).includes(normName(name)) || normName(name).includes(normName(data.full_name))))
      if (consistent) setResult({ rule: 'link', label: `Phone matches ${data.full_name} + name consistent → link`, person: data, can: true })
      else setResult({ rule: 'review', label: `Phone matches ${data.full_name} but name differs (“${name}”) → human review; will NOT auto-merge on name`, person: data, can: false, override: true })
    } finally { setBusy(false) }
  }

  async function confirm(forceLink) {
    setBusy(true)
    try {
      let pid = result.person?.id
      if (!pid) pid = await ensurePersonId(name, phone)
      if (segment === 'event') {
        if (!eventId) throw new Error('Pick an event.')
        const { error } = await supabase.from('event_interest').upsert({ activity_id: eventId, person_id: pid, source: 'import' }, { onConflict: 'activity_id,person_id' }); if (error) throw error
      } else if (segment === 'volunteering') {
        const { error } = await supabase.from('volunteer_profiles').upsert({ person_id: pid, status: 'new', interest_source: 'form' }, { onConflict: 'person_id' }); if (error) throw error
      } else {
        const { error } = await supabase.from('advanced_interest').upsert({ person_id: pid, program: program.toLowerCase(), status: 'new', source: 'form' }, { onConflict: 'person_id,program' }); if (error) throw error
      }
      const dest = segment === 'volunteering' ? 'Volunteering' : segment === 'advanced' ? 'Advanced' : `event “${events.find((e) => e.id === eventId)?.name || ''}”`
      onToast(`${name || result.person?.full_name} added to ${dest} interest${forceLink ? ' (reviewed link)' : ''}.`)
      onDone()
    } catch (e) { onToast('Could not save: ' + (e.message || e)) } finally { setBusy(false) }
  }

  const field = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, fontSize: 13.5, fontFamily: 'inherit', background: '#fff', outline: 'none' }
  const RC = { link: '#4E7C3F', create: '#C2691F', review: '#B5532F', no_phone: '#8C7E6B' }
  return (
    <Modal onClose={onClose} title="Scan / match form">
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12 }}>
        Scan a photo of the handed-out form (Google Vision reads name + phone), or type them. Matched by <strong>phone</strong>; name is a confirmation signal only — never a merge key.
      </div>
      <div style={{ marginBottom: 14 }}>
        <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
          {ocrBusy ? 'Reading form…' : '📷 Scan form photo'}
          <input type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
        </label>
        {ocrErr && <div style={{ fontSize: 12, color: '#B5532F', marginTop: 6 }}>{ocrErr}</div>}
      </div>
      {lockEventId ? (
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>Scanning into <strong>this event’s</strong> interest pool.</div>
      ) : (
        <>
          <Lbl>Target segment</Lbl>
          <select value={segment} onChange={(e) => setSegment(e.target.value)} style={{ ...field, marginBottom: 10 }}>
            <option value="volunteering">Volunteering Interest</option>
            <option value="advanced">Advanced Program Interest</option>
            <option value="event">Event Interest</option>
          </select>
          {segment === 'event' && (
            <select value={eventId} onChange={(e) => setEventId(e.target.value)} style={{ ...field, marginBottom: 10 }}>
              <option value="">— select an event —</option>
              {events.map((e) => <option key={e.id} value={e.id}>{e.name}{e.activity_date ? ` · ${e.activity_date}` : ''}</option>)}
            </select>
          )}
        </>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name (from form)" style={field} />
        <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (from form)" style={field} />
        {segment === 'advanced' && <input value={program} onChange={(e) => setProgram(e.target.value)} placeholder="Programme (bsp/shoonya/samyama)" style={field} />}
      </div>
      <div style={{ marginTop: 12 }}>
        <button className="btn btn-ghost" disabled={busy} onClick={runMatch}>Match by phone</button>
      </div>
      {result && (
        <div style={{ marginTop: 12, padding: '12px 14px', borderRadius: 10, background: '#FBF6EC', border: '1px solid var(--border)', borderLeft: `4px solid ${RC[result.rule]}` }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: RC[result.rule], marginBottom: result.can || result.override ? 10 : 0 }}>{result.label}</div>
          {result.can && <button className="btn btn-primary" disabled={busy} onClick={() => confirm(false)}>{result.rule === 'create' ? 'Create + add' : 'Link + add'}</button>}
          {result.override && <button className="btn btn-ghost" disabled={busy} onClick={() => confirm(true)} style={{ color: '#B5532F' }}>Override — link anyway (reviewed)</button>}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </Modal>
  )
}

function Modal({ title, children, onClose }) {
  return (
    <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 20 }} onClick={onClose}>
      <div className="card modal-sheet" style={{ width: 480, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ fontSize: 19, fontWeight: 600, margin: '0 0 14px' }}>{title}</h2>
        {children}
      </div>
    </div>
  )
}
function Lbl({ children }) { return <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted-2)', display: 'block', marginBottom: 6 }}>{children}</label> }
function ErrBox({ children }) { return <div style={{ background: '#FBE6E0', color: '#B5532F', padding: '10px 12px', borderRadius: 9, fontSize: 12.5, marginBottom: 12 }}>{children}</div> }
function Actions({ onClose, busy, onSubmit, label }) {
  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={busy} onClick={onSubmit}>{busy ? 'Saving…' : label}</button>
    </div>
  )
}

// Event Interests — form responses that carried an event_id, grouped per event
// (occurrence) and filterable by event. A read view over event_interest; standing
// (no-event) interest stays in the main inbox above.
function EventInterests({ onToast, scopeEventId = null, onScopeConsumed }) {
  const [rows, setRows] = useState(null)
  const [evFilter, setEvFilter] = useState('all')
  const [scopeName, setScopeName] = useState(null)
  useEffect(() => {
    supabase.from('event_interest')
      .select('id, created_at, activity:activities!event_interest_activity_id_fkey(id, name, activity_date), person:people!event_interest_person_id_fkey(id, full_name, phone)')
      .order('created_at', { ascending: false })
      .then(({ data }) => setRows(data || []))
  }, [])
  // Preset the filter to the event we arrived from (from the hub).
  useEffect(() => {
    if (scopeEventId) {
      setEvFilter(scopeEventId)
      supabase.from('activities').select('name').eq('id', scopeEventId).maybeSingle().then(({ data }) => setScopeName(data?.name || null))
      onScopeConsumed?.()
    }
  }, [scopeEventId, onScopeConsumed])

  if (!rows) return <Loading label="Loading event interests…" />

  const events = [...new Map(rows.map((r) => [r.activity?.id, r.activity])).values()].filter(Boolean)
  const shown = evFilter === 'all' ? rows : rows.filter((r) => r.activity?.id === evFilter)
  const byEvent = {}
  for (const r of shown) { const id = r.activity?.id || '?'; (byEvent[id] ||= { ev: r.activity, people: [] }).people.push(r) }

  return (
    <>
      <div style={{ marginBottom: 12 }}>
        <select value={evFilter} onChange={(e) => setEvFilter(e.target.value)} style={{ padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 13, background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer' }}>
          <option value="all">All events ({events.length})</option>
          {events.map((e) => <option key={e.id} value={e.id}>{e.name} · {fmtDate(e.activity_date)}</option>)}
        </select>
      </div>
      {shown.length === 0 && (
        <Empty label={evFilter === 'all' ? 'No event interest yet — import interest against an event or share its interest link.' : `No interests for ${scopeName || 'this event'} yet.`} />
      )}
      {Object.values(byEvent).map((g) => (
        <div key={g.ev?.id} className="card" style={{ padding: 16, marginBottom: 12 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>{g.ev?.name} <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 400 }}>· {fmtDate(g.ev?.activity_date)} · {g.people.length} interested</span></div>
          <div style={{ marginTop: 8 }}>
            {g.people.map((r, i) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #F4EEE2' }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 600, flexShrink: 0 }}>{initials(r.person?.full_name || '?')}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600 }}>{r.person?.full_name || 'Unknown'}</div>
                  <div style={{ fontSize: 11.5, color: r.person?.phone ? 'var(--muted)' : '#B5532F' }}>{r.person?.phone || 'no phone'} · {ago(r.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  )
}
