import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pill, initials, avatarFor } from '../lib/ui'
import { Loading, Empty, Checkbox, PagerPill } from './View'
import SidePanel, { PanelHeader } from './SidePanel'
import { eventDays, eventDaysWithSetup, fmtDay } from '../lib/planning'
import { useTableSelection } from '../lib/useTableSelection'
import { useBreakpoint } from '../lib/useBreakpoint'
import CampaignForm from './CampaignForm'
import { addRecipientsToCampaign } from '../lib/campaignRecipients'

export const EI_STATUS = [
  { v: 'interested', label: 'Interested', pill: pill('#F1EADD', '#8C7E6B') },
  { v: 'contacted', label: 'Contacted', pill: pill('#FCF4CB', '#8A6D1B') },
  { v: 'approved', label: 'Approved', pill: pill('#EAF2E5', '#4E7C3F') },
  { v: 'declined', label: 'Declined', pill: pill('#FBE6E0', '#B5532F') },
  { v: 'no_response', label: 'No Response', pill: pill('#FBEAD9', '#C2691F') },
]
export const EI_STATUS_MAP = Object.fromEntries(EI_STATUS.map((s) => [s.v, s]))

const ago = (d) => {
  if (!d) return '—'
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '')

function actionsFor(status, contactedAt) {
  const s = status || 'interested'
  if (s === 'interested') return [{ label: 'Mark Contacted', to: 'contacted' }, { label: 'Approve', to: 'approved', primary: true }]
  if (s === 'contacted') return [{ label: 'Approve', to: 'approved', primary: true }, { label: 'Declined', to: 'declined' }, { label: 'No Response', to: 'no_response' }]
  if (s === 'approved') return [{ label: 'Undo', to: contactedAt ? 'contacted' : 'interested' }]
  if (s === 'declined' || s === 'no_response') return [{ label: 'Re-contact', to: 'contacted' }]
  return []
}

function availLabel(r, daysByEvent) {
  const days = daysByEvent[r.activity?.id] || []
  const avail = r.availability_dates || []
  if (!days.length) return '—'
  if (!avail.length) return 'Not set'
  const matching = avail.filter((d) => days.includes(d))
  if (matching.length === days.length) return 'All days'
  return `${matching.length}/${days.length} days`
}

// Shared Event-Interest table view. Two modes:
//  - lockEventId set → single event, no event filter pill row (Event Hub tab).
//  - lockEventId null → all events with an "Event" pill row; scopeEventId presets it.
export default function EventInterestPanel({ uid, lockEventId = null, scopeEventId = null, onScopeConsumed, reloadKey = 0, onToast, isCoordinator = true, recipientDraft = null, onRecipientsDone }) {
  const { isPhone } = useBreakpoint()

  // Server-side pagination
  const [rows, setRows] = useState(null)
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(25)
  const [loading, setLoading] = useState(true)

  // Filters: status + event pushed server-side; availability client-side
  const [statusFilter, setStatusFilter] = useState('all')
  const [evFilter, setEvFilter] = useState('all')
  const [availFilter, setAvailFilter] = useState('all')

  const [selected, setSelected] = useState(null)
  const [showCampaign, setShowCampaign] = useState(false)
  const [campaignIds, setCampaignIds] = useState([])
  const [resolving, setResolving] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const [assignBusy, setAssignBusy] = useState(false)

  // Event list for filter pills — loaded separately so it spans all pages
  const [evList, setEvList] = useState([])

  const sel = useTableSelection()
  const reqSeq = useRef(0)

  // Distinct events for the pill row
  useEffect(() => {
    let q = supabase.from('event_interest')
      .select('activity:activities!event_interest_activity_id_fkey(id, name, activity_date, start_date, end_date)')
    if (lockEventId) q = q.eq('activity_id', lockEventId)
    q.limit(5000).then(({ data }) => {
      const m = new Map()
      for (const r of data || []) if (r.activity) m.set(r.activity.id, r.activity)
      setEvList([...m.values()])
    })
  }, [lockEventId, reloadKey])

  // Reset page + clear selection when server-side filters change
  useEffect(() => {
    setPage(0)
    sel.clear() // eslint-disable-line react-hooks/exhaustive-deps
  }, [statusFilter, evFilter, availFilter, pageSize])

  // Preset event filter from Interest Inbox scope jump
  useEffect(() => {
    if (scopeEventId && !lockEventId) { setEvFilter(scopeEventId); onScopeConsumed?.() }
  }, [scopeEventId, lockEventId, onScopeConsumed])

  // Day 0 = the day before the event's own first day (a setup/pre-event day some
  // volunteers help with) — prepended so it sorts/indexes as day 0, Day 1 stays the
  // event's real first day exactly as before.
  const daysByEvent = Object.fromEntries(evList.map((e) => [e.id, eventDaysWithSetup(e.start_date || e.activity_date, e.end_date)]))
  const maxDays = Math.max(1, ...evList.map((e) => (daysByEvent[e.id] || []).length))

  // When exactly ONE event is in scope (the only way this panel is actually used —
  // Event Hub always locks it), the availability filter can be pushed server-side:
  // "Day N" resolves to that event's Nth real date and becomes a `.contains()` filter,
  // so total/pagination reflect the FILTERED set, not just the current page.
  const scopedEventId = lockEventId || (evFilter !== 'all' ? evFilter : null)
  const scopedDays = scopedEventId ? (daysByEvent[scopedEventId] || []) : []

  const loadPage = useCallback(async () => {
    // A day filter is active but we don't have the scoped event's day list yet
    // (evList still loading) — wait rather than firing an unfiltered query.
    if (scopedEventId && availFilter !== 'all' && scopedDays.length === 0) return
    setLoading(true)
    const seq = ++reqSeq.current
    try {
      let q = supabase.from('event_interest').select(
        'id, created_at, status, contacted_at, approved_at, availability_dates, note, activity:activities!event_interest_activity_id_fkey(id, name, activity_date, start_date, end_date), person:people!event_interest_person_id_fkey(id, full_name, phone, email)',
        { count: 'exact' }
      )
      if (lockEventId) q = q.eq('activity_id', lockEventId)
      else if (evFilter !== 'all') q = q.eq('activity_id', evFilter)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (scopedEventId && scopedDays.length) {
        if (availFilter === 'all_days') q = q.contains('availability_dates', scopedDays)
        else if (availFilter.startsWith('day')) {
          const d = scopedDays[Number(availFilter.slice(3))]
          if (d) q = q.contains('availability_dates', [d])
        }
      }
      q = q.order('created_at', { ascending: false }).range(page * pageSize, page * pageSize + pageSize - 1)
      const { data, count, error } = await q
      if (error) throw error
      if (seq !== reqSeq.current) return
      setRows(data || [])
      setTotal(count ?? 0)
    } catch (e) {
      if (seq !== reqSeq.current) return
      onToast?.('Could not load event interests: ' + (e.message || e))
      setRows([])
    } finally {
      if (seq === reqSeq.current) setLoading(false)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockEventId, evFilter, statusFilter, availFilter, scopedEventId, scopedDays.join(','), page, pageSize, onToast])

  useEffect(() => { loadPage() }, [loadPage, reloadKey])

  const patchRow = (id, fields) => {
    setRows((prev) => (prev || []).map((r) => (r.id === id ? { ...r, ...fields } : r)))
    setSelected((s) => (s && s.id === id ? { ...s, ...fields } : s))
  }

  async function changeStatus(r, to) {
    const patch = { status: to }
    if (to === 'contacted') { patch.contacted_at = new Date().toISOString(); patch.contacted_by = uid || null; patch.approved_at = null; patch.approved_by = null }
    else if (to === 'approved') { patch.approved_at = new Date().toISOString(); patch.approved_by = uid || null }
    else if (to === 'interested') { patch.contacted_at = null; patch.contacted_by = null; patch.approved_at = null; patch.approved_by = null }
    try {
      const { error } = await supabase.from('event_interest').update(patch).eq('id', r.id)
      if (error) throw error
      patchRow(r.id, patch)
      onToast?.(`${r.person?.full_name || 'Interest'} → ${EI_STATUS_MAP[to]?.label || to}.`)
    } catch (e) { onToast?.('Could not update status: ' + (e.message || e)) }
  }

  async function saveAvailability(r, dates) {
    try {
      const { error } = await supabase.from('event_interest').update({ availability_dates: dates }).eq('id', r.id)
      if (error) throw error
      patchRow(r.id, { availability_dates: dates })
    } catch (e) { onToast?.('Could not save availability: ' + (e.message || e)) }
  }

  async function saveNote(r, note) {
    try {
      const { error } = await supabase.from('event_interest').update({ note }).eq('id', r.id)
      if (error) throw error
      patchRow(r.id, { note })
      onToast?.('Comment saved.')
    } catch (e) { onToast?.('Could not save comment: ' + (e.message || e)) }
  }

  // Fetch all person_ids matching current server-side filters (for Stage 2 "select all"
  // and for bulk actions like Assign to team) -- including the day filter when scoped.
  const fetchAllIds = useCallback(async () => {
    const ids = []
    let from = 0
    const CHUNK = 1000
    for (let g = 0; g < 50; g++) {
      let q = supabase.from('event_interest').select('person_id')
      if (lockEventId) q = q.eq('activity_id', lockEventId)
      else if (evFilter !== 'all') q = q.eq('activity_id', evFilter)
      if (statusFilter !== 'all') q = q.eq('status', statusFilter)
      if (scopedEventId && scopedDays.length) {
        if (availFilter === 'all_days') q = q.contains('availability_dates', scopedDays)
        else if (availFilter.startsWith('day')) {
          const d = scopedDays[Number(availFilter.slice(3))]
          if (d) q = q.contains('availability_dates', [d])
        }
      }
      q = q.order('person_id', { ascending: true }).range(from, from + CHUNK - 1)
      const { data, error } = await q
      if (error) throw error
      const batch = (data || []).map((r) => r.person_id).filter(Boolean)
      ids.push(...batch)
      if (batch.length < CHUNK) break
      from += CHUNK
    }
    return [...new Set(ids)]
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockEventId, evFilter, statusFilter, availFilter, scopedEventId, scopedDays.join(',')])

  async function openCampaign() {
    if (selCount === 0) { setCampaignIds([]); setShowCampaign(true); return }
    setResolving(true)
    try {
      setCampaignIds(await sel.resolveIds(fetchAllIds))
      setShowCampaign(true)
    } catch (e) {
      onToast?.('Could not resolve selection: ' + (e.message || e))
    } finally { setResolving(false) }
  }

  // Add-to-existing-campaign: resolve the selected interests to their canonical people
  // and append them to the campaign we arrived from, then return to it.
  async function addSelectedToCampaign() {
    if (!recipientDraft || selCount === 0) return
    setResolving(true)
    try {
      const ids = await sel.resolveIds(fetchAllIds)
      const { added, skipped } = await addRecipientsToCampaign(recipientDraft.campaignId, ids)
      onToast?.(`Added ${added} to “${recipientDraft.campaignName}”${skipped ? ` · ${skipped} already in it` : ''}.`)
      sel.clear()
      onRecipientsDone?.()
    } catch (e) {
      onToast?.('Could not add: ' + (e.message || e))
    } finally { setResolving(false) }
  }

  // Bulk-assign the current selection (respecting all active filters, across every
  // page — same resolveIds path as the campaign flow) straight onto a team, without
  // going through each TeamCard's own add-member picker. Only offered when scoped to
  // one event (Event Hub always locks it — a team belongs to a specific event).
  async function assignToTeam(block) {
    setAssignBusy(true)
    try {
      const personIds = await sel.resolveIds(fetchAllIds)
      if (!personIds.length) { onToast?.('No volunteers selected.'); return }
      const { data: existing, error: exErr } = await supabase.from('block_assignments').select('person_id').eq('block_id', block.id).in('person_id', personIds)
      if (exErr) throw exErr
      const already = new Set((existing || []).map((r) => r.person_id))
      const toInsert = personIds.filter((id) => !already.has(id))
      if (toInsert.length) {
        const scopedEvent = evList.find((e) => e.id === scopedEventId)
        const firstDay = scopedEvent?.start_date || scopedEvent?.activity_date || null
        const { error } = await supabase.from('block_assignments').insert(
          toInsert.map((pid) => ({ block_id: block.id, person_id: pid, day_date: firstDay, status: 'assigned', assigned_by: uid || null }))
        )
        if (error) throw error
      }
      onToast?.(`Added ${toInsert.length} to "${block.heading}"${already.size ? ` · ${already.size} already on the team` : ''}.`)
      sel.clear()
      setShowAssign(false)
    } catch (e) {
      onToast?.('Could not assign: ' + (e.message || e))
    } finally { setAssignBusy(false) }
  }

  // When scoped to one event (the real-world case), the day filter already ran
  // server-side in loadPage/fetchAllIds -- rows IS the filtered page, use as-is.
  // Unscoped (multi-event, not reachable from the current app) falls back to the
  // old page-local client filter rather than silently ignoring it.
  const matchesAvail = (r) => {
    if (availFilter === 'all') return true
    const days = daysByEvent[r.activity?.id] || []
    const avail = r.availability_dates || []
    if (availFilter === 'all_days') return days.length > 0 && days.every((d) => avail.includes(d))
    const idx = Number(availFilter.slice(3))
    const d = days[idx]
    return d ? avail.includes(d) : false
  }
  const shown = scopedEventId ? (rows || []) : (rows || []).filter(matchesAvail)

  // Two-stage selection: keys = person_id
  const pageIds = (rows || []).map((r) => r.person?.id).filter(Boolean)
  const pageSelectedCount = pageIds.filter((id) => sel.isSelected(id)).length
  const pageHeaderState = pageIds.length === 0 ? 'none' : pageSelectedCount === 0 ? 'none' : pageSelectedCount === pageIds.length ? 'all' : 'partial'
  const togglePage = () => (pageSelectedCount === pageIds.length && pageIds.length > 0 ? sel.deselectIds(pageIds) : sel.selectIds(pageIds))
  const selCount = sel.count(total)
  const isFullySelected = sel.headerState(total) === 'all'

  const pageCount = Math.max(1, Math.ceil(total / pageSize))

  // Campaign: attach event_id when a specific event is in scope
  const campaignEventId = lockEventId || (evFilter !== 'all' ? evFilter : null)
  const activeEvent = evList.find((e) => e.id === campaignEventId)

  const showEventCol = !lockEventId
  const grid = showEventCol
    ? '34px 2fr 1.2fr 0.85fr 1.4fr 0.9fr'
    : '34px 2fr 1.3fr 0.9fr 1fr'

  const filterChip = (on) => ({ fontSize: 12, fontWeight: 600, padding: '6px 11px', borderRadius: 20, cursor: 'pointer', border: on ? 'none' : '1px solid var(--border)', background: on ? '#241B14' : '#fff', color: on ? '#F6ECDC' : 'var(--ink-soft)', whiteSpace: 'nowrap', flexShrink: 0 })
  const pillRow = { display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 8 }

  return (
    <>
      {/* Status pills */}
      <div className="scroll-tabs" style={pillRow}>
        <button className="tap44" onClick={() => setStatusFilter('all')} style={filterChip(statusFilter === 'all')}>All</button>
        {EI_STATUS.map((s) => (
          <button key={s.v} className="tap44" onClick={() => setStatusFilter(s.v)} style={filterChip(statusFilter === s.v)}>{s.label}</button>
        ))}
      </div>

      {/* Event pills — skipped when locked to a single event */}
      {!lockEventId && evList.length > 0 && (
        <div className="scroll-tabs" style={pillRow}>
          <button className="tap44" onClick={() => setEvFilter('all')} style={filterChip(evFilter === 'all')}>All Events</button>
          {evList.map((e) => (
            <button key={e.id} className="tap44" onClick={() => setEvFilter(e.id)} style={filterChip(evFilter === e.id)}>{e.name}</button>
          ))}
        </div>
      )}

      {/* Availability pills — server-side + paginated when scoped to one event */}
      <div className="scroll-tabs" style={{ ...pillRow, marginBottom: 12 }}>
        <button className="tap44" onClick={() => setAvailFilter('all')} style={filterChip(availFilter === 'all')}>All</button>
        {Array.from({ length: maxDays }, (_, i) => `day${i}`).map((k, i) => (
          <button key={k} className="tap44" onClick={() => setAvailFilter(k)} style={filterChip(availFilter === k)}>Day {i}</button>
        ))}
        <button className="tap44" onClick={() => setAvailFilter('all_days')} style={filterChip(availFilter === 'all_days')}>All Days</button>
      </div>

      <div style={{ marginBottom: 10, fontSize: 14, color: 'var(--muted)' }}>
        {loading ? 'Loading…' : `${total} interest${total === 1 ? '' : 's'}${selCount > 0 ? ` · ${selCount} selected` : ''}`}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        {/* Table header */}
        {isPhone ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel)' }}>
            <Checkbox state={pageHeaderState} onClick={togglePage} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>{selCount > 0 ? `${selCount} selected` : 'Select this page'}</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '12px 20px', borderBottom: '1px solid var(--border)', fontSize: 12, letterSpacing: '.07em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, background: 'var(--panel)', alignItems: 'center' }}>
            <Checkbox state={pageHeaderState} onClick={togglePage} />
            <span>Volunteer</span>
            <span>Phone</span>
            <span>Status</span>
            {showEventCol && <span>Event</span>}
            <span>Availability</span>
          </div>
        )}

        {loading && <Loading label="Loading event interests…" />}
        {!loading && shown.length === 0 && <Empty label="No interests match these filters." />}

        {/* Mobile card rows */}
        {!loading && isPhone && shown.map((r, i) => (
          <div key={r.id} className="rowhover tap44" onClick={() => setSelected(r)}
            style={{ display: 'flex', gap: 12, padding: 14, borderBottom: '1px solid #F1E9DB', alignItems: 'flex-start', cursor: 'pointer', background: selected?.id === r.id ? '#FBF1E6' : undefined }}>
            <div style={{ paddingTop: 2, minHeight: 44, display: 'flex', alignItems: 'center' }} onClick={(e) => { e.stopPropagation(); r.person?.id && sel.toggle(r.person.id) }}>
              <Checkbox state={r.person?.id ? sel.isSelected(r.person.id) : 'none'} />
            </div>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(r.person?.full_name || '?')}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.person?.full_name || 'Unknown'}</div>
                <span className="pill" style={EI_STATUS_MAP[r.status || 'interested']?.pill}>{EI_STATUS_MAP[r.status || 'interested']?.label}</span>
              </div>
              <div style={{ fontSize: 12, color: r.person?.phone ? 'var(--muted)' : 'var(--red)', marginTop: 2 }}>{r.person?.phone || 'no phone'}</div>
              {showEventCol && r.activity && <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{r.activity.name}</div>}
              <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{availLabel(r, daysByEvent)}</div>
            </div>
          </div>
        ))}

        {/* Desktop grid rows */}
        {!loading && !isPhone && shown.map((r, i) => (
          <div key={r.id} className="rowhover" onClick={() => setSelected(r)}
            style={{ display: 'grid', gridTemplateColumns: grid, gap: 12, padding: '12px 20px', borderBottom: '1px solid #F1E9DB', alignItems: 'center', cursor: 'pointer', background: selected?.id === r.id ? '#FBF1E6' : undefined }}>
            <div onClick={(e) => { e.stopPropagation(); r.person?.id && sel.toggle(r.person.id) }}>
              <Checkbox state={r.person?.id ? sel.isSelected(r.person.id) : 'none'} />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(r.person?.full_name || '?')}</div>
              <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.person?.full_name || 'Unknown'}</div>
            </div>
            <div style={{ fontSize: 14, color: r.person?.phone ? 'var(--ink-soft)' : 'var(--red)' }}>{r.person?.phone || 'no phone'}</div>
            <div><span className="pill" style={EI_STATUS_MAP[r.status || 'interested']?.pill}>{EI_STATUS_MAP[r.status || 'interested']?.label}</span></div>
            {showEventCol && <div style={{ fontSize: 14, color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.activity?.name || '—'}</div>}
            <div style={{ fontSize: 14, color: 'var(--muted)' }}>{availLabel(r, daysByEvent)}</div>
          </div>
        ))}

      </div>
      {!loading && total > 0 && (
        <PagerPill page={page} pageCount={pageCount} onPage={setPage} pageSize={pageSize} onPageSize={setPageSize}
          selection={{
            count: selCount, total, isFullySelected, onSelectAll: sel.selectAllMatching, onClear: sel.clear,
            actions: [
              ...(isCoordinator && scopedEventId && !recipientDraft ? [{
                label: 'Assign to team', onClick: () => setShowAssign(true), disabled: resolving || assignBusy,
              }] : []),
              {
                label: recipientDraft ? (resolving ? 'Adding…' : 'Add to campaign') : (resolving ? 'Preparing…' : 'Create campaign'),
                onClick: recipientDraft ? addSelectedToCampaign : openCampaign, disabled: resolving, primary: true,
              },
            ],
          }} />
      )}

      {selected && (
        <InterestDetail
          r={selected}
          isCoordinator={isCoordinator}
          days={daysByEvent[selected.activity?.id] || []}
          onClose={() => setSelected(null)}
          onAction={(to) => changeStatus(selected, to)}
          onAvailability={(d) => saveAvailability(selected, d)}
          onSaveNote={(n) => saveNote(selected, n)}
        />
      )}

      {showAssign && (
        <AssignToTeamModal eventId={scopedEventId} busy={assignBusy} onClose={() => setShowAssign(false)} onPick={assignToTeam} />
      )}

      {showCampaign && (
        <CampaignForm
          audience="volunteer"
          personIds={campaignIds}
          eventId={campaignEventId}
          segmentLabel={
            campaignIds.length
              ? `${campaignIds.length} interest${campaignIds.length !== 1 ? 's' : ''}${activeEvent ? ` · ${activeEvent.name}` : ''}`
              : activeEvent ? `${activeEvent.name} — all interests` : 'Event interests'
          }
          onClose={() => setShowCampaign(false)}
          onToast={onToast}
          onCreated={() => sel.clear()}
        />
      )}
    </>
  )
}

// Pick-a-team modal for the "Assign to team" bulk action — lists this event's teams
// with a live fill count; clicking one assigns the whole (filtered/paginated) selection.
function AssignToTeamModal({ eventId, busy, onClose, onPick }) {
  const [teams, setTeams] = useState(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: bl } = await supabase.from('activity_blocks').select('id, heading, volunteers_needed').eq('activity_id', eventId).is('archived_at', null).order('created_at')
      const blocks = bl || []
      const ids = blocks.map((b) => b.id)
      const filledByBlock = {}
      if (ids.length) {
        const { data: asg } = await supabase.from('block_assignments').select('block_id, status').in('block_id', ids)
        for (const a of asg || []) {
          if (!['assigned', 'show', 'involved'].includes(a.status)) continue
          filledByBlock[a.block_id] = (filledByBlock[a.block_id] || 0) + 1
        }
      }
      if (alive) setTeams(blocks.map((b) => ({ ...b, filled: filledByBlock[b.id] || 0 })))
    })()
    return () => { alive = false }
  }, [eventId])

  return (
    <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 130, padding: 20 }} onClick={onClose}>
      <div className="card modal-sheet" style={{ width: 420, maxWidth: '100%', maxHeight: '80vh', overflowY: 'auto', padding: 22, boxShadow: 'var(--shadow-lg)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Assign to team</h3>
          <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={onClose}>✕ Close</button>
        </div>
        {!teams ? <Loading label="Loading teams…" /> : teams.length === 0 ? <Empty label="No teams yet — create one in the Teams tab first." /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {teams.map((t) => {
              const full = t.filled >= (t.volunteers_needed || 0)
              return (
                <button key={t.id} disabled={busy} onClick={() => onPick(t)} className="rowhover tap44"
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 9, border: '1px solid var(--border)', background: '#fff', cursor: busy ? 'default' : 'pointer', textAlign: 'left', opacity: busy ? 0.6 : 1 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{t.heading}</span>
                  <span className="pill" style={full ? pill('#EAF2E5', '#4E7C3F') : pill('#FBEAD9', '#C2691F')}>{t.filled}/{t.volunteers_needed || 0}{full ? ' · full' : ''}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

function InterestDetail({ r, isCoordinator, days, onClose, onAction, onAvailability, onSaveNote }) {
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState(r.note || '')
  const status = r.status || 'interested'
  const avail = r.availability_dates || []
  const allSelected = days.length > 0 && days.every((d) => avail.includes(d))
  const toggleDay = (d) => onAvailability(avail.includes(d) ? avail.filter((x) => x !== d) : [...avail, d].sort())
  const toggleAll = () => onAvailability(allSelected ? [] : [...days])
  const chip = (on) => ({ fontSize: 12, fontWeight: 600, padding: '6px 11px', borderRadius: 8, cursor: 'pointer', border: on ? '1px solid var(--orange)' : '1px solid var(--border)', background: on ? '#F6E8D8' : '#fff', color: on ? 'var(--orange)' : 'var(--muted)' })
  const actions = isCoordinator ? actionsFor(status, r.contacted_at) : []

  async function run(to) { setBusy(true); try { await onAction(to) } finally { setBusy(false) } }

  return (
    <SidePanel onClose={onClose} width={480}>
      <PanelHeader onClose={onClose}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 46, height: 46, borderRadius: '50%', background: avatarFor(1), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 600 }}>{initials(r.person?.full_name || '?')}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 3px' }}>{r.person?.full_name || 'Unknown'}</h2>
            <span className="pill" style={EI_STATUS_MAP[status]?.pill}>{EI_STATUS_MAP[status]?.label}</span>
          </div>
        </div>
      </PanelHeader>

      <div style={{ padding: '20px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card" style={{ padding: 18 }}>
          <SecH>Contact &amp; event</SecH>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px 20px' }}>
            <F label="Phone" value={r.person?.phone || 'No phone on record'} />
            <F label="Email" value={r.person?.email || '—'} />
            <div style={{ gridColumn: '1 / -1' }}><F label="Event" value={`${r.activity?.name || 'Unknown event'} · ${fmtDate(r.activity?.activity_date)}`} /></div>
            <F label="Interested since" value={fmtDate(r.created_at)} />
            {r.contacted_at && <F label="Contacted" value={`${fmtDate(r.contacted_at)} · ${ago(r.contacted_at)}`} />}
            {r.approved_at && <F label="Approved" value={`${fmtDate(r.approved_at)} · ${ago(r.approved_at)}`} />}
          </div>
        </div>

        {isCoordinator && actions.length > 0 && (
          <div className="card" style={{ padding: 18 }}>
            <SecH>Status</SecH>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {actions.map((a) => (
                <button key={a.to + a.label} disabled={busy} onClick={() => run(a.to)}
                  style={{ fontSize: 14, fontWeight: 600, padding: '9px 15px', borderRadius: 9, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
                    border: a.primary ? 'none' : '1px solid var(--border)', background: a.primary ? 'linear-gradient(150deg, var(--orange-2), var(--orange-3))' : '#fff', color: a.primary ? '#fff' : 'var(--ink-soft)' }}>{a.label}</button>
              ))}
            </div>
          </div>
        )}

        {days.length > 0 && (
          <div className="card" style={{ padding: 18 }}>
            <SecH>Availability</SecH>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {isCoordinator ? (
                <>
                  {days.length > 1 && <button onClick={toggleAll} style={chip(allSelected)}>All Days</button>}
                  {days.map((d, di) => (
                    <button key={d} onClick={() => toggleDay(d)} style={chip(avail.includes(d))}>Day {di} · {fmtDay(d)}</button>
                  ))}
                </>
              ) : (
                avail.length ? avail.map((d) => <span key={d} className="pill" style={pill('#F6E8D8', 'var(--orange)')}>Day {days.indexOf(d)} · {fmtDay(d)}</span>)
                  : <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>Not set</span>
              )}
            </div>
          </div>
        )}

        <div className="card" style={{ padding: 18 }}>
          <SecH>Comments</SecH>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="Notes on availability, preferences, etc…"
            style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 14, fontFamily: 'inherit', background: '#fff', color: 'var(--ink)', outline: 'none', resize: 'vertical' }} />
          {isCoordinator && (
            <button className="btn btn-ghost" style={{ marginTop: 10, fontSize: 12 }} disabled={note === (r.note || '')} onClick={() => onSaveNote(note)}>Save comment</button>
          )}
        </div>
      </div>
    </SidePanel>
  )
}

function F({ label, value }) {
  return (<div><div style={{ fontSize: 12, color: 'var(--muted-2)', marginBottom: 4 }}>{label}</div><div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', wordBreak: 'break-word' }}>{value}</div></div>)
}
function SecH({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted-2)', marginBottom: 12 }}>{children}</div>
}
