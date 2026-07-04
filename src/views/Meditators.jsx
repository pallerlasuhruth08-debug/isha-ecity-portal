import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { pill, initials, avatarFor } from '../lib/ui'
import { Pad, ErrorCard, Loading, Empty, Checkbox, PagerBar, SelectionBar } from '../components/View'
import { useTableSelection } from '../lib/useTableSelection'
import CampaignForm from '../components/CampaignForm'
import PersonProfile from '../components/PersonProfile'

const PROGRAMS = [
  { key: 'all', label: 'All programmes' },
  { key: 'ie', label: 'Inner Engineering', col: 'ie_date' },
  { key: 'bsp', label: 'Bhava Spandana', col: 'bsp_date' },
  { key: 'shoonya', label: 'Shoonya', col: 'shoonya_date' },
  { key: 'samyama', label: 'Samyama', col: 'samyama_date' },
]
const RECENCY = [
  { key: 'any', label: 'Any time' },
  { key: '30', label: 'Active · 30 days' },
  { key: '90', label: 'Active · 90 days' },
  { key: 'quiet', label: 'Quiet · 90+ days' },
]

const daysAgoISO = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)
function progList(p) {
  return [p.ie_date && 'IE', p.bsp_date && 'BSP', p.shoonya_date && 'Shoonya', p.samyama_date && 'Samyama'].filter(Boolean)
}
function lastActive(d) {
  if (!d) return 'No recent activity'
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  if (days <= 0) return 'Active today'
  if (days < 30) return `Active ${days}d ago`
  if (days < 90) return `Active ${Math.round(days / 30)}mo ago`
  return `Quiet ${Math.round(days / 30)}mo`
}

export default function Meditators({ onToast }) {
  const [rows, setRows] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(true)

  const [search, setSearch] = useState('')
  const [debounced, setDebounced] = useState('')
  const [prog, setProg] = useState('all')
  const [recency, setRecency] = useState('any')
  const sel = useTableSelection()
  const [showForm, setShowForm] = useState(false)
  const [formIds, setFormIds] = useState([])
  const [resolving, setResolving] = useState(false)
  const [profileId, setProfileId] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    setPage(0)
    sel.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, prog, recency])
  useEffect(() => {
    setPage(0)
  }, [pageSize])

  const applyFilters = useCallback(
    (q) => {
      q = q.eq('is_meditator', true)
      const pd = PROGRAMS.find((p) => p.key === prog)
      if (pd && pd.col) q = q.not(pd.col, 'is', null)
      if (recency === '30') q = q.gte('last_active_date', daysAgoISO(30))
      if (recency === '90') q = q.gte('last_active_date', daysAgoISO(90))
      if (recency === 'quiet') q = q.lt('last_active_date', daysAgoISO(90))
      if (debounced) q = q.or(`full_name.ilike.%${debounced}%,pincode.ilike.%${debounced}%`)
      return q
    },
    [prog, recency, debounced],
  )

  const fetchAllIds = useCallback(async () => {
    const ids = []
    let from = 0
    const CHUNK = 1000
    for (let guard = 0; guard < 50; guard++) {
      let q = applyFilters(supabase.from('people').select('id'))
      q = q.order('id', { ascending: true }).range(from, from + CHUNK - 1)
      const { data, error } = await q
      if (error) throw error
      const batch = (data || []).map((r) => r.id)
      ids.push(...batch)
      if (batch.length < CHUNK) break
      from += CHUNK
    }
    return ids
  }, [applyFilters])

  const loadPage = useCallback(async () => {
    setLoading(true)
    setErr(null)
    try {
      let q = applyFilters(
        supabase.from('people').select('id, full_name, phone, area, pincode, center_id, ie_date, bsp_date, shoonya_date, samyama_date, last_active_date', { count: 'exact' }),
      )
      q = q.order('id', { ascending: true }).range(page * pageSize, page * pageSize + pageSize - 1)
      const { data, count, error } = await q
      if (error) throw error
      setRows(data || [])
      setTotal(count ?? 0)
    } catch (e) {
      setErr(e.message || String(e))
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [applyFilters, page, pageSize])

  useEffect(() => {
    loadPage()
  }, [loadPage])

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

  const loadingOpts = !rows && !err
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const selCount = sel.count(total)
  const selStyle = { padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer' }
  const grid = '34px 2fr 1.6fr 1.2fr 1.1fr'

  return (
    <Pad>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 3px' }}>Meditators</h2>
          <div style={{ fontSize: 13, color: 'var(--muted)' }}>{loading ? 'Loading…' : `${total} in care · filter by programme and recent activity.`}</div>
        </div>
        <button className="btn" disabled={resolving} onClick={openCampaign}>{Icon.campaigns(16)} {resolving ? 'Preparing…' : 'Create campaign'}</button>
      </div>

      {err && <ErrorCard>Couldn't load meditators: {err}</ErrorCard>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 12px', minWidth: 200 }}>
          {Icon.search(15)}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name or pincode…" style={{ border: 'none', outline: 'none', fontSize: 13, fontFamily: 'inherit', background: 'transparent', width: '100%', color: 'var(--ink)' }} />
        </div>
        <select value={prog} onChange={(e) => setProg(e.target.value)} style={selStyle}>
          {PROGRAMS.map((p) => (<option key={p.key} value={p.key}>{p.label}</option>))}
        </select>
        <select value={recency} onChange={(e) => setRecency(e.target.value)} style={selStyle}>
          {RECENCY.map((r) => (<option key={r.key} value={r.key}>{r.label}</option>))}
        </select>
      </div>

      <SelectionBar isAllMode={sel.isAllMode} count={selCount} onCreate={openCampaign} onClear={sel.clear} />

      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '13px 20px', background: 'var(--panel)', borderBottom: '1px solid var(--border)', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, alignItems: 'center' }}>
          <Checkbox state={sel.headerState(total)} onClick={() => (selCount > 0 ? sel.clear() : sel.selectAllMatching())} />
          <span>Meditator</span>
          <span>Programmes</span>
          <span>Where</span>
          <span>Last active</span>
        </div>
        {loading && <Loading label="Loading meditators…" />}
        {!loading && rows.length === 0 && <Empty label="No meditators match these filters." />}
        {!loading &&
          rows.map((p, i) => (
            <div key={p.id} className="rowhover" onClick={() => setProfileId(p.id)} style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '13px 20px', borderBottom: '1px solid #F1E9DB', alignItems: 'center', cursor: 'pointer', background: profileId === p.id ? '#FBF1E6' : undefined }}>
              <Checkbox state={sel.isSelected(p.id)} onClick={(e) => { e.stopPropagation(); sel.toggle(p.id) }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                <div style={{ width: 36, height: 36, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{initials(p.full_name)}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.full_name}</div>
                  <div style={{ fontSize: 11.5, color: p.phone ? 'var(--muted)' : '#B5532F' }}>{p.phone || 'No phone on record'}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {progList(p).length === 0 && <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>—</span>}
                {progList(p).map((t) => (<span key={t} className="pill" style={pill('#F3E3D2', '#9C4A14')}>{t}</span>))}
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[p.area, p.pincode].filter(Boolean).join(' · ') || p.center_id || '—'}</div>
              <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{lastActive(p.last_active_date)}</div>
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
          segmentLabel={formIds.length ? `${formIds.length} selected meditators` : ''}
          onClose={() => setShowForm(false)}
          onToast={onToast}
          onCreated={() => sel.clear()}
        />
      )}
      {profileId && <PersonProfile personId={profileId} onClose={() => setProfileId(null)} onToast={onToast} onChanged={loadPage} />}
    </Pad>
  )
}
