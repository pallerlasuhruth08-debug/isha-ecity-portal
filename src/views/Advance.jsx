import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { pill, initials, avatarFor } from '../lib/ui'
import { Pad, ErrorCard, Loading, Empty, Chip, Checkbox, PagerBar, SelectionBar } from '../components/View'
import { useTableSelection } from '../lib/useTableSelection'
import { useBreakpoint } from '../lib/useBreakpoint'
import CampaignForm from '../components/CampaignForm'
import PersonProfile from '../components/PersonProfile'

const PROGRAMS = [
  { key: 'bsp', label: 'Bhava Spandana', tone: '#3D6E60' },
  { key: 'shoonya', label: 'Shoonya', tone: '#2F6E5E' },
  { key: 'samyama', label: 'Samyama', tone: '#9C4A14' },
  { key: 'guru_puja', label: 'Guru Puja', tone: '#7A5230' },
]
const FUNNEL = [
  { key: 'new', label: 'Interested' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'registered', label: 'Registered' },
  { key: 'done', label: 'Done' },
]
const STATUS_PILL = {
  new: pill('#E9F0EF', '#2F6E5E'),
  contacted: pill('#FBEAD9', '#C28A2A'),
  registered: pill('#EAF2E5', '#4E7C3F'),
  done: pill('#F1EADD', '#8C7E6B'),
  dropped: pill('#FBE6E0', '#B5532F'),
}
function ago(d) {
  if (!d) return '—'
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days < 30) return `${days}d ago`
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function Advance({ me, onToast }) {
  const { isPhone } = useBreakpoint()
  const [prog, setProg] = useState('bsp')
  const [summary, setSummary] = useState([]) // {program, status} for all rows (small table)
  const [rows, setRows] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(null)
  const sel = useTableSelection()
  const [showForm, setShowForm] = useState(false)
  const [formIds, setFormIds] = useState([])
  const [resolving, setResolving] = useState(false)
  const [profileId, setProfileId] = useState(null)

  // small summary for tab totals + funnel (advanced_interest is a small table)
  useEffect(() => {
    supabase.from('advanced_interest').select('program, status').then(({ data }) => setSummary(data || []))
  }, [])

  useEffect(() => {
    setPage(0)
    sel.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prog])
  useEffect(() => {
    setPage(0)
  }, [pageSize])

  const fetchAllIds = useCallback(async () => {
    const ids = []
    let from = 0
    const CHUNK = 1000
    for (let guard = 0; guard < 50; guard++) {
      const { data, error } = await supabase
        .from('advanced_interest')
        .select('person_id')
        .eq('program', prog)
        .order('person_id', { ascending: true })
        .range(from, from + CHUNK - 1)
      if (error) throw error
      const batch = (data || []).map((r) => r.person_id)
      ids.push(...batch)
      if (batch.length < CHUNK) break
      from += CHUNK
    }
    return [...new Set(ids)]
  }, [prog])

  const loadPage = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      const { data, count, error } = await supabase
        .from('advanced_interest')
        .select('id, person_id, program, status, interest_date, source, person:people!advanced_interest_person_id_fkey(full_name, phone)', { count: 'exact' })
        .eq('program', prog)
        .order('interest_date', { ascending: false })
        .range(page * pageSize, page * pageSize + pageSize - 1)
      if (error) throw error
      setRows(data || [])
      setTotal(count ?? 0)
    } catch (e) {
      setErr(e.message || String(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [prog, page, pageSize])

  useEffect(() => {
    loadPage()
  }, [loadPage])

  const counts = useMemo(() => {
    const c = {}
    for (const r of summary) if (r.program === prog) c[r.status] = (c[r.status] || 0) + 1
    return c
  }, [summary, prog])
  const progTotals = useMemo(() => {
    const t = {}
    for (const r of summary) t[r.program] = (t[r.program] || 0) + 1
    return t
  }, [summary])

  async function markContacted(r) {
    setBusy(r.id)
    try {
      const { error } = await supabase.from('advanced_interest').update({ status: 'contacted' }).eq('id', r.id)
      if (error) throw error
      setRows((prev) => prev.map((x) => (x.id === r.id ? { ...x, status: 'contacted' } : x)))
      setSummary((prev) => prev.concat()) // noop keep ref; recompute not critical
      onToast(`${r.person?.full_name || 'Contact'} marked contacted.`)
    } catch (e) {
      onToast('Could not update: ' + (e.message || e))
    } finally {
      setBusy(null)
    }
  }

  async function openCampaign() {
    if (sel.count(total) === 0) {
      setFormIds([])
      setShowForm(true)
      return
    }
    setResolving(true)
    try {
      setFormIds(await sel.resolveIds(fetchAllIds))
      setShowForm(true)
    } catch (e) {
      onToast('Could not resolve selection: ' + (e.message || e))
    } finally {
      setResolving(false)
    }
  }

  const cur = PROGRAMS.find((p) => p.key === prog)
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const selCount = sel.count(total)
  const grid = '34px 2fr 1.2fr 1fr 0.9fr 1fr'

  return (
    <Pad>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)', maxWidth: 560 }}>
          Bhava Spandana, Shoonya, Samyama &amp; Guru Puja — track interest through to registration.
        </p>
        <button className="btn" disabled={resolving} onClick={openCampaign}>{Icon.campaigns(16)} {resolving ? 'Preparing…' : 'Create campaign'}</button>
      </div>
      {err && <ErrorCard>Couldn't load advance programmes: {err}</ErrorCard>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {PROGRAMS.map((p) => (<Chip key={p.key} on={prog === p.key} label={p.label} count={progTotals[p.key] || 0} onClick={() => setProg(p.key)} />))}
      </div>

      <div className={isPhone ? undefined : 'dash-grid'} style={{ display: 'grid', gridTemplateColumns: isPhone ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)', gap: 12, marginBottom: 24 }}>
        {FUNNEL.map((f) => (
          <div key={f.key} className="card" style={{ padding: 18 }}>
            <div style={{ fontFamily: "'Newsreader',serif", fontSize: 28, fontWeight: 600, lineHeight: 1, color: cur.tone }}>{counts[f.key] || 0}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 6 }}>{f.label}</div>
          </div>
        ))}
      </div>

      <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 12px' }}>{cur.label} — candidates</h3>
      <SelectionBar isFullySelected={sel.isAllMode} count={selCount} onCreate={openCampaign} onClear={sel.clear} />

      <div className="card" style={{ overflow: 'hidden' }}>
        {isPhone ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
            <Checkbox state={sel.headerState(total)} onClick={() => (selCount > 0 ? sel.clear() : sel.selectAllMatching())} />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--muted)' }}>{selCount > 0 ? `${selCount} selected` : 'Select all'}</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '13px 20px', background: 'var(--panel)', borderBottom: '1px solid var(--border)', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, alignItems: 'center' }}>
            <Checkbox state={sel.headerState(total)} onClick={() => (selCount > 0 ? sel.clear() : sel.selectAllMatching())} />
            <span>Person</span>
            <span>Phone</span>
            <span>Added</span>
            <span>Status</span>
            <span>Action</span>
          </div>
        )}
        {loading && <Loading label="Loading…" />}
        {!loading && rows.length === 0 && <Empty label="No interest recorded for this programme yet." />}

        {!loading && isPhone &&
          rows.map((r, i) => (
            <div key={r.id} className="rowhover" onClick={() => r.person_id && setProfileId(r.person_id)} style={{ display: 'flex', gap: 12, padding: 14, borderBottom: '1px solid #F1E9DB', alignItems: 'flex-start', cursor: 'pointer', background: profileId === r.person_id ? '#FBF1E6' : undefined }}>
              <div style={{ minHeight: 44, display: 'flex', alignItems: 'center' }}>
                <Checkbox state={sel.isSelected(r.person_id)} onClick={(e) => { e.stopPropagation(); sel.toggle(r.person_id) }} />
              </div>
              <div style={{ width: 40, height: 40, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{initials(r.person?.full_name || '?')}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.person?.full_name || 'Unknown'}</div>
                  <span className="pill" style={STATUS_PILL[r.status] || STATUS_PILL.new}>{r.status}</span>
                </div>
                <div style={{ fontSize: 12.5, color: r.person?.phone ? 'var(--muted)' : '#B5532F', marginTop: 2 }}>{r.person?.phone || 'No phone'}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Added {ago(r.interest_date)}</div>
                {r.status === 'new' && (
                  <div onClick={(e) => e.stopPropagation()} style={{ marginTop: 8 }}>
                    <button className="btn btn-ghost" disabled={busy === r.id} style={{ padding: '9px 14px', fontSize: 12.5, minHeight: 40 }} onClick={() => markContacted(r)}>{busy === r.id ? '…' : 'Mark contacted'}</button>
                  </div>
                )}
              </div>
            </div>
          ))}

        {!loading && !isPhone &&
          rows.map((r, i) => (
            <div key={r.id} className="rowhover" onClick={() => r.person_id && setProfileId(r.person_id)} style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '13px 20px', borderBottom: '1px solid #F1E9DB', alignItems: 'center', cursor: 'pointer', background: profileId === r.person_id ? '#FBF1E6' : undefined }}>
              <Checkbox state={sel.isSelected(r.person_id)} onClick={(e) => { e.stopPropagation(); sel.toggle(r.person_id) }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(r.person?.full_name || '?')}</div>
                <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.person?.full_name || 'Unknown'}</div>
              </div>
              <div style={{ fontSize: 12.5, color: r.person?.phone ? 'var(--ink-soft)' : '#B5532F' }}>{r.person?.phone || 'No phone'}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{ago(r.interest_date)}</div>
              <div><span className="pill" style={STATUS_PILL[r.status] || STATUS_PILL.new}>{r.status}</span></div>
              <div onClick={(e) => e.stopPropagation()}>
                {r.status === 'new' ? (
                  <button className="btn btn-ghost" disabled={busy === r.id} style={{ padding: '6px 11px', fontSize: 12 }} onClick={() => markContacted(r)}>{busy === r.id ? '…' : 'Mark contacted'}</button>
                ) : (
                  <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>—</span>
                )}
              </div>
            </div>
          ))}
        {!loading && total > 0 && (
          <PagerBar page={page} pageCount={pageCount} total={total} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />
        )}
      </div>

      {showForm && (
        <CampaignForm
          audience="meditator"
          personIds={formIds}
          segmentLabel={formIds.length ? `${formIds.length} ${cur.label} candidates` : `${cur.label} candidates`}
          onClose={() => setShowForm(false)}
          onToast={onToast}
          onCreated={() => sel.clear()}
        />
      )}
      {profileId && <PersonProfile personId={profileId} me={me} onClose={() => setProfileId(null)} onToast={onToast} onChanged={loadPage} />}
    </Pad>
  )
}
