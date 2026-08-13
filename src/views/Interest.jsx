import { useCallback, useEffect, useState } from 'react'
import { usePagedQuery, useDebounced, fetchAllMatchingIds } from '../lib/usePagedQuery'
import AssignNurturerDialog from '../components/AssignNurturerDialog'
import CallLogDialog from '../components/CallLogDialog'
import { supabase } from '../lib/supabase'
import { pill, initials, avatarFor } from '../lib/ui'
import { Pad, ErrorCard, Loading, Empty, Checkbox, Pager } from '../components/View'
import CampaignForm from '../components/CampaignForm'
import SidePanel, { PanelHeader } from '../components/SidePanel'
import { EI_STATUS, EI_STATUS_MAP } from '../components/EventInterestPanel'
import KebabMenu from '../components/KebabMenu'
import MobileFilterSheet from '../components/MobileFilterSheet'
import { PROGRAMS } from '../lib/programCatalog'
import { useBreakpoint } from '../lib/useBreakpoint'
import { multiFieldOr } from '../lib/searchFilter'
import { useTableSelection } from '../lib/useTableSelection'
import { addRecipientsToCampaign } from '../lib/campaignRecipients'
import { eventDays, fmtDay } from '../lib/planning'
import { fetchSkills, ensureSkill } from '../lib/skills'

// Interest types are DERIVED from existing data, not a new schema field:
//  - 'volunteering'  = volunteer_profiles rows whose `interests` text[] does NOT
//                       mention "ashram", PLUS event-linked event_interest rows
//                       (an event signup is still volunteering — the Event column
//                       tells the two apart).
//  - 'ashram'         = volunteer_profiles rows whose `interests` mentions "ashram".
//                       There's no dedicated Ashram-volunteering table/field today;
//                       this is a text-based split over the same standing-interest
//                       data, computed in the interest_inbox_list view.
//  - 'ieo'             = ie_completion_volunteer rows (Inner Engineering Online).
//  - 'advanced'        = advanced_interest rows (one row per person+programme).
const TYPE_PILLS = [
  { v: 'volunteering', label: 'Volunteering' },
  { v: 'ashram', label: 'Ashram Volunteering' },
  { v: 'ieo', label: 'IEO – Volunteering' },
  { v: 'advanced', label: 'Advanced Program' },
]
// Status vocabulary is shared VISUALLY (same 5-pill look as the old Event Interests
// tab, imported from EventInterestPanel) but NOT in the database: volunteer_profiles /
// ie_completion_volunteer / advanced_interest keep their own native status values
// (new/contacted/active/registered/done) — the view maps those onto this 5-bucket
// display model (status_bucket) for a consistent badge + filter row. Only event_interest
// rows can ever actually be "Declined" or "No Response".
const normPhone = (p) => (p || '').replace(/\D/g, '').slice(-10)
const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : null)
const stepOf = (s) => (['new', null, undefined].includes(s) ? 0 : s === 'contacted' ? 1 : 2)

function ago(d) {
  if (!d) return '—'
  const days = Math.floor((Date.now() - new Date(d).getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}
const waNum = (p) => (p || '').replace(/\D/g, '').replace(/^0+/, '').slice(-10)

// A labelled filter dimension. The label is what turns three pill strips from
// "which of these fifteen buttons am I on?" into three independent questions.
// A labelled control inside the Filters sheet. Replaces FilterRow, whose job was
// to caption a horizontally-scrolling strip of chips per dimension.
function FilterSelect({ label, value, onChange, options }) {
  const on = value !== 'all'
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 168, flex: '1 1 168px' }}>
      <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted-2)' }}>{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{ minHeight: 40, fontSize: 13.5, fontFamily: 'inherit', padding: '8px 10px', borderRadius: 9, background: '#fff', cursor: 'pointer',
          border: on ? '1.5px solid var(--orange)' : '1px solid var(--border)', color: on ? 'var(--ink)' : 'var(--ink-soft)' }}
      >
        {options.map((o) => <option key={o.v} value={o.v}>{o.label}</option>)}
      </select>
    </label>
  )
}

function actionsForEvent(status, contactedAt) {
  const s = status || 'interested'
  if (s === 'interested') return [{ label: 'Mark Contacted', to: 'contacted' }, { label: 'Approve', to: 'approved', primary: true }]
  if (s === 'contacted') return [{ label: 'Approve', to: 'approved', primary: true }, { label: 'Declined', to: 'declined' }, { label: 'No Response', to: 'no_response' }]
  if (s === 'approved') return [{ label: 'Undo', to: contactedAt ? 'contacted' : 'interested' }]
  if (s === 'declined' || s === 'no_response') return [{ label: 'Re-contact', to: 'contacted' }]
  return []
}

// Volunteers and meditators are not separate tables — both are flags (is_volunteer /
// is_meditator) on `people`. So this single phone-key lookup already matches ANY existing
// person (volunteer OR meditator OR neither); only a phone with no match anywhere creates a
// provisional record, stamped source='interest_import'. Dedupe is inherent: an existing
// meditator's phone hits their people row, so no second record is made.
async function ensurePersonId(name, phone) {
  const ph = normPhone(phone)
  if (ph) {
    const { data } = await supabase.from('people').select('id').eq('phone', ph).maybeSingle()
    if (data) return data.id
  }
  const { data, error } = await supabase.from('people').insert({ full_name: name, phone: ph || null, source: 'interest_import' }).select('id').single()
  if (error) throw error
  return data.id
}

export default function Interest({ onToast, eventScopeId = null, onScopeConsumed, recipientDraft = null, onRecipientsDone }) {
  const { isPhone } = useBreakpoint()

  const [search, setSearch] = useState('')
  const debounced = useDebounced(search)
  const [typeFilter, setTypeFilter] = useState('all')
  // Defaults to the untriaged queue (old Interest Inbox only ever showed status='new'
  // volunteering interest) — everyone else is one pill tap away via the status row,
  // not hidden entirely like before.
  const [statusFilter, setStatusFilter] = useState('interested')
  const [eventFilter, setEventFilter] = useState('all')
  const [evList, setEvList] = useState([])
  const [programFilter, setProgramFilter] = useState('all')
  const [areaFilter, setAreaFilter] = useState('all')
  const [areaOpts, setAreaOpts] = useState([]) // settings.volunteer_interest_areas

  const sel = useTableSelection()

  const [selRow, setSelRow] = useState(null)
  const [busy, setBusy] = useState(false)
  const [uid, setUid] = useState(null)
  const [assignFor, setAssignFor] = useState(null)   // person id -> shared AssignNurturerDialog
  const [logFor, setLogFor] = useState(null)         // {personId, name} -> shared CallLogDialog
  const [newTag, setNewTag] = useState('')
  const [skills, setSkills] = useState([])
  const [skillVocab, setSkillVocab] = useState([])
  const [newSkill, setNewSkill] = useState('')
  const [note, setNote] = useState('')
  const [campaignPid, setCampaignPid] = useState(null)
  const [showForm, setShowForm] = useState(false)
  const [formIds, setFormIds] = useState([])
  const [resolving, setResolving] = useState(false)
  // Triage with no feedback is demoralising, and this queue is 1,311 long. Counts
  // dispositions made in THIS sitting — deliberately not "today", because that
  // would need timestamps across four different tables and would be a claim the
  // screen cannot actually back up.
  const [handled, setHandled] = useState(0)
  const [addOpen, setAddOpen] = useState(false)
  const [scanOpen, setScanOpen] = useState(false)

  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => setUid(data.user?.id || null))
    fetchSkills().then(setSkillVocab).catch(() => setSkillVocab([]))
  }, [])

  // Load this person's skills when a row opens (they carry over to the Volunteers
  // tab automatically — same person_id). Rows without a resolved person_id yet
  // start empty; the first skill added resolves/creates the person.
  useEffect(() => {
    const pid = selRow?.person_id
    if (!pid) { setSkills([]); return }
    let alive = true
    supabase.from('person_skills').select('id, skill:skills(id, label)').eq('person_id', pid)
      .then(({ data }) => { if (alive) setSkills(data || []) })
    return () => { alive = false }
  }, [selRow?.person_id, selRow?.key])

  // Arriving from an event hub's "Volunteer Interests" jump → scope to that event.
  useEffect(() => { if (eventScopeId) { setEventFilter(eventScopeId); onScopeConsumed?.() } }, [eventScopeId, onScopeConsumed])

  // Distinct events for the event pill row — spans all pages. Re-read on reload:
  // a newly triaged interest can be the first one for its event, and the pill row
  // spans all pages so the page query alone would not surface it.
  const [evKey, setEvKey] = useState(0)
  useEffect(() => {
    supabase.from('event_interest').select('activity:activities!event_interest_activity_id_fkey(id, name, activity_date, start_date, end_date)').limit(5000)
      .then(({ data }) => {
        const m = new Map()
        for (const r of data || []) if (r.activity) m.set(r.activity.id, r.activity)
        setEvList([...m.values()])
      })
  }, [evKey])

  // Same vocabulary the public form offers, so the filter can never list an area
  // nobody can have been recorded against.
  useEffect(() => {
    supabase.from('settings').select('value').eq('key', 'volunteer_interest_areas').maybeSingle()
      .then(({ data }) => setAreaOpts(Array.isArray(data?.value) ? data.value : []))
  }, [])

  const applyFilters = useCallback((q) => {
    if (typeFilter !== 'all') q = q.eq('interest_type', typeFilter)
    if (statusFilter !== 'all') q = q.eq('status_bucket', statusFilter)
    if (eventFilter !== 'all') q = q.eq('event_id', eventFilter)
    if (programFilter !== 'all') q = q.eq('program', programFilter)
    if (areaFilter !== 'all') q = q.contains('interests', [areaFilter])
    // One haystack column instead of name-OR-phone: typing "shoonya",
    // "online calling" or an event name used to return nothing, which is exactly
    // what people came to the Inbox to look up. Terms are ANDed, so "priya
    // shoonya" narrows rather than widens.
    for (const term of (debounced || '').trim().toLowerCase().split(/\s+/).filter(Boolean)) {
      q = q.ilike('search_text', `%${term}%`)
    }
    return q
  }, [typeFilter, statusFilter, eventFilter, programFilter, areaFilter, debounced])

  const fetchAllKeys = useCallback(
    () => fetchAllMatchingIds(() => applyFilters(supabase.from('interest_inbox_list').select('key')), 'key'),
    [applyFilters],
  )

  const buildPage = useCallback(
    () => applyFilters(supabase.from('interest_inbox_list').select('*', { count: 'exact' }))
      .order('sort_date', { ascending: false })
      .order('key', { ascending: true }),
    [applyFilters],
  )

  const { rows, total, page, pageSize, loading, err, setPage, setPageSize, setRows, pageCount, reload: reloadRows } =
    usePagedQuery(buildPage)

  const reload = useCallback(() => { reloadRows(); setEvKey((k) => k + 1) }, [reloadRows])

  // A new filter is a new list: back to page 1, selection dropped. (Rows-per-page
  // resets the page inside usePagedQuery, so it is not repeated here.)
  useEffect(() => { setPage(0); sel.clear() /* eslint-disable-line react-hooks/exhaustive-deps */ }, [debounced, typeFilter, statusFilter, eventFilter, programFilter, areaFilter, setPage])

  const patchRow = (key, fields) => {
    setRows((prev) => (prev || []).map((r) => (r.key === key ? { ...r, ...fields } : r)))
    setSelRow((s) => (s && s.key === key ? { ...s, ...fields } : s))
  }

  // Resolve a set of selected row keys down to canonical people ids — phone-keyed,
  // deduped. Rows that already carry a person_id (volunteer_profiles / advanced_interest
  // / event_interest) resolve for free; ie_completion_volunteer rows have no person_id
  // (the table doesn't store one), so those resolve via ensurePersonId(name, phone) —
  // matching an existing person by phone, or provisioning one, same as Add/Import does.
  async function resolveKeysToPersonIds(keys) {
    const found = []
    for (let i = 0; i < keys.length; i += 500) {
      const { data, error } = await supabase.from('interest_inbox_list').select('key, person_id, phone, full_name').in('key', keys.slice(i, i + 500))
      if (error) throw error
      found.push(...(data || []))
    }
    const ids = new Set()
    for (const r of found) {
      if (r.person_id) { ids.add(r.person_id); continue }
      ids.add(await ensurePersonId(r.full_name, r.phone))
    }
    return [...ids]
  }

  async function openCampaign() {
    if (sel.count(total) === 0) { setFormIds([]); setShowForm(true); return }
    setResolving(true)
    try {
      const keys = await sel.resolveIds(fetchAllKeys)
      setFormIds(await resolveKeysToPersonIds(keys))
      setShowForm(true)
    } catch (e) { onToast('Could not resolve selection: ' + (e.message || e)) } finally { setResolving(false) }
  }

  async function addSelectedToCampaign() {
    if (!recipientDraft || sel.count(total) === 0) return
    setResolving(true)
    try {
      const keys = await sel.resolveIds(fetchAllKeys)
      const ids = await resolveKeysToPersonIds(keys)
      const { added, skipped } = await addRecipientsToCampaign(recipientDraft.campaignId, ids)
      onToast(`Added ${added} to “${recipientDraft.campaignName}”${skipped ? ` · ${skipped} already in it` : ''}.`)
      sel.clear()
      onRecipientsDone?.()
    } catch (e) { onToast('Could not add: ' + (e.message || e)) } finally { setResolving(false) }
  }

  async function ensurePersonFor(row) {
    if (row.person_id) return row.person_id
    const pid = await ensurePersonId(row.full_name, row.phone)
    patchRow(row.key, { person_id: pid })
    return pid
  }

  async function addTag() {
    const tag = newTag.trim()
    if (!tag || !selRow) return
    setBusy(true)
    try {
      const pid = await ensurePersonFor(selRow)
      const { error } = await supabase.from('manual_tags').insert({ person_id: pid, tag })
      if (error) throw error
      setNewTag(''); onToast(`Tag "${tag}" added to ${selRow.full_name}.`)
    } catch (e) { onToast((e.message || '').includes('duplicate') ? 'Tag already exists.' : 'Could not add tag: ' + (e.message || e)) } finally { setBusy(false) }
  }

  async function addSkillInbox(skillId) {
    if (!skillId || !selRow || skills.some((s) => s.skill?.id === skillId)) return
    setBusy(true)
    try {
      const pid = await ensurePersonFor(selRow)
      const { data, error } = await supabase.from('person_skills').insert({ person_id: pid, skill_id: skillId }).select('id, skill:skills(id, label)').single()
      if (error) throw error
      setSkills((s) => [...s, data])
    } catch (e) { onToast((e.message || '').includes('duplicate') ? 'Skill already added.' : 'Could not add skill: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function removeSkillInbox(id) {
    setSkills((s) => s.filter((x) => x.id !== id))
    const { error } = await supabase.from('person_skills').delete().eq('id', id)
    if (error) onToast('Could not remove skill.')
  }
  async function createSkillInbox() {
    const label = newSkill.trim(); if (!label) return
    setNewSkill('')
    try {
      const sk = await ensureSkill(label)
      setSkillVocab((v) => (v.some((x) => x.id === sk.id) ? v : [...v, sk].sort((a, b) => a.label.localeCompare(b.label))))
      await addSkillInbox(sk.id)
    } catch (e) { onToast('Could not add skill: ' + (e.message || e)) }
  }

  // Standing volunteering interest (volunteer_profiles) and IEO interest
  // (ie_completion_volunteer) both converge on the SAME 3-step pipeline and terminal
  // value ('active') — one function covers both sources.
  async function setVolStep(row, idx) {
    const status = idx === 0 ? 'new' : idx === 1 ? 'contacted' : 'active'
    setBusy(true)
    try {
      const { error } = await supabase.from(row.source_table).update({ status }).eq(row.id_col, row.source_id)
      if (error) throw error
      patchRow(row.key, { status_raw: status, status_bucket: status === 'active' ? 'approved' : status })
      onToast(`${row.full_name} → ${['New', 'Reached out', 'Converted'][idx]}.`)
    } catch (e) { onToast('Could not update: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function setAdvStep(row, idx) {
    const status = idx === 0 ? 'new' : idx === 1 ? 'contacted' : 'registered'
    setBusy(true)
    try {
      const { error } = await supabase.from('advanced_interest').update({ status }).eq('id', row.source_id)
      if (error) throw error
      patchRow(row.key, { status_raw: status, status_bucket: status === 'registered' ? 'approved' : status })
      onToast(`${row.full_name} · ${(row.program || '').toUpperCase()} → ${['New', 'Reached out', 'Registered'][idx]}.`)
    } catch (e) { onToast('Could not update: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function changeEventStatus(row, to) {
    const patch = { status: to }
    if (to === 'contacted') { patch.contacted_at = new Date().toISOString(); patch.contacted_by = uid || null; patch.approved_at = null; patch.approved_by = null }
    else if (to === 'approved') { patch.approved_at = new Date().toISOString(); patch.approved_by = uid || null }
    else if (to === 'interested') { patch.contacted_at = null; patch.contacted_by = null; patch.approved_at = null; patch.approved_by = null }
    setBusy(true)
    try {
      const { error } = await supabase.from('event_interest').update(patch).eq('id', row.source_id)
      if (error) throw error
      patchRow(row.key, { status_raw: to, status_bucket: to, contacted_at: 'contacted_at' in patch ? patch.contacted_at : row.contacted_at, approved_at: 'approved_at' in patch ? patch.approved_at : row.approved_at })
      onToast(`${row.full_name} → ${EI_STATUS_MAP[to]?.label || to}.`)
    } catch (e) { onToast('Could not update status: ' + (e.message || e)) } finally { setBusy(false) }
  }
  // ── What happens to this person next ───────────────────────────────────────
  //
  // A coordinator looking at 1,311 raised hands does not care that volunteering
  // interest lives in `volunteer_profiles`, advanced interest in
  // `advanced_interest` and event interest in `event_interest`. They see a person
  // who offered to help. The decision is the same everywhere: have we reached out,
  // and did it come to anything?
  //
  // The screen already normalises those three tables into ONE display vocabulary
  // (`status_bucket`). It never normalised the ACTIONS, so disposing of one person
  // meant: click the row, wait for a side panel, find the button among ten others,
  // click, close the panel, find your place again. Roughly five interactions per
  // person — about 6,500 for this queue, which is why the queue has never moved.
  //
  // This returns the one or two things worth doing to a row, for any source, so
  // they can sit IN the row. One tap, one person, no panel.
  function nextActions(row) {
    const b = row.status_bucket
    if (row.source === 'event') {
      return actionsForEvent(row.status_raw, row.contacted_at)
        .map((a) => ({ label: a.label, primary: a.primary, run: () => changeEventStatus(row, a.to) }))
    }
    const step = row.source === 'advanced' ? setAdvStep : setVolStep
    const done = row.source === 'advanced' ? 'Registered' : 'Signed up'
    if (b === 'contacted') {
      return [
        { label: done, primary: true, run: () => step(row, 2) },
        { label: 'No answer', run: () => step(row, 0) },
      ]
    }
    if (b === 'approved') return [{ label: 'Undo', run: () => step(row, 1) }]
    return [
      { label: 'Reached out', primary: true, run: () => step(row, 1) },
      { label: done, run: () => step(row, 2) },
    ]
  }

  // Inline row actions. Kept compact so they never crowd the person's name, and
  // stopPropagation so acting on a row does not also open the panel behind it.
  const RowActions = ({ row }) => (
    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }} onClick={(e) => e.stopPropagation()}>
      {nextActions(row).map((a) => (
        <button key={a.label} disabled={busy} onClick={() => { a.run(); setHandled((h) => h + 1) }}
          style={{
            padding: '6px 11px', fontSize: 12, fontWeight: 600, fontFamily: 'inherit', borderRadius: 7, cursor: busy ? 'default' : 'pointer',
            whiteSpace: 'nowrap', minHeight: isPhone ? 40 : 32,
            border: a.primary ? 'none' : '1px solid var(--border)',
            background: a.primary ? 'var(--orange)' : '#fff',
            color: a.primary ? '#fff' : 'var(--ink-soft)',
            opacity: busy ? 0.6 : 1,
          }}>{a.label}</button>
      ))}
    </div>
  )

  async function saveEventAvailability(row, dates) {
    try {
      const { error } = await supabase.from('event_interest').update({ availability_dates: dates }).eq('id', row.source_id)
      if (error) throw error
      patchRow(row.key, { availability_dates: dates })
    } catch (e) { onToast('Could not save availability: ' + (e.message || e)) }
  }
  async function saveNote() {
    if (!selRow) return
    const col = selRow.source === 'event' ? 'note' : selRow.source === 'volunteer_profile' ? 'screening_notes' : 'notes'
    setBusy(true)
    try {
      const { error } = await supabase.from(selRow.source_table).update({ [col]: note }).eq(selRow.id_col, selRow.source_id)
      if (error) throw error
      patchRow(selRow.key, { note })
      onToast('Comment saved.')
    } catch (e) { onToast('Could not save comment: ' + (e.message || e)) } finally { setBusy(false) }
  }

  // Opens the SAME dialog the profile, Nurturing and Campaigns use. It used to be a
  // one-tap button that inserted `reachability: 'answered'` with the remark "Logged
  // from Interest inbox" — every call recorded as answered whether or not it was, and
  // no way to write down what the person actually said. A record that cannot be wrong
  // is a record that cannot be right either.
  async function logContact() {
    setBusy(true)
    try {
      const pid = await ensurePersonFor(selRow)
      // CallLogDialog is journey-scoped, so reuse this person's newest journey or
      // open one — the same resolution the old one-tap button did.
      const { data: ex } = await supabase.from('journeys').select('id').eq('person_id', pid).order('created_at', { ascending: false }).limit(1)
      let jid = ex?.[0]?.id
      if (!jid) {
        const { data: nj, error } = await supabase.from('journeys').insert({ person_id: pid, type: 'volunteer_nurture', status: 'active' }).select('id').single()
        if (error) throw error
        jid = nj.id
      }
      setLogFor({ journeyId: jid, personId: pid, name: selRow.full_name, phone: selRow.phone })
    } catch (e) { onToast('Could not open: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function convertVolunteer() {
    setBusy(true)
    try {
      const pid = await ensurePersonFor(selRow)
      let e = (await supabase.from('people').update({ is_volunteer: true }).eq('id', pid)).error; if (e) throw e
      const payload = { person_id: pid, status: 'active', interest_source: selRow.source === 'ieo' ? 'ieo' : 'interest_inbox' }
      if (selRow.interests && selRow.interests.length) payload.interests = selRow.interests
      e = (await supabase.from('volunteer_profiles').upsert(payload, { onConflict: 'person_id' })).error; if (e) throw e
      if (selRow.source !== 'volunteer_profile') await supabase.from(selRow.source_table).update({ status: 'active' }).eq(selRow.id_col, selRow.source_id)
      patchRow(selRow.key, { status_raw: 'active', status_bucket: 'approved' })
      onToast(`${selRow.full_name} converted to volunteer.`)
    } catch (e) { onToast('Could not convert: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function markMeditator() {
    setBusy(true)
    try { const pid = await ensurePersonFor(selRow); const { error } = await supabase.from('people').update({ is_meditator: true }).eq('id', pid); if (error) throw error; onToast(`${selRow.full_name} marked as a meditator.`) }
    catch (e) { onToast('Could not mark: ' + (e.message || e)) } finally { setBusy(false) }
  }
  // Opens the SAME dialog the profile and the population screens use.
  //
  // This previously inserted into `nurturer_assignments` (meditator_id / nurturer_id),
  // while every other screen in the app reads and writes `nurturing_assignments`
  // (cared_person_id / nurturer_person_id). Assigning from here therefore wrote a row
  // nothing else has ever read: the person stayed in "needs a nurturer" on Volunteers
  // and Meditators, never appeared on the nurturer's roster in Nurturing, and showed
  // no nurturer on their own profile — while the coordinator was told it worked.
  async function assignNurturer() {
    setBusy(true)
    try { setAssignFor(await ensurePersonFor(selRow)) }
    catch (e) { onToast('Could not open: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function addToCallList() {
    setBusy(true)
    try { const pid = await ensurePersonFor(selRow); setCampaignPid(pid) } catch (e) { onToast('Could not prepare: ' + (e.message || e)) } finally { setBusy(false) }
  }

  // The public interest form is a standing link (no per-event token), so this is
  // just the app's own URL with the route on it — works from any deploy path.
  async function copyPublicFormLink() {
    const link = `${window.location.origin}${window.location.pathname}#programmes`
    try {
      await navigator.clipboard.writeText(link)
      onToast('Public form link copied — share it or turn it into a QR code.')
    } catch {
      onToast('Link: ' + link)
    }
  }

  function exportCsv() {
    const header = ['Name', 'Phone', 'Interest type', 'Status', 'Event']
    const csvRows = (rows || []).map((r) => [r.full_name, r.phone, TYPE_PILLS.find((t) => t.v === r.interest_type)?.label || r.interest_type, EI_STATUS_MAP[r.status_bucket]?.label || r.status_bucket, r.event_name || '—'])
    const csv = [header, ...csvRows].map((r) => r.map((c) => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' })); a.download = 'interest-inbox.csv'; a.click(); URL.revokeObjectURL(a.href)
    onToast(`Exported ${(rows || []).length} rows.`)
  }

  const selCount = sel.count(total)
  const isFullySelected = sel.headerState(total) === 'all'
  const pageIds = rows ? rows.map((r) => r.key) : []
  const pageSelectedCount = pageIds.filter((id) => sel.isSelected(id)).length
  const pageHeaderState = pageIds.length === 0 ? 'none' : pageSelectedCount === 0 ? 'none' : pageSelectedCount === pageIds.length ? 'all' : 'partial'
  const togglePage = () => (pageSelectedCount === pageIds.length && pageIds.length > 0 ? sel.deselectIds(pageIds) : sel.selectIds(pageIds))

  const activeEvent = evList.find((e) => e.id === eventFilter)
  const segmentLabel = [
    typeFilter !== 'all' ? TYPE_PILLS.find((t) => t.v === typeFilter)?.label : null,
    statusFilter !== 'all' ? EI_STATUS_MAP[statusFilter]?.label : null,
    activeEvent ? activeEvent.name : null,
  ].filter(Boolean).join(' · ')

  const btn = { padding: '9px 13px', fontSize: 12 }
  // Actions get a column of their own — the disposition is the point of the screen,
  // not a detail hidden behind a row click.
  const grid = '34px 2fr 0.9fr 1.1fr 1fr 1.5fr'

  return (
    <Pad>
      {recipientDraft && (
        <div className="card" style={{ padding: '12px 16px', marginBottom: 14, background: '#FBF1E4', borderColor: '#E7C9B8', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 14, color: 'var(--rust)', fontWeight: 600 }}>Adding to “{recipientDraft.campaignName}” — select people, then Add to campaign.</div>
          <button className="btn btn-ghost" style={{ marginLeft: 'auto', fontSize: 12, padding: '5px 10px' }} onClick={() => onRecipientsDone && onRecipientsDone()}>Cancel</button>
        </div>
      )}

      {/* The public form writes straight into the two tables this inbox already
          unions, so there is nothing to "open" — the only thing a coordinator
          needs from it is the link to hand out. */}
      <div className="interest-toolbar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: isPhone ? '11px 12px' : '8px 12px', minWidth: 190, flexBasis: isPhone ? '100%' : undefined }}>
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, phone, programme, area…" style={{ border: 'none', outline: 'none', fontSize: 14, fontFamily: 'inherit', background: 'transparent', width: '100%', color: 'var(--ink)' }} />
        </div>
        {isPhone ? (
          <KebabMenu items={[
            { label: 'Copy public form link', onClick: copyPublicFormLink },
            { label: 'Scan / match form', onClick: () => setScanOpen(true) },
            { label: 'Add / import', onClick: () => setAddOpen(true) },
            { label: 'Export', onClick: exportCsv },
          ]} />
        ) : (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-ghost" style={btn} onClick={copyPublicFormLink}>Copy public form link</button>
            <button className="btn btn-ghost" style={btn} onClick={() => setScanOpen(true)}>Scan / match form</button>
            <button className="btn btn-ghost" style={btn} onClick={() => setAddOpen(true)}>Add / import</button>
            <button className="btn btn-ghost" style={btn} onClick={exportCsv}>Export</button>
          </div>
        )}
      </div>
      {err && <ErrorCard>Couldn't load interest inbox: {err}</ErrorCard>}

      <div style={{ marginBottom: 10, fontSize: 14, color: 'var(--muted)', display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
        <span>{loading ? 'Loading…' : `${total.toLocaleString('en-IN')} volunteer interest${total === 1 ? '' : 's'}`}</span>
        {handled > 0 && (
          <span className="pill" style={pill('var(--success-bg)', 'var(--success-fg)')}>
            {handled} handled in this sitting
          </span>
        )}
      </div>

      {/* Was three stacked rows of pills — 17 chips above the list, and the Event
          row grew by one every time an event was created. Worse, none of them
          covered the two things this inbox now collects (programme, volunteering
          area), so the questions people actually came to ask were the ones they
          could not ask. Everything is behind one Filters button now; the smart
          search box below carries the common case. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 14 }}>
        <MobileFilterSheet
          always
          count={(typeFilter !== 'all' ? 1 : 0) + (statusFilter !== 'all' ? 1 : 0) + (eventFilter !== 'all' ? 1 : 0) + (programFilter !== 'all' ? 1 : 0) + (areaFilter !== 'all' ? 1 : 0)}
        >
          <FilterSelect label="Kind" value={typeFilter} onChange={setTypeFilter}
            options={[{ v: 'all', label: 'All kinds' }, ...TYPE_PILLS]} />
          <FilterSelect label="Stage" value={statusFilter} onChange={setStatusFilter}
            options={[{ v: 'all', label: 'Any stage' }, ...EI_STATUS]} />
          <FilterSelect label="Programme" value={programFilter} onChange={setProgramFilter}
            options={[{ v: 'all', label: 'Any programme' }, ...PROGRAMS.map((p) => ({ v: p.key, label: p.label }))]} />
          {areaOpts.length > 0 && (
            <FilterSelect label="Volunteering" value={areaFilter} onChange={setAreaFilter}
              options={[{ v: 'all', label: 'Any area' }, ...areaOpts.map((a) => ({ v: a, label: a }))]} />
          )}
          {evList.length > 0 && (
            <FilterSelect label="Event" value={eventFilter} onChange={setEventFilter}
              options={[{ v: 'all', label: 'Any event' }, ...evList.map((e) => ({ v: e.id, label: e.name }))]} />
          )}
        </MobileFilterSheet>
        {(typeFilter !== 'all' || statusFilter !== 'all' || eventFilter !== 'all' || programFilter !== 'all' || areaFilter !== 'all') && (
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 11px' }}
            onClick={() => { setTypeFilter('all'); setStatusFilter('all'); setEventFilter('all'); setProgramFilter('all'); setAreaFilter('all') }}>
            Clear filters
          </button>
        )}
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        {isPhone ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel)' }}>
            <Checkbox state={pageHeaderState} onClick={(e) => { e.stopPropagation(); togglePage() }} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)' }}>{selCount > 0 ? `${selCount} selected` : 'Select this page'}</span>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, padding: '13px 20px', borderBottom: '1px solid var(--border)', fontSize: 12, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, background: 'var(--panel)', alignItems: 'center' }}>
            <Checkbox state={pageHeaderState} onClick={(e) => { e.stopPropagation(); togglePage() }} />
            <span>Volunteer</span>
            <span>Status</span>
            <span>Interest type</span>
            <span>Event</span>
            <span>What next</span>
          </div>
        )}

        {loading && <Loading label="Loading interest inbox…" />}
        {!loading && rows.length === 0 && <Empty label="Nothing to triage here." />}

        {!loading && isPhone && rows.map((r, i) => (
          <div key={r.key} className="rowhover" onClick={() => { setSelRow(r); setNote(r.note || '') }}
            style={{ display: 'flex', gap: 12, padding: 14, borderBottom: '1px solid #F1E9DB', alignItems: 'flex-start', cursor: 'pointer', background: selRow?.key === r.key ? '#FBF1E6' : undefined }}>
            <div style={{ paddingTop: 2, minHeight: 44, display: 'flex', alignItems: 'center' }}>
              <Checkbox state={sel.isSelected(r.key)} onClick={(e) => { e.stopPropagation(); sel.toggle(r.key) }} />
            </div>
            <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(r.full_name)}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ fontSize: 16, fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.full_name}</div>
                <span className="pill" style={EI_STATUS_MAP[r.status_bucket]?.pill}>{EI_STATUS_MAP[r.status_bucket]?.label || r.status_bucket}</span>
              </div>
              <div style={{ fontSize: 12, color: r.phone ? 'var(--muted)' : 'var(--red)', marginTop: 2 }}>{r.phone || 'No phone on record'}</div>
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 4, flexWrap: 'wrap' }}>
                <span className="pill" style={pill('var(--pill-orange-bg)', 'var(--pill-orange-fg)')}>{TYPE_PILLS.find((t) => t.v === r.interest_type)?.label || r.interest_type}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{r.event_name || '—'}</span>
              </div>
              <div style={{ marginTop: 10 }}><RowActions row={r} /></div>
            </div>
          </div>
        ))}

        {!loading && !isPhone && rows.map((r, i) => (
          <div key={r.key} className="rowhover" onClick={() => { setSelRow(r); setNote(r.note || '') }}
            style={{ display: 'grid', gridTemplateColumns: grid, gap: 14, padding: '13px 20px', borderBottom: '1px solid #F1E9DB', alignItems: 'center', cursor: 'pointer', background: selRow?.key === r.key ? '#FBF1E6' : undefined }}>
            <Checkbox state={sel.isSelected(r.key)} onClick={(e) => { e.stopPropagation(); sel.toggle(r.key) }} />
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(r.full_name)}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.full_name}</div>
                <div style={{ fontSize: 12, color: r.phone ? 'var(--muted)' : 'var(--red)', marginTop: 1 }}>{r.phone || 'No phone on record'}</div>
              </div>
            </div>
            <div><span className="pill" style={EI_STATUS_MAP[r.status_bucket]?.pill}>{EI_STATUS_MAP[r.status_bucket]?.label || r.status_bucket}</span></div>
            <div><span className="pill" style={pill('var(--pill-orange-bg)', 'var(--pill-orange-fg)')}>{TYPE_PILLS.find((t) => t.v === r.interest_type)?.label || r.interest_type}</span></div>
            <div style={{ fontSize: 14, color: 'var(--ink-soft)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.event_name || '—'}</div>
            <RowActions row={r} />
          </div>
        ))}
      </div>

      {!loading && total > 0 && (
        <Pager page={page} pageCount={pageCount} total={total} onPage={setPage} pageSize={pageSize} onPageSize={setPageSize} noun="interests"
          selection={selCount > 0 ? {
            count: selCount, total, isFullySelected, onSelectAll: sel.selectAllMatching, onClear: sel.clear,
            actions: [{
              label: recipientDraft ? (resolving ? 'Adding…' : 'Add to campaign') : (resolving ? 'Preparing…' : 'Create Campaign'),
              onClick: recipientDraft ? addSelectedToCampaign : openCampaign, disabled: resolving, primary: true,
            }],
          } : null} />
      )}

      {selRow && (
        <SidePanel onClose={() => setSelRow(null)}>
          <PanelHeader onClose={() => setSelRow(null)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div style={{ width: 46, height: 46, borderRadius: '50%', background: avatarFor(2), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 600 }}>{initials(selRow.full_name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 3px' }}>{selRow.full_name}</h2>
                <div style={{ fontSize: 14, color: 'var(--muted)' }}>{selRow.event_name || (selRow.program ? selRow.program.toUpperCase() : TYPE_PILLS.find((t) => t.v === selRow.interest_type)?.label)} · via {selRow.src || 'unknown'}</div>
              </div>
              <span className="pill" style={pill('var(--pill-orange-bg)', 'var(--pill-orange-fg)')}>{TYPE_PILLS.find((t) => t.v === selRow.interest_type)?.label || selRow.interest_type}</span>
              <span className="pill" style={EI_STATUS_MAP[selRow.status_bucket]?.pill}>{EI_STATUS_MAP[selRow.status_bucket]?.label || selRow.status_bucket}</span>
            </div>
          </PanelHeader>
          <div style={{ padding: '20px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', background: '#FBF6EC', border: '1px dashed var(--border)', borderRadius: 9, padding: '10px 13px' }}>
              <div style={{ width: 26, height: 26, borderRadius: 6, background: '#F3E3D2', color: 'var(--rust)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M12 21c4-2.5 7-6 7-10a7 7 0 0 0-14 0c0 4 3 7.5 7 10Z" /></svg>
              </div>
              <div style={{ fontSize: 14, color: 'var(--ink-soft)' }}>
                <strong style={{ color: 'var(--ink)' }}>From:</strong> {selRow.event_name || selRow.program?.toUpperCase() || TYPE_PILLS.find((t) => t.v === selRow.interest_type)?.label}
                {fmtDate(selRow.sort_date) ? ` · added ${fmtDate(selRow.sort_date)}` : ''}
              </div>
            </div>

            {selRow.source === 'event' ? (
              <>
                <div className="card" style={{ padding: 20 }}>
                  <SecH>Contact &amp; event</SecH>
                  <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : '1fr 1fr', gap: '14px 22px' }}>
                    <F label="Phone" value={selRow.phone || 'No phone on record'} />
                    <F label="Event" value={selRow.event_name || '—'} />
                    {selRow.contacted_at && <F label="Contacted" value={`${fmtDate(selRow.contacted_at)} · ${ago(selRow.contacted_at)}`} />}
                    {selRow.approved_at && <F label="Approved" value={`${fmtDate(selRow.approved_at)} · ${ago(selRow.approved_at)}`} />}
                  </div>
                </div>
                <div className="card" style={{ padding: 18 }}>
                  <SecH>Status</SecH>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {actionsForEvent(selRow.status_raw, selRow.contacted_at).map((a) => (
                      <button key={a.to + a.label} disabled={busy} onClick={() => changeEventStatus(selRow, a.to)}
                        style={{ fontSize: 14, fontWeight: 600, padding: '9px 15px', borderRadius: 9, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1,
                          border: a.primary ? 'none' : '1px solid var(--border)', background: a.primary ? 'linear-gradient(150deg, var(--orange-2), var(--orange-3))' : '#fff', color: a.primary ? '#fff' : 'var(--ink-soft)' }}>{a.label}</button>
                    ))}
                  </div>
                </div>
                <EventAvailability row={selRow} isPhone={isPhone} onSave={(dates) => saveEventAvailability(selRow, dates)} />
              </>
            ) : (
              <>
                <div className="card" style={{ padding: 20 }}>
                  <SecH>Form responses</SecH>
                  <div style={{ display: 'grid', gridTemplateColumns: isPhone ? '1fr' : '1fr 1fr', gap: '14px 22px' }}>
                    <F label="Phone" value={selRow.phone || 'No phone on record'} />
                    <F label="Availability" value={selRow.preferred_timing || '—'} />
                    {selRow.source === 'advanced'
                      ? <F label="Programme" value={(selRow.program || '—').toUpperCase()} />
                      : <F label="Preferred activity" value={(selRow.interests || []).join(', ') || selRow.program || '—'} />}
                    <F label="Origin" value={selRow.source === 'ieo' ? 'IEO (Inner Engineering Online)' : selRow.src || '—'} />
                  </div>
                </div>
                <div className="card" style={{ padding: '16px 20px' }}>
                  <SecH>Status</SecH>
                  {selRow.source === 'advanced'
                    ? <Stepper labels={['New', 'Reached out', 'Registered']} idx={stepOf(selRow.status_raw)} busy={busy} onStep={(i) => setAdvStep(selRow, i)} />
                    : <Stepper labels={['New', 'Reached out', 'Converted']} idx={stepOf(selRow.status_raw)} busy={busy} onStep={(i) => setVolStep(selRow, i)} />}
                </div>
              </>
            )}

            <div className="card" style={{ padding: 20 }}>
              <SecH>Actions</SecH>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12, alignItems: 'center' }}>
                <a className="btn btn-primary" href={selRow.phone ? `tel:${selRow.phone}` : undefined} style={{ ...btn, textDecoration: 'none', opacity: selRow.phone ? 1 : 0.5, pointerEvents: selRow.phone ? 'auto' : 'none' }}>Call</a>
                <a className="btn btn-ghost" href={selRow.phone ? `https://wa.me/91${waNum(selRow.phone)}` : undefined} target="_blank" rel="noreferrer" style={{ ...btn, textDecoration: 'none', opacity: selRow.phone ? 1 : 0.5, pointerEvents: selRow.phone ? 'auto' : 'none' }}>Message</a>
                {selRow.source !== 'event' && (isPhone ? (
                  <KebabMenu items={[
                    { label: 'Log contact', onClick: logContact, disabled: busy },
                    selRow.source === 'advanced'
                      ? { label: 'Mark → Meditators', onClick: markMeditator, disabled: busy }
                      : { label: 'Convert to volunteer', onClick: convertVolunteer, disabled: busy },
                    { label: 'Add to call list', onClick: addToCallList, disabled: busy },
                  ]} />
                ) : (
                  <>
                    <button className="btn btn-ghost" style={btn} disabled={busy} onClick={logContact}>Log contact</button>
                    {selRow.source === 'advanced'
                      ? <button className="btn btn-ghost" style={btn} disabled={busy} onClick={markMeditator}>Mark → Meditators</button>
                      : <button className="btn btn-ghost" style={btn} disabled={busy} onClick={convertVolunteer}>Convert to volunteer</button>}
                    <button className="btn btn-ghost" style={btn} disabled={busy} onClick={addToCallList}>Add to call list</button>
                  </>
                ))}
                {selRow.source === 'event' && (
                  <button className="btn btn-ghost" style={btn} disabled={busy} onClick={addToCallList}>Add to call list</button>
                )}
              </div>
              {selRow.source !== 'event' && (
                <button className="btn btn-ghost" style={{ ...btn, width: '100%', justifyContent: 'center' }} disabled={busy} onClick={assignNurturer}>Assign nurturer…</button>
              )}
              {selRow.source !== 'event' && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <input value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTag()} placeholder="Add a tag…" style={{ flex: 1, padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12, fontFamily: 'inherit', background: '#fff', outline: 'none' }} />
                  <button className="btn btn-ghost" style={btn} disabled={busy} onClick={addTag}>Add tag</button>
                </div>
              )}
            </div>

            <div className="card" style={{ padding: 20 }}>
              <SecH>Skills</SecH>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {skills.length === 0 && <span style={{ fontSize: 13, color: 'var(--muted-2)' }}>No skills added.</span>}
                {skills.map((s) => (
                  <span key={s.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12, fontWeight: 600, color: '#fff', background: '#33507D', padding: '3px 10px', borderRadius: 7 }}>
                    {s.skill?.label}<span onClick={() => removeSkillInbox(s.id)} style={{ cursor: 'pointer', opacity: 0.8 }}>✕</span>
                  </span>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
                <select value="" disabled={busy} onChange={(e) => { addSkillInbox(e.target.value); e.target.value = '' }} style={{ flex: 1, minWidth: 160, padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12, fontFamily: 'inherit', background: '#fff', outline: 'none' }}>
                  <option value="" disabled>Pick a skill…</option>
                  {skillVocab.filter((v) => !skills.some((s) => s.skill?.id === v.id)).map((v) => (<option key={v.id} value={v.id}>{v.label}</option>))}
                </select>
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <input value={newSkill} onChange={(e) => setNewSkill(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && createSkillInbox()} placeholder="Add a new skill…" style={{ flex: 1, padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12, fontFamily: 'inherit', background: '#fff', outline: 'none' }} />
                <button className="btn btn-ghost" style={btn} disabled={busy} onClick={createSkillInbox}>Add skill</button>
              </div>
            </div>

            <div className="card" style={{ padding: 18 }}>
              <SecH>Comments</SecH>
              <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={4} placeholder="Notes on availability, preferences, etc…"
                style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 14, fontFamily: 'inherit', background: '#fff', color: 'var(--ink)', outline: 'none', resize: 'vertical' }} />
              <button className="btn btn-ghost" style={{ marginTop: 10, fontSize: 12 }} disabled={busy || note === (selRow.note || '')} onClick={saveNote}>Save comment</button>
            </div>
          </div>
        </SidePanel>
      )}

      {showForm && (
        <CampaignForm audience="volunteer" personIds={formIds} eventId={eventFilter !== 'all' ? eventFilter : null}
          defaultType="messaging" segmentLabel={`From Interest Inbox${segmentLabel ? ` · ${segmentLabel}` : ''}`}
          onClose={() => setShowForm(false)} onToast={onToast} onCreated={() => sel.clear()} />
      )}
      {campaignPid && <CampaignForm audience={selRow?.source === 'advanced' ? 'meditator' : 'volunteer'} personIds={[campaignPid]} defaultType="messaging" segmentLabel={selRow?.full_name || ''} onClose={() => setCampaignPid(null)} onToast={onToast} />}
      {assignFor && (
        <AssignNurturerDialog personIds={[assignFor]} label={selRow?.full_name || 'person'} me={{ id: uid }}
          onClose={() => setAssignFor(null)} onToast={onToast} onDone={() => { setAssignFor(null); reload() }} />
      )}
      {logFor && (
        <CallLogDialog
          journey={{ id: logFor.journeyId, person_id: logFor.personId, person: { full_name: logFor.name, phone: logFor.phone } }}
          myId={uid}
          onClose={() => setLogFor(null)}
          onSaved={reload}
          onToast={onToast}
        />
      )}
      {addOpen && <AddImport onClose={() => setAddOpen(false)} onToast={onToast} onDone={() => { setAddOpen(false); reload() }} />}
      {scanOpen && <ScanMatch onClose={() => setScanOpen(false)} onToast={onToast} onDone={() => { setScanOpen(false); reload() }} />}
    </Pad>
  )
}

// Availability day chips for an event-linked interest row — mirrors EventInterestPanel's
// InterestDetail availability editor, scoped to this one row's event.
function EventAvailability({ row, isPhone, onSave }) {
  const [days, setDays] = useState([])
  useEffect(() => {
    let alive = true
    if (!row.event_id) { setDays([]); return }
    supabase.from('activities').select('start_date, end_date, activity_date').eq('id', row.event_id).maybeSingle()
      .then(({ data }) => { if (alive && data) setDays(eventDays(data.start_date || data.activity_date, data.end_date)) })
    return () => { alive = false }
  }, [row.event_id])
  if (!days.length) return null
  const avail = row.availability_dates || []
  const allSelected = days.length > 0 && days.every((d) => avail.includes(d))
  const toggleDay = (d) => onSave(avail.includes(d) ? avail.filter((x) => x !== d) : [...avail, d].sort())
  const toggleAll = () => onSave(allSelected ? [] : [...days])
  const chip = (on) => ({ fontSize: 12, fontWeight: 600, padding: '6px 11px', borderRadius: 8, cursor: 'pointer', border: on ? '1px solid var(--orange)' : '1px solid var(--border)', background: on ? '#F6E8D8' : '#fff', color: on ? 'var(--orange)' : 'var(--muted)' })
  return (
    <div className="card" style={{ padding: 18 }}>
      <SecH>Availability</SecH>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {days.length > 1 && <button onClick={toggleAll} style={chip(allSelected)}>All Days</button>}
        {days.map((d, di) => (<button key={d} onClick={() => toggleDay(d)} style={chip(avail.includes(d))}>Day {di + 1} · {fmtDay(d)}</button>))}
      </div>
    </div>
  )
}

function F({ label, value }) {
  return (<div><div style={{ fontSize: 12, color: 'var(--muted-2)', marginBottom: 4 }}>{label}</div><div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', wordBreak: 'break-word' }}>{value}</div></div>)
}
function SecH({ children }) {
  return <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted-2)', marginBottom: 13 }}>{children}</div>
}
function Stepper({ labels, idx, busy, onStep }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      {labels.map((label, i) => {
        const active = idx >= i
        return (
          <div key={label} style={{ display: 'contents' }}>
            {i > 0 && <div style={{ flex: 1, height: 2, background: active ? 'var(--orange)' : '#EFE7D8' }} />}
            <button disabled={busy} onClick={() => onStep(i)} style={{ border: 'none', cursor: 'pointer', fontFamily: 'inherit', fontSize: 12, fontWeight: 600, padding: '7px 13px', borderRadius: 9, background: active ? 'var(--orange)' : '#F1EADD', color: active ? '#fff' : 'var(--muted)' }}>{label}</button>
          </div>
        )
      })}
    </div>
  )
}

// --- Add / import: pick target SEGMENT; always resolve to a canonical people row by phone ---
export function AddImport({ onClose, onToast, onDone, lockEventId = null }) {
  const [mode, setMode] = useState('search') // 'search' | 'single' | 'import'
  const [segment, setSegment] = useState(lockEventId ? 'event' : 'volunteering')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [program, setProgram] = useState('bsp')
  const [csv, setCsv] = useState('')
  const [events, setEvents] = useState([])
  const [eventId, setEventId] = useState(lockEventId || '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  // Search-and-add existing people (volunteers, meditators or anyone on record).
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [added, setAdded] = useState({}) // person_id -> true (added this session)
  const [addingId, setAddingId] = useState(null)

  // Load selectable events lazily when the Event target is chosen (skip when locked).
  useEffect(() => {
    if (lockEventId || segment !== 'event' || events.length) return
    supabase.from('activities').select('id, name, activity_date').is('archived_at', null).order('start_date', { ascending: false }).limit(200)
      .then(({ data }) => { setEvents(data || []); if (!eventId && data?.[0]) setEventId(data[0].id) })
  }, [segment, events.length, eventId, lockEventId])

  useEffect(() => { const t = setTimeout(() => setDebouncedQ(q.trim()), 300); return () => clearTimeout(t) }, [q])
  // Search people by name OR phone — matches volunteers AND meditators (both live on `people`).
  useEffect(() => {
    if (mode !== 'search' || debouncedQ.length < 2) { setResults([]); return }
    let alive = true
    setSearching(true)
    const or = multiFieldOr(debouncedQ, ['full_name', 'phone'])
    supabase.from('people').select('id, full_name, phone, is_volunteer, is_meditator').or(or).order('full_name').limit(25)
      .then(({ data }) => { if (alive) { setResults(data || []); setSearching(false) } })
    return () => { alive = false }
  }, [mode, debouncedQ])

  const parsed = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((l) => { const [nm, ph, pg] = l.split(',').map((s) => (s || '').trim()); return { name: nm, phone: ph, program: pg } }).filter((r) => r.name)

  // Attach interest for an already-resolved person id, per the current segment.
  async function attachInterest(pid, prog) {
    if (segment === 'event') {
      const { error } = await supabase.from('event_interest').upsert({ activity_id: eventId, person_id: pid, source: 'search' }, { onConflict: 'activity_id,person_id' })
      if (error) throw error
    } else if (segment === 'volunteering') {
      const { error } = await supabase.from('volunteer_profiles').upsert({ person_id: pid, status: 'new', interest_source: 'manual' }, { onConflict: 'person_id' })
      if (error) throw error
    } else {
      const { error } = await supabase.from('advanced_interest').upsert({ person_id: pid, program: (prog || program || 'bsp').toLowerCase(), status: 'new', source: 'manual' }, { onConflict: 'person_id,program' })
      if (error) throw error
    }
  }

  // Add an existing person by their canonical id — no phone re-resolve, no duplicate row.
  async function addExisting(person) {
    if (segment === 'event' && !eventId) { setErr('Pick an event first.'); return }
    setErr(null); setAddingId(person.id)
    try {
      await attachInterest(person.id, program)
      setAdded((s) => ({ ...s, [person.id]: true }))
      onToast(`${person.full_name || 'Person'} added to interest.`)
    } catch (e) { setErr(e.message || String(e)) } finally { setAddingId(null) }
  }

  async function insertOne(row) {
    if (segment === 'event') {
      // Phone is the key — reject rows we can't resolve to a canonical person.
      if (!normPhone(row.phone)) throw new Error(`"${row.name}" has no valid 10-digit phone — event interest is phone-keyed.`)
    }
    const pid = await ensurePersonId(row.name, row.phone) // canonical people, no unlinked rows
    await attachInterest(pid, row.program)
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

  const field = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', background: '#fff', outline: 'none' }
  return (
    <Modal onClose={onClose} title="Add / import interest">
      {err && <ErrBox>{err}</ErrBox>}
      {lockEventId ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>Adding volunteer interest to <strong>this event</strong> · phone-keyed, deduped.</div>
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
        {[{ k: 'search', l: 'Search & add' }, { k: 'single', l: 'Add one' }, { k: 'import', l: 'Import CSV' }].map((t) => (
          <button key={t.k} onClick={() => setMode(t.k)} className="btn" style={{ padding: '7px 12px', fontSize: 12, background: mode === t.k ? '#241B14' : '#fff', color: mode === t.k ? '#F6ECDC' : 'var(--ink-soft)', border: mode === t.k ? 'none' : '1px solid var(--border)' }}>{t.l}</button>
        ))}
      </div>
      {mode === 'search' ? (
        <div>
          {segment === 'advanced' && <input value={program} onChange={(e) => setProgram(e.target.value)} placeholder="Programme (bsp/shoonya/samyama)" style={{ ...field, marginBottom: 8 }} />}
          <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus placeholder="Search by name or phone…" style={field} />
          <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, marginTop: 10 }}>
            {searching && <div style={{ padding: 14, fontSize: 12, color: 'var(--muted-2)' }}>Searching…</div>}
            {!searching && debouncedQ.length < 2 && <div style={{ padding: 14, fontSize: 12, color: 'var(--muted-2)' }}>Type a name or phone to find volunteers, meditators or anyone on record.</div>}
            {!searching && debouncedQ.length >= 2 && results.length === 0 && <div style={{ padding: 14, fontSize: 12, color: 'var(--muted-2)' }}>No matches.</div>}
            {results.map((p, i) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderBottom: '1px solid var(--border-soft)' }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(p.full_name || '?')}</div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.full_name || '(no name)'}</div>
                  <div style={{ fontSize: 12, color: p.phone ? 'var(--muted)' : 'var(--red)' }}>
                    {p.phone || 'no phone'}
                    {p.is_volunteer && <span style={{ marginLeft: 6, color: 'var(--rust)' }}>· Volunteer</span>}
                    {p.is_meditator && <span style={{ marginLeft: 6, color: 'var(--green)' }}>· Meditator</span>}
                  </div>
                </div>
                {added[p.id] ? (
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#4E7C3F' }}>✓ Added</span>
                ) : (
                  <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 12px' }} disabled={addingId === p.id} onClick={() => addExisting(p)}>{addingId === p.id ? '…' : 'Add'}</button>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="btn btn-ghost" onClick={() => { if (Object.keys(added).length) onDone(); else onClose() }}>Done</button>
          </div>
        </div>
      ) : mode === 'single' ? (
        <>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name *" style={field} />
            <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="Phone (10-digit)" style={field} />
            {segment === 'advanced' && <input value={program} onChange={(e) => setProgram(e.target.value)} placeholder="Programme (bsp/shoonya/samyama)" style={field} />}
          </div>
          <Actions onClose={onClose} busy={busy} onSubmit={submit} label="Add entry" />
        </>
      ) : (
        <>
          <div>
            <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={6} placeholder={'One per line: Name, Phone' + (segment === 'advanced' ? ', Programme' : '')} style={{ ...field, resize: 'vertical' }} />
            <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{parsed.length} row(s) ready · resolved to a people row by phone.</div>
          </div>
          <Actions onClose={onClose} busy={busy} onSubmit={submit} label={`Import ${parsed.length}`} />
        </>
      )}
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

  const normName = (n) => (n || '').toLowerCase().replace(/\s+/g, ' ').trim()

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

  const field = { width: '100%', padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', background: '#fff', outline: 'none' }
  const RC = { link: '#4E7C3F', create: 'var(--orange)', review: 'var(--red)', no_phone: 'var(--muted)' }
  return (
    <Modal onClose={onClose} title="Scan / match form">
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
        Scan a photo of the handed-out form (Google Vision reads name + phone), or type them. Matched by <strong>phone</strong>; name is a confirmation signal only — never a merge key.
      </div>
      <div style={{ marginBottom: 14 }}>
        <label className="btn btn-ghost" style={{ cursor: 'pointer' }}>
          {ocrBusy ? 'Reading form…' : '📷 Scan form photo'}
          <input type="file" accept="image/*" onChange={onFile} style={{ display: 'none' }} />
        </label>
        {ocrErr && <div style={{ fontSize: 12, color: 'var(--red)', marginTop: 6 }}>{ocrErr}</div>}
      </div>
      {lockEventId ? (
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>Scanning into <strong>this event’s</strong> interest pool.</div>
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
          <div style={{ fontSize: 14, fontWeight: 600, color: RC[result.rule], marginBottom: result.can || result.override ? 10 : 0 }}>{result.label}</div>
          {result.can && <button className="btn btn-primary" disabled={busy} onClick={() => confirm(false)}>{result.rule === 'create' ? 'Create + add' : 'Link + add'}</button>}
          {result.override && <button className="btn btn-ghost" disabled={busy} onClick={() => confirm(true)} style={{ color: 'var(--red)' }}>Override — link anyway (reviewed)</button>}
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
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 14px' }}>{title}</h2>
        {children}
      </div>
    </div>
  )
}
function Lbl({ children }) { return <label style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', color: 'var(--muted-2)', display: 'block', marginBottom: 6 }}>{children}</label> }
function ErrBox({ children }) { return <div style={{ background: '#FBE6E0', color: 'var(--red)', padding: '10px 12px', borderRadius: 9, fontSize: 12, marginBottom: 12 }}>{children}</div> }
function Actions({ onClose, busy, onSubmit, label }) {
  return (
    <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
      <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
      <button className="btn btn-primary" disabled={busy} onClick={onSubmit}>{busy ? 'Saving…' : label}</button>
    </div>
  )
}
