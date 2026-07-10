import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { pill, initials, avatarFor } from '../lib/ui'
import { Pad, ErrorCard, Loading, Empty, Checkbox, PagerBar, SelectionBar } from '../components/View'
import { useTableSelection } from '../lib/useTableSelection'
import { useBreakpoint } from '../lib/useBreakpoint'
import { multiFieldOr, PEOPLE_SEARCH_FIELDS } from '../lib/searchFilter'
import MobileFilterSheet from '../components/MobileFilterSheet'
import CampaignForm from '../components/CampaignForm'
import PersonProfile from '../components/PersonProfile'
import AssignNurturerDialog from '../components/AssignNurturerDialog'
import { addRecipientsToCampaign } from '../lib/campaignRecipients'

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

export default function Meditators({ me, onToast, campaignDraft = null, onClearCampaignDraft, onDone, recipientDraft = null, onRecipientsDone }) {
  const { isPhone } = useBreakpoint()
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
  const [needsNurt, setNeedsNurt] = useState(false)
  const [coveredIds, setCoveredIds] = useState(null) // person ids WITH an active nurturer (to exclude)
  const sel = useTableSelection()
  const reqSeq = useRef(0)
  const [showForm, setShowForm] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const [assignIds, setAssignIds] = useState([])
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
  }, [debounced, prog, recency, needsNurt])

  // 'Needs a nurturer' -> exclude people who already have an active nurturer.
  useEffect(() => {
    if (!needsNurt) { setCoveredIds(null); return }
    let alive = true
    setCoveredIds('loading')
    supabase.from('nurturing_assignments').select('cared_person_id').eq('active', true).not('nurturer_person_id', 'is', null).then(({ data }) => {
      if (alive) setCoveredIds([...new Set((data || []).map((r) => r.cared_person_id))])
    })
    return () => { alive = false }
  }, [needsNurt])
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
      if (needsNurt && Array.isArray(coveredIds) && coveredIds.length) q = q.not('id', 'in', `(${coveredIds.join(',')})`)
      const searchOr = multiFieldOr(debounced, PEOPLE_SEARCH_FIELDS) // name|phone|email|pincode, sanitized
      if (searchOr) q = q.or(searchOr)
      return q
    },
    [prog, recency, debounced, needsNurt, coveredIds],
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
    if (needsNurt && !Array.isArray(coveredIds)) return // wait for the covered set
    setLoading(true)
    setErr(null)
    const seq = ++reqSeq.current // cancel-in-flight: only the newest request applies
    try {
      let q = applyFilters(
        supabase.from('people').select('id, full_name, phone, area, pincode, center_id, ie_date, bsp_date, shoonya_date, samyama_date, last_active_date', { count: 'exact' }),
      )
      q = q.order('id', { ascending: true }).range(page * pageSize, page * pageSize + pageSize - 1)
      const { data, count, error } = await q
      if (error) throw error
      if (seq !== reqSeq.current) return
      setRows(data || [])
      setTotal(count ?? 0)
    } catch (e) {
      if (seq !== reqSeq.current) return
      setErr(e.message || String(e))
      setRows([])
    } finally {
      if (seq === reqSeq.current) setLoading(false)
    }
  }, [applyFilters, page, pageSize, needsNurt, coveredIds])

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

  async function addSelectedToCampaign() {
    if (!recipientDraft || sel.count(total) === 0) return
    setResolving(true)
    try {
      const ids = await sel.resolveIds(fetchAllIds)
      const { added, skipped } = await addRecipientsToCampaign(recipientDraft.campaignId, ids)
      onToast(`Added ${added} to “${recipientDraft.campaignName}”${skipped ? ` · ${skipped} already in it` : ''}.`)
      sel.clear()
      onRecipientsDone?.()
    } catch (e) {
      onToast('Could not add: ' + (e.message || e))
    } finally {
      setResolving(false)
    }
  }

  async function openAssign() {
    if (sel.count(total) === 0) return
    setResolving(true)
    try {
      setAssignIds(await sel.resolveIds(fetchAllIds))
      setShowAssign(true)
    } catch (e) {
      onToast('Could not resolve selection: ' + (e.message || e))
    } finally {
      setResolving(false)
    }
  }

  const loadingOpts = !rows && !err
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const selCount = sel.count(total)
  const isFullySelected = sel.headerState(total) === 'all'

  // Header checkbox = stage 1 of two-stage select-all: selects/deselects the CURRENT
  // PAGE only. Stage 2 ("Select all N matching this filter") lives in the SelectionBar.
  const pageIds = rows ? rows.map((r) => r.id) : []
  const pageSelectedCount = pageIds.filter((id) => sel.isSelected(id)).length
  const pageHeaderState = pageIds.length === 0 ? 'none' : pageSelectedCount === 0 ? 'none' : pageSelectedCount === pageIds.length ? 'all' : 'partial'
  const togglePage = () => (pageSelectedCount === pageIds.length && pageIds.length > 0 ? sel.deselectIds(pageIds) : sel.selectIds(pageIds))
  const selStyle = { padding: isPhone ? '11px' : '8px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12, fontFamily: 'inherit', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', minHeight: isPhone ? 44 : undefined, flex: isPhone ? '1 1 calc(50% - 5px)' : undefined }
  const grid = '34px 2fr 1.6fr 1.2fr 1.1fr'

  return (
    <Pad>
      {campaignDraft && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: 14, background: '#FBF1E4', borderColor: '#E7C9B8', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, color: 'var(--rust)', fontWeight: 600 }}>Building the call list for “{campaignDraft.eventName}” — select people, then Create campaign.</div>
          <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 12, padding: '5px 10px' }} onClick={() => onClearCampaignDraft && onClearCampaignDraft()}>Cancel</button>
        </div>
      )}
      {recipientDraft && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: 14, background: '#FBF1E4', borderColor: '#E7C9B8', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, color: 'var(--rust)', fontWeight: 600 }}>Adding meditators to “{recipientDraft.campaignName}” — select people, then Add to campaign.</div>
          <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 12, padding: '5px 10px' }} onClick={() => onRecipientsDone && onRecipientsDone()}>Cancel</button>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
        <div>
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>
            {loading ? 'Loading…' : (
              <>
                {total} in care
                <span className="mobile-hide"> · filter by programme and recent activity.</span>
              </>
            )}
          </div>
        </div>
        {/* On mobile this becomes the sticky bottom CTA below (one primary action per screen,
            thumb-reachable) instead of competing for space with the count text here. */}
        {!recipientDraft && !isPhone && <button className="btn" disabled={resolving} onClick={openCampaign}>{Icon.campaigns(16)} {resolving ? 'Preparing…' : 'Create campaign'}</button>}
      </div>

      {err && <ErrorCard>Couldn't load meditators: {err}</ErrorCard>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: isPhone ? '11px 12px' : '8px 12px', minWidth: 200, flexBasis: isPhone ? '100%' : undefined }}>
          {Icon.search(15)}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone, email or pincode…" style={{ border: 'none', outline: 'none', fontSize: 14, fontFamily: 'inherit', background: 'transparent', width: '100%', color: 'var(--ink)' }} />
        </div>
        <MobileFilterSheet count={(prog !== 'all' ? 1 : 0) + (recency !== 'any' ? 1 : 0) + (needsNurt ? 1 : 0)}>
          <select value={prog} onChange={(e) => setProg(e.target.value)} style={selStyle}>
            {PROGRAMS.map((p) => (<option key={p.key} value={p.key}>{p.label}</option>))}
          </select>
          <select value={recency} onChange={(e) => setRecency(e.target.value)} style={selStyle}>
            {RECENCY.map((r) => (<option key={r.key} value={r.key}>{r.label}</option>))}
          </select>
          <select value={needsNurt ? 'needs' : ''} onChange={(e) => setNeedsNurt(e.target.value === 'needs')} style={selStyle}>
            <option value="">Nurturer · any</option>
            <option value="needs">Needs a nurturer</option>
          </select>
        </MobileFilterSheet>
      </div>

      <SelectionBar isFullySelected={isFullySelected} count={selCount} total={total} onSelectAll={sel.selectAllMatching}
        onCreate={recipientDraft ? addSelectedToCampaign : openCampaign}
        createLabel={recipientDraft ? (resolving ? 'Adding…' : 'Add to campaign') : 'Create campaign'}
        onAssign={recipientDraft ? undefined : openAssign} onClear={sel.clear} />

      <div className="card" style={{ overflow: 'hidden' }}>
        {!loading && total > 0 && <PagerBar position="top" page={page} pageCount={pageCount} total={total} pageSize={pageSize} onPage={setPage} onPageSize={setPageSize} />}
        {isPhone ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', background: 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
            <Checkbox state={pageHeaderState} onClick={() => togglePage()} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>{selCount > 0 ? `${selCount} selected` : 'Select this page'}</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '13px 20px', background: 'var(--panel)', borderBottom: '1px solid var(--border)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, alignItems: 'center' }}>
            <Checkbox state={pageHeaderState} onClick={() => togglePage()} />
            <span>Meditator</span>
            <span>Programmes</span>
            <span>Where</span>
            <span>Last active</span>
          </div>
        )}
        {loading && <Loading label="Loading meditators…" />}
        {!loading && rows.length === 0 && <Empty label="No meditators match these filters." />}

        {!loading && isPhone &&
          rows.map((p, i) => (
            <div key={p.id} className="rowhover" onClick={() => setProfileId(p.id)} style={{ display: 'flex', gap: 12, padding: 14, borderBottom: '1px solid #F1E9DB', alignItems: 'flex-start', cursor: 'pointer', background: profileId === p.id ? '#FBF1E6' : undefined }}>
              <div style={{ minHeight: 44, display: 'flex', alignItems: 'center' }}>
                <Checkbox state={sel.isSelected(p.id)} onClick={(e) => { e.stopPropagation(); sel.toggle(p.id) }} />
              </div>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(p.full_name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.full_name}</div>
                <div style={{ fontSize: 12, color: p.phone ? 'var(--muted)' : 'var(--red)', marginTop: 2 }}>{p.phone || 'No phone on record'}</div>
                <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap', marginTop: 6 }}>
                  {progList(p).length === 0 && <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>No programmes</span>}
                  {progList(p).map((t) => (<span key={t} className="pill" style={pill('#F3E3D2', 'var(--rust)')}>{t}</span>))}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6 }}>{[p.area, p.pincode].filter(Boolean).join(' · ') || p.center_id || '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{lastActive(p.last_active_date)}</div>
              </div>
            </div>
          ))}

        {!loading && !isPhone &&
          rows.map((p, i) => (
            <div key={p.id} className="rowhover" onClick={() => setProfileId(p.id)} style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '13px 20px', borderBottom: '1px solid #F1E9DB', alignItems: 'center', cursor: 'pointer', background: profileId === p.id ? '#FBF1E6' : undefined }}>
              <Checkbox state={sel.isSelected(p.id)} onClick={(e) => { e.stopPropagation(); sel.toggle(p.id) }} />
              <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(p.full_name)}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.full_name}</div>
                  <div style={{ fontSize: 12, color: p.phone ? 'var(--muted)' : 'var(--red)' }}>{p.phone || 'No phone on record'}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
                {progList(p).length === 0 && <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>—</span>}
                {progList(p).map((t) => (<span key={t} className="pill" style={pill('#F3E3D2', 'var(--rust)')}>{t}</span>))}
              </div>
              <div style={{ fontSize: 14, color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[p.area, p.pincode].filter(Boolean).join(' · ') || p.center_id || '—'}</div>
              <div style={{ fontSize: 14, color: 'var(--muted)' }}>{lastActive(p.last_active_date)}</div>
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
          eventId={campaignDraft?.eventId || null}
          segmentLabel={campaignDraft ? `Inviting for ${campaignDraft.eventName}` : formIds.length ? `${formIds.length} selected meditators` : ''}
          onClose={() => setShowForm(false)}
          onToast={onToast}
          onCreated={() => { sel.clear(); if (campaignDraft) onDone?.() }}
        />
      )}
      {showAssign && (
        <AssignNurturerDialog personIds={assignIds} label="meditators" me={me} onClose={() => setShowAssign(false)} onToast={onToast} onDone={() => { setShowAssign(false); sel.clear(); loadPage() }} />
      )}
      {profileId && <PersonProfile personId={profileId} me={me} onClose={() => setProfileId(null)} onToast={onToast} onChanged={loadPage} />}

      {isPhone && !recipientDraft && (
        <>
          {/* Clears the fixed bar below so the last table row stays reachable. */}
          <div style={{ height: 68 }} />
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: '10px 14px calc(10px + env(safe-area-inset-bottom))', background: 'var(--bg)', borderTop: '1px solid var(--border)', zIndex: 120 }}>
            <button
              className="btn btn-primary"
              disabled={resolving}
              onClick={openCampaign}
              style={{ width: '100%', height: 48, justifyContent: 'center', fontSize: 15 }}
            >
              {Icon.campaigns(16)} {resolving ? 'Preparing…' : 'Create campaign'}
            </button>
          </div>
        </>
      )}
    </Pad>
  )
}
