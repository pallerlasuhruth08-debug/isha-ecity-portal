import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { initials, avatarFor, pill } from '../lib/ui'
import { Loading, Empty } from './View'
import CampaignForm from './CampaignForm'
import SidePanel, { PanelHeader } from './SidePanel'

const REACH = [
  { key: 'answered', label: 'Answered' },
  { key: 'will_call_back', label: 'Will call back' },
  { key: 'not_reachable', label: 'Not reachable' },
]
const fmt = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null)
const waNum = (p) => (p || '').replace(/\D/g, '').replace(/^0+/, '').slice(-10)
const ageOf = (dob) => (dob ? Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 86400000)) : null)
const genderOf = (g) => (g == null || g === '' ? null : g === 'M' ? 'Male' : g === 'F' ? 'Female' : g)
const boolOf = (v) => (v == null ? null : v ? 'Yes' : 'No')

// Rich person detail (mirrors the AppSheet profile). All values from named
// queries; fields not yet synced from AppSheet render an explicit empty state.
export default function PersonProfile({ personId, onClose, onToast, onChanged }) {
  const [p, setP] = useState(null)
  const [vp, setVp] = useState(null)
  const [center, setCenter] = useState(null)
  const [nurturer, setNurturer] = useState(null)
  const [derived, setDerived] = useState([])
  const [manual, setManual] = useState([])
  const [events, setEvents] = useState([])
  const [calls, setCalls] = useState([])
  const [err, setErr] = useState(null)
  const [newTag, setNewTag] = useState('')
  const [showCampaign, setShowCampaign] = useState(false)
  const [logOpen, setLogOpen] = useState(false)
  const [outcome, setOutcome] = useState('answered')
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const [pr, vpr, ctr, nur, mt, att, jn] = await Promise.all([
        supabase.from('people').select('*').eq('id', personId).single(),
        supabase.from('volunteer_profiles').select('*').eq('person_id', personId).maybeSingle(),
        supabase.from('people').select('center:centers!people_center_id_fkey(name)').eq('id', personId).maybeSingle(),
        supabase.from('nurturer_assignments').select('nurturer:nurturers!nurturer_assignments_nurturer_id_fkey(full_name)').eq('meditator_id', personId).limit(1),
        supabase.from('manual_tags').select('id, tag').eq('person_id', personId).order('created_at', { ascending: false }),
        supabase.from('attendance').select('time_in, activity_type_id, activities!attendance_activity_id_fkey(name, activity_date), atype:activity_types(label, kind)').eq('person_id', personId),
        supabase.from('journeys').select('type, campaign:campaigns(is_test), calls(reachability, sadhana_status, remarks, completed_at)').eq('person_id', personId),
      ])
      if (pr.error) throw pr.error
      setP(pr.data)
      setVp(vpr.data || null)
      setCenter(ctr.data?.center?.name || null)
      setNurturer(nur.data?.[0]?.nurturer?.full_name || null)
      setManual(mt.data || [])
      const evs = (att.data || [])
        .map((a) => ({ name: a.activities?.name, type: a.atype?.label || null, kind: a.atype?.kind || null, date: a.activities?.activity_date || a.time_in }))
        .sort((x, y) => new Date(y.date || 0) - new Date(x.date || 0))
      setEvents(evs)
      const types = new Set()
      for (const a of att.data || []) { const t = a.atype?.label; if (t) types.add(t) }
      setDerived([...types])
      const cs = []
      // Skip test-campaign calls — test contact never reads as real contact.
      for (const j of jn.data || []) { if (j.campaign?.is_test) continue; for (const c of j.calls || []) if (c.completed_at || c.remarks || c.reachability) cs.push(c) }
      cs.sort((a, b) => new Date(b.completed_at || 0) - new Date(a.completed_at || 0))
      setCalls(cs)
    } catch (e) { setErr(e.message || String(e)) }
  }, [personId])

  useEffect(() => { load() }, [load])

  async function addTag() {
    const tag = newTag.trim(); if (!tag) return
    setNewTag('')
    const { data, error } = await supabase.from('manual_tags').insert({ person_id: personId, tag }).select('id, tag').single()
    if (error) return onToast(error.message.includes('duplicate') ? 'Tag already exists.' : 'Could not add tag.')
    setManual((m) => [data, ...m]); onChanged && onChanged()
  }
  async function removeTag(id) {
    setManual((m) => m.filter((x) => x.id !== id))
    const { error } = await supabase.from('manual_tags').delete().eq('id', id)
    if (error) { onToast('Could not remove tag'); load() } else onChanged && onChanged()
  }
  async function applyTag(tag) {
    const { data, error } = await supabase.from('manual_tags').insert({ person_id: personId, tag }).select('id, tag').single()
    if (error) return onToast(error.message.includes('duplicate') ? 'Tag already exists.' : 'Could not apply tag.')
    setManual((m) => [data, ...m]); onToast(`Applied “${tag}” tag.`); onChanged && onChanged()
  }
  async function addAsVolunteer() {
    setBusy(true)
    try {
      let e = (await supabase.from('people').update({ is_volunteer: true }).eq('id', personId)).error; if (e) throw e
      e = (await supabase.from('volunteer_profiles').upsert({ person_id: personId, status: 'active', interest_source: 'profile' }, { onConflict: 'person_id' })).error; if (e) throw e
      setP((x) => ({ ...x, is_volunteer: true })); onToast(`${p.full_name} added as volunteer.`); onChanged && onChanged()
    } catch (e) { onToast('Could not add as volunteer: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function addAsMeditator() {
    setBusy(true)
    try { const { error } = await supabase.from('people').update({ is_meditator: true }).eq('id', personId); if (error) throw error; setP((x) => ({ ...x, is_meditator: true })); onToast(`${p.full_name} added as meditator.`); onChanged && onChanged() }
    catch (e) { onToast('Could not add as meditator: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function saveLog() {
    setBusy(true)
    try {
      let jid
      const { data: ex } = await supabase.from('journeys').select('id').eq('person_id', personId).order('created_at', { ascending: false }).limit(1)
      if (ex && ex.length) jid = ex[0].id
      else { const { data: nj, error } = await supabase.from('journeys').insert({ person_id: personId, type: 'volunteer_nurture', status: 'active' }).select('id').single(); if (error) throw error; jid = nj.id }
      const { error } = await supabase.from('call_logs').insert({ journey_id: jid, person_id: personId, reachability: outcome, remarks: remarks || null })
      if (error) throw error
      onToast(`Contact with ${p.full_name} logged.`); setLogOpen(false); setRemarks(''); load()
    } catch (e) { onToast('Could not log: ' + (e.message || e)) } finally { setBusy(false) }
  }

  const hasPhone = !!p?.phone
  const wa = p && hasPhone ? `https://wa.me/91${waNum(p.phone)}` : undefined
  const progTags = p?.tags || []

  // Seva-tag rule (STATED, not silent auto-tagging): attending 3+ events of the SAME
  // activity type (the shared activity_types vocabulary) suggests that type as a tag;
  // a coordinator applies it explicitly below. No hardcoded map — the type IS the tag.
  const SEVA_THRESHOLD = 3
  const sevaCounts = {}
  for (const e of events) { const g = e.type; if (g) sevaCounts[g] = (sevaCounts[g] || 0) + 1 }
  const sevaSuggestions = Object.entries(sevaCounts).filter(([label, n]) => n >= SEVA_THRESHOLD && !manual.some((m) => m.tag === label))

  return (
    <SidePanel onClose={onClose}>
      <PanelHeader onClose={onClose}>
        {err && <div style={{ color: '#B5532F', fontSize: 13 }}>{err}</div>}
        {!p && !err && <Loading label="Loading profile…" />}
        {p && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 52, height: 52, borderRadius: '50%', background: avatarFor(1), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 600, overflow: 'hidden' }}>
              {p.photo_url ? <img src={p.photo_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initials(p.full_name)}
            </div>
            <div style={{ minWidth: 0, flex: 1 }}>
              <h2 style={{ fontSize: 21, fontWeight: 600, margin: '0 0 2px' }}>{p.full_name}</h2>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{[p.city, p.pincode].filter(Boolean).join(' · ') || center}</div>
            </div>
            <div style={{ display: 'flex', gap: 5 }}>
              {p.is_volunteer && <span className="pill" style={pill('#F6E8D8', '#C2691F')}>Volunteer</span>}
              {p.is_meditator && <span className="pill" style={pill('#F3E3D2', '#9C4A14')}>Meditator</span>}
            </div>
          </div>
        )}
      </PanelHeader>

      {p && (
        <div style={{ padding: '18px 26px 40px', display: 'flex', flexDirection: 'column', gap: 6 }}>
          {/* actions */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
            <a className="btn btn-primary" href={hasPhone ? `tel:${p.phone}` : undefined} style={{ textDecoration: 'none', opacity: hasPhone ? 1 : 0.45, pointerEvents: hasPhone ? 'auto' : 'none' }}>Call</a>
            <a className="btn btn-ghost" href={wa} target="_blank" rel="noreferrer" style={{ textDecoration: 'none', opacity: hasPhone ? 1 : 0.45, pointerEvents: hasPhone ? 'auto' : 'none' }}>WhatsApp</a>
            <button className="btn btn-ghost" onClick={() => setLogOpen(true)}>Log contact</button>
            <button className="btn btn-ghost" onClick={() => setShowCampaign(true)}>Add to campaign</button>
            {!p.is_volunteer && <button className="btn btn-ghost" disabled={busy} onClick={addAsVolunteer}>Add as volunteer</button>}
            {!p.is_meditator && <button className="btn btn-ghost" disabled={busy} onClick={addAsMeditator}>Add as meditator</button>}
          </div>

          <Section title="Personal Details">
            <Row label="Name" value={p.full_name} strong />
            <Row label="Age" value={ageOf(p.date_of_birth)} />
            <Row label="Gender" value={genderOf(p.gender)} />
            <Row label="Marital Status" value={p.marital_status} />
          </Section>

          <Section title="Contact Details">
            <Row label="Phone" value={p.phone} empty="No phone on record" action={hasPhone && <a href={`tel:${p.phone}`} style={{ color: 'var(--muted)' }}>{Icon.phone(17)}</a>} />
            <Row label="WhatsApp" value={p.phone} empty="No phone on record" action={hasPhone && <a href={wa} target="_blank" rel="noreferrer" style={{ color: 'var(--muted)' }}>{Icon.campaigns(17)}</a>} />
            <Row label="Email" value={p.email} />
            <Row label="Country" value={p.country} />
            <Row label="City" value={p.city} />
            <Row label="Pincode" value={p.pincode} />
            <Row label="Address" value={p.street} />
          </Section>

          <Section title="Key Information">
            <Row label="Center" value={center || p.center_id} />
            <Row label="Region" value={p.region} />
            <Row label="Program Tags" value={progTags.length ? progTags.join(', ') : null} />
            <Row label="IE Date" value={fmt(p.ie_date)} />
            <Row label="Last Transaction Date" value={fmt(p.last_active_date)} />
          </Section>

          <Section title="Other Information">
            <Row label="Volunteering Interest Details" value={vp?.interest_details} wrap />
            <Row label="Would you like to volunteer in-person?" value={vp?.in_person} wrap />
            <Row label="Take a deeper step" value={vp?.deeper_step} wrap />
            <Row label="Any specific skill / hobbies" value={vp?.skills_hobbies} wrap />
            <Row label="Occupation" value={p.occupation || vp?.occupation} />
            <Row label="Any other remarks" value={vp?.remarks} wrap />
            <Row label="Has Bond of Grace" value={boolOf(p.has_bond_of_grace)} />
            <Row label="Has Devi Yantra" value={boolOf(p.has_devi_yantra)} />
            <Row label="Has Sadhguru Sannidhi" value={boolOf(p.has_sadhguru_sannidhi)} />
            <Row label="Is Donor" value={boolOf(p.is_donor)} />
            <Row label="Nurturer" value={nurturer} />
          </Section>

          {/* tags */}
          <Section title="Tags">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
              {manual.map((t) => (<span key={t.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, fontWeight: 600, color: '#fff', background: '#9C4A14', padding: '3px 9px', borderRadius: 7 }}>{t.tag}<span onClick={() => removeTag(t.id)} style={{ cursor: 'pointer', opacity: 0.8 }}>✕</span></span>))}
              {derived.filter((d) => !manual.some((m) => m.tag === d)).map((d) => (<span key={d} style={{ fontSize: 11.5, fontWeight: 600, color: '#7A5230', background: '#F3EADB', padding: '3px 9px', borderRadius: 7 }}>{d}</span>))}
              {manual.length === 0 && derived.length === 0 && <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>No tags yet.</span>}
            </div>
            {sevaSuggestions.map(([label, n]) => (
              <div key={label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, fontSize: 12.5, color: '#5C4A2E', background: '#FBF1E4', border: '1px dashed #D8B98E', borderRadius: 9, padding: '8px 11px', marginBottom: 8 }}>
                <span>Attended <strong>{label}</strong> {n}× — rule: {SEVA_THRESHOLD}+ suggests the {label} tag.</span>
                <button className="btn btn-ghost" style={{ padding: '5px 11px', fontSize: 12, flexShrink: 0 }} onClick={() => applyTag(label)}>Apply “{label}”</button>
              </div>
            ))}
            <div style={{ display: 'flex', gap: 6 }}>
              <input value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()} placeholder="Add a tag…" style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 8, padding: '7px 10px', fontSize: 12.5, fontFamily: 'inherit', outline: 'none' }} />
              <button className="btn btn-ghost" onClick={addTag}>Add tag</button>
            </div>
          </Section>

          {/* Attendance — one typed timeline (event, satsang, meditator & volunteer) */}
          <Section title="Attendance" count={events.length}>
            {events.length === 0
              ? <Empty label="No attendance recorded yet." />
              : (
                <div className="card" style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead><tr style={{ textAlign: 'left', color: 'var(--muted-2)' }}><th style={th}>Event</th><th style={th}>Type</th><th style={th}>Kind</th><th style={th}>Date</th></tr></thead>
                    <tbody>{events.map((e, i) => (<tr key={i} style={{ borderTop: '1px solid #F1E9DB' }}><td style={td}>{e.name || '—'}</td><td style={td}>{e.type || '—'}</td><td style={td}>{e.kind || '—'}</td><td style={td}>{fmt(e.date) || '—'}</td></tr>))}</tbody>
                  </table>
                </div>
              )}
          </Section>

          {/* Call History */}
          <Section title="Call History" count={calls.length}>
            {calls.length === 0
              ? <Empty label="No calls logged yet." />
              : (
                <div className="card" style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12.5 }}>
                    <thead><tr style={{ textAlign: 'left', color: 'var(--muted-2)' }}><th style={th}>Call Status</th><th style={th}>Response</th><th style={th}>Remarks</th><th style={th}>Date</th></tr></thead>
                    <tbody>{calls.map((c, i) => (<tr key={i} style={{ borderTop: '1px solid #F1E9DB' }}><td style={td}>{c.completed_at ? 'Completed' : 'Scheduled'}{c.reachability ? ` · ${c.reachability.replace('_', ' ')}` : ''}</td><td style={td}>{c.sadhana_status || '—'}</td><td style={td}>{c.remarks || '—'}</td><td style={td}>{fmt(c.completed_at) || '—'}</td></tr>))}</tbody>
                  </table>
                </div>
              )}
          </Section>
        </div>
      )}

      {logOpen && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 130, padding: 20 }} onClick={() => setLogOpen(false)}>
          <div className="card" style={{ width: 400, maxWidth: '100%', padding: 22 }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 12px' }}>Log contact — {p?.full_name}</h3>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>{REACH.map((o) => (<button key={o.key} onClick={() => setOutcome(o.key)} className="btn" style={{ padding: '7px 12px', fontSize: 12.5, background: outcome === o.key ? '#241B14' : '#fff', color: outcome === o.key ? '#F6ECDC' : 'var(--ink-soft)', border: outcome === o.key ? 'none' : '1px solid var(--border)' }}>{o.label}</button>))}</div>
            <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} rows={3} placeholder="Remarks…" style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical', marginBottom: 14 }} />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}><button className="btn btn-ghost" onClick={() => setLogOpen(false)}>Cancel</button><button className="btn btn-primary" disabled={busy} onClick={saveLog}>{busy ? 'Saving…' : 'Save'}</button></div>
          </div>
        </div>
      )}
      {showCampaign && <CampaignForm audience={p?.is_meditator ? 'meditator' : 'volunteer'} personIds={[personId]} segmentLabel={p?.full_name || ''} onClose={() => setShowCampaign(false)} onToast={onToast} />}
    </SidePanel>
  )
}

const th = { padding: '9px 12px', fontSize: 10.5, letterSpacing: '.04em', textTransform: 'uppercase', fontWeight: 700, whiteSpace: 'nowrap' }
const td = { padding: '9px 12px', color: 'var(--ink-soft)', verticalAlign: 'top' }

function Section({ title, count, children }) {
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <span style={{ color: 'var(--orange)', display: 'flex' }}>{Icon.leaf(18)}</span>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>{title}</h3>
        {count != null && <span style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 20, padding: '1px 8px' }}>{count}</span>}
      </div>
      {children}
    </div>
  )
}

// Label-left / value-right row; explicit empty state; optional trailing action icon.
function Row({ label, value, empty = 'Not on record', strong, wrap, action }) {
  const isEmpty = value == null || value === ''
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '150px 1fr auto', gap: 12, alignItems: 'start', padding: '9px 0', borderBottom: '1px solid #F4EEE2' }}>
      <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{label}</div>
      <div style={{ fontSize: 13.5, fontWeight: strong ? 700 : 500, color: isEmpty ? 'var(--muted-2)' : 'var(--ink)', whiteSpace: wrap ? 'normal' : 'nowrap', overflow: wrap ? 'visible' : 'hidden', textOverflow: 'ellipsis' }}>
        {isEmpty ? empty : String(value)}
      </div>
      <div>{action || null}</div>
    </div>
  )
}
