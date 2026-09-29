import { Fragment, useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { pill, initials, avatarFor } from '../lib/ui'
import { Pad, ErrorCard, Loading, Empty, Checkbox, Pager, ActiveFilters } from '../components/View'
import { useTableSelection } from '../lib/useTableSelection'
import { useBreakpoint } from '../lib/useBreakpoint'
import { multiFieldOr, PEOPLE_SEARCH_FIELDS } from '../lib/searchFilter'
import MobileFilterSheet from '../components/MobileFilterSheet'
import CampaignForm from '../components/CampaignForm'
import PersonProfile from '../components/PersonProfile'
import AssignNurturerDialog from '../components/AssignNurturerDialog'
import { addRecipientsToCampaign } from '../lib/campaignRecipients'
import { PROGRAMS, PROGRAM_BY_KEY, programsWithData } from '../lib/programs'
import { COHORT_PROGRAMMES, eligibilityCohort } from '../lib/cohorts'
import { usePagedQuery, useDebounced, fetchAllMatchingIds } from '../lib/usePagedQuery'
import { excludeTooLarge, EXCLUDE_TOO_LARGE_MESSAGE } from '../lib/coveredFilter'
import { ishaActivityLabel, applyIshaActivity, ISHA_ACTIVITY_OPTIONS } from '../lib/engagement'

// "samyama" -> "Ready now · Samyama"; "samyama:soon" -> "Ready soon · Samyama"
function readyLabel(v) {
  const [key, mode] = v.split(':')
  const c = COHORT_PROGRAMMES.find((x) => x.key === key)
  return `${mode === 'soon' ? 'Ready soon' : 'Ready now'} · ${c ? c.label : key}`
}

// `last_active_date` is the upstream Isha transaction date, not our contact with
// this person — calling it "Active" here was the same mistake the Volunteers list
// made. And the three options below were all gte/lt, which drop NULL, so the
// people with nothing in the column at all matched none of them and could not be
// listed. `none` is that missing door. See lib/engagement.js.
const RECENCY = [{ key: 'any', label: 'Isha activity · any time' }, ...ISHA_ACTIVITY_OPTIONS.map((o) => ({ key: o.v, label: o.label }))]

const daysAgoISO = (d) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10)
// Chips carry the year they did it: "Shoonya '23" reads very differently from
// "Shoonya '26", and without it the column says only that it happened, ever.
function progList(p) {
  return PROGRAMS.filter((pr) => p[pr.col]).map((pr) => {
    const y = String(p[pr.col]).slice(0, 4)
    return /^\d{4}$/.test(y) ? `${pr.chip} '${y.slice(2)}` : pr.chip
  })
}


// When they did the selected programme. Pairs with the programme dropdown; the
// recent windows are the outreach ones (a fresh graduate is at their most open),
// "before 2020" is the other end — people who did it long ago and drifted.
const PROG_WHEN = [
  { key: 'any', label: 'Did it \u00b7 any time', chip: 'Any time' },
  { key: '30', label: 'Did it \u00b7 last 30 days', chip: 'Last 30 days' },
  { key: '90', label: 'Did it \u00b7 last 90 days', chip: 'Last 90 days' },
  { key: '180', label: 'Did it \u00b7 last 180 days', chip: 'Last 180 days' },
  { key: 'year', label: 'Did it \u00b7 this year', chip: 'This year' },
  { key: 'old', label: 'Did it \u00b7 before 2020', chip: 'Before 2020' },
]

// Satsang attendance filter. "Never" is the cohort worth calling; the rest are
// recency windows over person_satsang.last_satsang.
const SATSANG = [
  { key: 'any', label: 'Satsang \u00b7 any', chip: 'Any' },
  { key: 'ever', label: 'Attended satsang \u00b7 ever', chip: 'Attended ever' },
  { key: '30', label: 'Attended satsang \u00b7 last 30 days', chip: 'Last 30 days' },
  { key: '90', label: 'Attended satsang \u00b7 last 90 days', chip: 'Last 90 days' },
  { key: '180', label: 'Attended satsang \u00b7 last 180 days', chip: 'Last 180 days' },
  { key: 'never', label: 'Never attended a satsang', chip: 'Never attended' },
]

export default function Meditators({ me, onToast, campaignDraft = null, onClearCampaignDraft, onDone, recipientDraft = null, onRecipientsDone, preset = null, onPresetConsumed }) {
  const { isPhone } = useBreakpoint()
  const [search, setSearch] = useState('')
  const debounced = useDebounced(search)
  const [prog, setProg] = useState('all')
  const [progKeys, setProgKeys] = useState(() => new Set(['ie', 'bsp', 'shoonya', 'samyama'])) // programmes with data (dynamic)
  useEffect(() => { programsWithData().then(setProgKeys) }, [])
  const [recency, setRecency] = useState('any')
  const [ieWindow, setIeWindow] = useState('any')   // 'any' | '60' — recently initiated
  // Smart list: "ready for <programme>". Resolved to person ids from the
  // generated person_eligibility view, so the cohort and the verdict on each
  // profile come from the same rules.
  const [ready, setReady] = useState('all')           // '' | '<key>' | '<key>:soon'
  const [readyIds, setReadyIds] = useState(null)      // null = off, 'loading', array, or { tooBroad }
  const [needsNurt, setNeedsNurt] = useState(false)
  const [coveredIds, setCoveredIds] = useState(null) // person ids WITH an active nurturer (to exclude)
  const sel = useTableSelection()
  const [showForm, setShowForm] = useState(false)
  const [showAssign, setShowAssign] = useState(false)
  const [assignIds, setAssignIds] = useState([])
  const [formIds, setFormIds] = useState([])
  const [resolving, setResolving] = useState(false)
  const [profileId, setProfileId] = useState(null)
  // Event + Status filters (fed by IPRS import): pick an event, then Attended / Registered / both.
  const [eventId, setEventId] = useState('all')
  const [attStatus, setAttStatus] = useState('all')
  const [eventOpts, setEventOpts] = useState([])
  const [eventPersonIds, setEventPersonIds] = useState(null) // null = no event filter; array = resolved ids
  // Satsang: 'any' | 'ever' | '30' | '90' | '180' | 'never'. Resolved to a person-id
  // set from person_satsang (portal attendance + the Ishangam date, whichever is later).
  // When they did the chosen programme. Only meaningful once a programme is
  // picked, so it appears next to it — same pattern as Event + Status.
  const [progWhen, setProgWhen] = useState('any')
  const [centre, setCentre] = useState('all')
  const [centres, setCentres] = useState([])
  const [satsang, setSatsang] = useState('any')
  const [satsangIds, setSatsangIds] = useState(null) // null = off, 'loading', or array
  useEffect(() => {
    supabase.from('centers').select('id, name').neq('id', 'all').order('name')
      .then(({ data }) => setCentres(data || []))
  }, [])
  useEffect(() => { supabase.rpc('meditator_events').then(({ data }) => setEventOpts(data || [])) }, [])
  // Resolve the chosen event+status to a person-id set the people query intersects with.
  useEffect(() => {
    if (eventId === 'all') { setEventPersonIds(null); return }
    let alive = true
    setEventPersonIds('loading')
    supabase.rpc('meditators_for_event', { p_activity: eventId, p_status: attStatus })
      .then(({ data }) => { if (alive) setEventPersonIds([...new Set((data || []).map((r) => r.person_id))]) })
    return () => { alive = false }
  }, [eventId, attStatus])

  useEffect(() => {
    if (satsang === 'any') { setSatsangIds(null); return }
    let alive = true
    setSatsangIds('loading')
    let q = supabase.from('person_satsang').select('person_id')
    if (satsang !== 'ever' && satsang !== 'never') q = q.gte('last_satsang', daysAgoISO(Number(satsang)))
    q.then(({ data }) => { if (alive) setSatsangIds([...new Set((data || []).map((r) => r.person_id))]) })
    return () => { alive = false }
  }, [satsang])

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
  // Land with the Dashboard's filter already applied — see Volunteers for why.
  useEffect(() => {
    if (!preset) return
    if (preset.ieWindow) setIeWindow(preset.ieWindow)
    if (preset.recency) setRecency(preset.recency)
    if (preset.ready) setReady(preset.ready)
    if (preset.needsNurt) setNeedsNurt(true)
    onPresetConsumed && onPresetConsumed()
  }, [preset, onPresetConsumed])
  useEffect(() => {
    if (ready === 'all') { setReadyIds(null); return }
    let alive = true
    setReadyIds('loading')
    const [key, mode] = ready.split(':')
    eligibilityCohort(key, mode === 'soon' ? 'ripening' : 'eligible').then((r) => {
      if (!alive) return
      setReadyIds(r.tooBroad ? { tooBroad: r.tooBroad } : r.ids || [])
    })
    return () => { alive = false }
  }, [ready])

  const applyFilters = useCallback(
    (q) => {
      q = q.eq('is_meditator', true)
      const pd = PROGRAM_BY_KEY[prog]
      if (pd && pd.col) {
        q = q.not(pd.col, 'is', null)
        if (progWhen !== 'any') {
          if (progWhen === 'year') q = q.gte(pd.col, new Date().getFullYear() + '-01-01')
          else if (progWhen === 'old') q = q.lt(pd.col, '2020-01-01')
          else q = q.gte(pd.col, daysAgoISO(Number(progWhen)))
        }
      }
      // Event filter: intersect with the resolved attendee/registrant set for the chosen event.
      if (Array.isArray(eventPersonIds)) {
        q = eventPersonIds.length ? q.in('id', eventPersonIds) : q.eq('id', '00000000-0000-0000-0000-000000000000')
      }
      if (centre !== 'all') q = q.eq('center_id', centre)
      q = applyIshaActivity(q, recency)
      // The single most time-sensitive cohort in the whole product: someone who has
      // just finished Inner Engineering is at their most open, and that window shuts.
      if (ieWindow === '60') q = q.gte('ie_any_date', daysAgoISO(60))
      if (needsNurt && Array.isArray(coveredIds) && coveredIds.length && !excludeTooLarge(coveredIds)) q = q.not('id', 'in', `(${coveredIds.join(',')})`)
      if (Array.isArray(satsangIds)) {
        if (satsang === 'never') {
          if (satsangIds.length && !excludeTooLarge(satsangIds)) q = q.not('id', 'in', `(${satsangIds.join(',')})`)
        } else {
          q = satsangIds.length ? q.in('id', satsangIds) : q.eq('id', '00000000-0000-0000-0000-000000000000')
        }
      }
      if (Array.isArray(readyIds)) q = readyIds.length ? q.in('id', readyIds) : q.eq('id', '00000000-0000-0000-0000-000000000000')
      const searchOr = multiFieldOr(debounced, PEOPLE_SEARCH_FIELDS) // name|phone|email|pincode, sanitized
      if (searchOr) q = q.or(searchOr)
      return q
    },
    [prog, progWhen, recency, ieWindow, debounced, needsNurt, coveredIds, eventPersonIds, readyIds, satsang, satsangIds, centre],
  )

  const fetchAllIds = useCallback(
    () => fetchAllMatchingIds(() => applyFilters(supabase.from('people').select('id')), 'id'),
    [applyFilters],
  )

  const buildPage = useCallback(
    () => applyFilters(
      supabase.from('people').select('id, full_name, phone, area, pincode, center_id, ie_date, ieo_date, ie_any_date, bsp_date, shoonya_date, samyama_date, yogasanas_date, surya_kriya_date, guru_puja_date, eoe_date, angamardhana_date, lom_date, bhutha_shuddhi_date, last_active_date', { count: 'exact' }),
    ).order('id', { ascending: true }),
    [applyFilters],
  )

  // Nurturer coverage, the event roster and the eligibility cohort each resolve to a
  // person-id set before the list query can be correct. Query only once all have settled.
  const filtersReady =
    !(needsNurt && !Array.isArray(coveredIds)) &&
    !(eventId !== 'all' && !Array.isArray(eventPersonIds)) &&
    readyIds !== 'loading' && satsangIds !== 'loading'

  const { rows, total, page, pageSize, loading, err, setPage, setPageSize, pageCount, reload: loadPage } =
    usePagedQuery(buildPage, { ready: filtersReady })

  // A new filter is a new list: back to page 1, selection dropped. `ready` and
  // `ieWindow` are in here now — they were not before, so arriving on the smart list
  // from page 5 of a different filter left you on page 5 of a list that may only have
  // two pages, looking at an empty screen. (Rows-per-page resets inside usePagedQuery.)
  useEffect(() => {
    setPage(0)
    sel.clear()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debounced, prog, progWhen, recency, needsNurt, eventId, attStatus, ready, ieWindow, satsang, centre, setPage])

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
  const selCount = sel.count(total)
  const isFullySelected = sel.headerState(total) === 'all'

  // Header checkbox = stage 1 of two-stage select-all: selects/deselects the CURRENT
  // PAGE only. Stage 2 ("Select all N matching this filter") lives in the pagination pill.
  const pageIds = rows ? rows.map((r) => r.id) : []
  const pageSelectedCount = pageIds.filter((id) => sel.isSelected(id)).length
  const pageHeaderState = pageIds.length === 0 ? 'none' : pageSelectedCount === 0 ? 'none' : pageSelectedCount === pageIds.length ? 'all' : 'partial'
  const togglePage = () => (pageSelectedCount === pageIds.length && pageIds.length > 0 ? sel.deselectIds(pageIds) : sel.selectIds(pageIds))
  const selStyle = { padding: isPhone ? '11px' : '8px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12, fontFamily: 'inherit', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', minHeight: isPhone ? 44 : undefined, flex: isPhone ? '1 1 calc(50% - 5px)' : undefined }
  const grid = '34px 2fr 1.6fr 1.2fr 1.1fr'

  // Removable chips for every active filter (+ search term).
  const activeFilterItems = [
    ...(debounced ? [{ key: 'q', label: 'Search', value: `"${debounced}"`, onRemove: () => setSearch('') }] : []),
    ...(prog !== 'all' ? [{ key: 'prog', label: 'Programme', value: PROGRAMS.find((p) => p.key === prog)?.label || prog, onRemove: () => setProg('all') }] : []),
    ...(eventId !== 'all' ? [{ key: 'event', label: 'Event', value: eventOpts.find((e) => String(e.id) === String(eventId))?.name || 'Event', onRemove: () => { setEventId('all'); setAttStatus('all') } }] : []),
    ...(eventId !== 'all' && attStatus !== 'all' ? [{ key: 'status', label: 'Status', value: attStatus === 'attended' ? 'Attended' : 'Registered', onRemove: () => setAttStatus('all') }] : []),
    ...(recency !== 'any' ? [{ key: 'recency', label: 'Isha activity', value: RECENCY.find((r) => r.key === recency)?.label || recency, onRemove: () => setRecency('any') }] : []),
    ...(needsNurt ? [{ key: 'nurt', label: 'Nurturer', value: 'Needs a nurturer', onRemove: () => setNeedsNurt(false) }] : []),
    ...(ieWindow !== 'any' ? [{ key: 'iew', label: 'Inner Engineering', value: 'Finished · last 60 days', onRemove: () => setIeWindow('any') }] : []),
    ...(ready !== 'all' ? [{ key: 'ready', label: 'Ready for', value: readyLabel(ready), onRemove: () => setReady('all') }] : []),
    ...(prog !== 'all' && progWhen !== 'any' ? [{ key: 'progwhen', label: 'Did it', value: PROG_WHEN.find((o) => o.key === progWhen)?.chip || progWhen, onRemove: () => setProgWhen('any') }] : []),
    ...(centre !== 'all' ? [{ key: 'centre', label: 'Centre', value: centres.find((c) => c.id === centre)?.name || centre, onRemove: () => setCentre('all') }] : []),
    ...(satsang !== 'any' ? [{ key: 'satsang', label: 'Satsang', value: SATSANG.find((o) => o.key === satsang)?.chip || satsang, onRemove: () => setSatsang('any') }] : []),
  ]
  const clearAllFilters = () => { setSearch(''); setProg('all'); setEventId('all'); setAttStatus('all'); setRecency('any'); setNeedsNurt(false); setReady('all'); setIeWindow('any'); setSatsang('any'); setCentre('all'); setProgWhen('any') }

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
                {total} on record
                <span className="mobile-hide"> · filter by programme and recent activity.</span>
              </>
            )}
          </div>
        </div>
        {/* On mobile this becomes the sticky bottom CTA below (one primary action per screen,
            thumb-reachable) instead of competing for space with the count text here. Hidden
            while a selection is active — the pagination pill's own Create-campaign action
            takes over then, so there's only ever one "create campaign" control on screen. */}
        {!recipientDraft && !isPhone && selCount === 0 && <button className="btn" disabled={resolving} onClick={openCampaign}>{Icon.campaigns(16)} {resolving ? 'Preparing…' : 'Create campaign'}</button>}
      </div>

      {err && <ErrorCard>Couldn't load meditators: {err}</ErrorCard>}

      {/* The exclude-by-id-list filter refuses past a safe size rather than
          erroring into an EMPTY list, which on this filter would read as
          "nobody needs a nurturer" — wrong in the most dangerous direction. */}
      {needsNurt && excludeTooLarge(coveredIds) && (
        <div className="card" style={{ padding: '11px 14px', marginBottom: 12, background: 'var(--pill-yellow-bg)', borderColor: '#E4D9A8' }}>
          <span style={{ fontSize: 13, color: 'var(--pill-yellow-fg)' }}>{EXCLUDE_TOO_LARGE_MESSAGE}</span>
        </div>
      )}
      {/* A cohort past the cap is refused, not truncated: showing the first 2,000
          would look like a finished list. Say the number and say why. */}
      {readyIds && readyIds.tooBroad && (
        <div className="card" style={{ padding: '11px 14px', marginBottom: 12, background: 'var(--pill-yellow-bg)', borderColor: '#E4D9A8' }}>
          <span style={{ fontSize: 13, color: 'var(--pill-yellow-fg)' }}>
            <strong>{readyIds.tooBroad.toLocaleString('en-IN')} people</strong> match “{readyLabel(ready)}” — too broad to be a call list, so the filter is not applied. Narrow it with another filter first.
          </span>
        </div>
      )}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: isPhone ? '11px 12px' : '8px 12px', minWidth: 200, flexBasis: isPhone ? '100%' : undefined }}>
          {Icon.search(15)}
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Name, phone, email, address or pincode…" style={{ border: 'none', outline: 'none', fontSize: 14, fontFamily: 'inherit', background: 'transparent', width: '100%', color: 'var(--ink)' }} />
        </div>
        <MobileFilterSheet count={(prog !== 'all' ? 1 : 0) + (recency !== 'any' ? 1 : 0) + (needsNurt ? 1 : 0) + (eventId !== 'all' ? 1 : 0) + (ready !== 'all' ? 1 : 0) + (ieWindow !== 'any' ? 1 : 0) + (satsang !== 'any' ? 1 : 0) + (centre !== 'all' ? 1 : 0) + (prog !== 'all' && progWhen !== 'any' ? 1 : 0)}>
          <select value={centre} onChange={(e) => setCentre(e.target.value)} style={selStyle}>
            <option value="all">All centres</option>
            {centres.map((c) => (<option key={c.id} value={c.id}>{c.name}</option>))}
          </select>
          <select value={prog} onChange={(e) => setProg(e.target.value)} style={selStyle}>
            <option value="all">All programmes</option>
            {PROGRAMS.filter((p) => progKeys.has(p.key)).map((p) => (<option key={p.key} value={p.key}>{p.label}</option>))}
          </select>
          {prog !== 'all' && (
            <select value={progWhen} onChange={(e) => setProgWhen(e.target.value)} style={selStyle}>
              {PROG_WHEN.map((o) => (<option key={o.key} value={o.key}>{o.label}</option>))}
            </select>
          )}
          <select value={eventId} onChange={(e) => setEventId(e.target.value)} style={selStyle}>
            <option value="all">All events</option>
            {eventOpts.map((ev) => (<option key={ev.id} value={ev.id}>{ev.name}{ev.activity_date ? ` · ${ev.activity_date}` : ''}</option>))}
          </select>
          {eventId !== 'all' && (
            <select value={attStatus} onChange={(e) => setAttStatus(e.target.value)} style={selStyle}>
              <option value="all">Attended + Registered</option>
              <option value="attended">Attended</option>
              <option value="registered">Registered</option>
            </select>
          )}
          <select value={ieWindow} onChange={(e) => setIeWindow(e.target.value)} style={selStyle}>
            <option value="any">Inner Engineering · any time</option>
            <option value="60">Finished IE · last 60 days</option>
          </select>
          <select value={recency} onChange={(e) => setRecency(e.target.value)} style={selStyle}>
            {RECENCY.map((r) => (<option key={r.key} value={r.key}>{r.label}</option>))}
          </select>
          <select value={needsNurt ? 'needs' : ''} onChange={(e) => setNeedsNurt(e.target.value === 'needs')} style={selStyle}>
            <option value="">Nurturer · any</option>
            <option value="needs">Needs a nurturer</option>
          </select>
          <select value={satsang} onChange={(e) => setSatsang(e.target.value)} style={selStyle}>
            {SATSANG.map((o) => (<option key={o.key} value={o.key}>{o.label}</option>))}
          </select>
          <select value={ready} onChange={(e) => setReady(e.target.value)} style={selStyle}>
            <option value="all">Ready for · any</option>
            {COHORT_PROGRAMMES.map((c) => (
              <Fragment key={c.key}>
                <option value={c.key}>Ready now · {c.label}</option>
                {c.hasRipening && <option value={`${c.key}:soon`}>Ready soon · {c.label}</option>}
              </Fragment>
            ))}
          </select>
        </MobileFilterSheet>
      </div>

      <ActiveFilters items={activeFilterItems} onClear={clearAllFilters} />

      <div className="card" style={{ overflow: 'hidden' }}>
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
                  {progList(p).map((t) => (<span key={t} className="pill" style={pill('var(--pill-rust-bg)', 'var(--pill-rust-fg)')}>{t}</span>))}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6 }}>{[p.area, p.pincode].filter(Boolean).join(' · ') || p.center_id || '—'}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>{ishaActivityLabel(p.last_active_date)}</div>
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
                {progList(p).map((t) => (<span key={t} className="pill" style={pill('var(--pill-rust-bg)', 'var(--pill-rust-fg)')}>{t}</span>))}
              </div>
              <div style={{ fontSize: 14, color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{[p.area, p.pincode].filter(Boolean).join(' · ') || p.center_id || '—'}</div>
              <div style={{ fontSize: 14, color: 'var(--muted)' }}>{ishaActivityLabel(p.last_active_date)}</div>
            </div>
          ))}
      </div>
      {!loading && total > 0 && (
        <Pager page={page} pageCount={pageCount} total={total} onPage={setPage} pageSize={pageSize} onPageSize={setPageSize} noun="meditators"
          bottomOffset={isPhone && !recipientDraft && selCount === 0 ? 84 : 12}
          selection={selCount > 0 ? {
            count: selCount, total, isFullySelected, onSelectAll: sel.selectAllMatching, onClear: sel.clear,
            actions: [
              ...(recipientDraft ? [] : [{ label: 'Assign to nurturer', onClick: openAssign, disabled: resolving }]),
              { label: recipientDraft ? (resolving ? 'Adding…' : 'Add to campaign') : (resolving ? 'Preparing…' : 'Create campaign'), onClick: recipientDraft ? addSelectedToCampaign : openCampaign, disabled: resolving, primary: true },
            ],
          } : null} />
      )}

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

      {isPhone && !recipientDraft && selCount === 0 && (
        <>
          {/* Clears the fixed bar below so the last table row stays reachable. Hidden
              while a selection is active — the pagination pill's Create-campaign
              action takes over then (see selection.actions above). */}
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
