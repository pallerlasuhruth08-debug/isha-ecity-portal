import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Pad, ErrorCard, Loading, Empty } from '../components/View'
import { pill, initials, avatarFor } from '../lib/ui'
import { rangeLabel, groupPhases, phaseFlag, currentPhase, phaseTone, fmtDay, countdownLabel } from '../lib/planning'
import { ensureSeriesWindow } from '../lib/series'
import { fetchActivityTypes } from '../lib/activityTypes'
import EventList from '../components/EventList'
import { PlanningEvent } from './Planning'
import { Detail as AttendanceDetail, EventActions } from './Events'
import CommentThread from '../components/CommentThread'
import CreateTeamForm from '../components/CreateTeamForm'
import { AddImport } from './Interest'
import { buildTeamRoster, teamsToCSV, downloadCSV, teamsToPDF } from '../lib/teamExport'
import { multiFieldOr } from '../lib/searchFilter'
import EventInterestPanel from '../components/EventInterestPanel'
import { eventDays } from '../lib/planning'
import KebabMenu from '../components/KebabMenu'
import { useBreakpoint } from '../lib/useBreakpoint'

// EVENT HUB — the home for events. The list surfaces overdue/at-risk phases across
// all events; opening one shows four LENSES over four separate tables joined by the
// event's id (Planning blocks, its Interest pool, its linked Campaigns, Attendance).
// Rows open their target directly — no intermediary "open" buttons.
export default function Hub({ me, isCoordinator, onToast, onOpenCampaign, onStartCampaign, onOpenInterestInbox, openEventId = null, onEventConsumed, onListModeChange, onCreateEvent }) {
  const { isPhone } = useBreakpoint()
  const [events, setEvents] = useState(null)
  const [phasesByEvent, setPhasesByEvent] = useState({})
  const [err, setErr] = useState(null)
  const [openId, setOpenId] = useState(null)

  // Report list-vs-detail mode up so the Topbar knows when to show "+ Create event"
  // (it only makes sense on the events LIST, not inside a specific event's hub).
  useEffect(() => { onListModeChange?.(!openId) }, [openId, onListModeChange])

  const load = useCallback(async () => {
    setErr(null)
    await ensureSeriesWindow().catch(() => {})
    const [a, p] = await Promise.all([
      supabase.from('activities').select('id, name, center_id, activity_date, start_date, end_date, series_id').is('archived_at', null).order('start_date', { ascending: true }),
      supabase.from('event_phases').select('activity_id, kind, label, sort_order, start_by, finish_by, started_at, completed_at'),
    ])
    if (a.error) { setErr(a.error.message); setEvents([]); return }
    setEvents(a.data || [])
    setPhasesByEvent(groupPhases(p.data))
  }, [])
  useEffect(() => { load() }, [load])

  // Open a specific event when routed here (calendar click, just-created event,
  // returning from a campaign sub-flow). This is what lets those flows land on the
  // event's HUB rather than the list / the wrong page.
  useEffect(() => {
    if (!openEventId || events === null) return
    if (events.some((e) => e.id === openEventId)) setOpenId(openEventId)
    onEventConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEventId, events])

  if (err) return <Pad><ErrorCard>Couldn't load the hub: {err}</ErrorCard></Pad>
  if (!events) return <Pad><Loading label="Loading events…" /></Pad>

  if (openId) {
    const ev = events.find((e) => e.id === openId)
    if (!ev) { setOpenId(null); return null }
    return <EventHub ev={ev} me={me} isCoordinator={isCoordinator} onBack={() => setOpenId(null)} onOpenCampaign={onOpenCampaign} onStartCampaign={onStartCampaign} onOpenInterestInbox={onOpenInterestInbox} onToast={onToast} />
  }

  return (
    <Pad>
      <EventList events={events} phasesByEvent={phasesByEvent} onOpen={setOpenId} />
      {isPhone && isCoordinator && onCreateEvent && (
        <>
          {/* Clears the fixed bar below so the last list row stays reachable. */}
          <div style={{ height: 68 }} />
          <div style={{ position: 'fixed', left: 0, right: 0, bottom: 0, padding: '10px 14px calc(10px + env(safe-area-inset-bottom))', background: 'var(--bg)', borderTop: '1px solid var(--border)', zIndex: 120 }}>
            <button className="btn btn-primary" onClick={onCreateEvent} style={{ width: '100%', height: 48, justifyContent: 'center', fontSize: 15 }}>＋ Create event</button>
          </div>
        </>
      )}
    </Pad>
  )
}

// ---- one event's hub: TABS, every one scoped to THIS event --------------------
function EventHub({ ev, me, isCoordinator, onBack, onOpenCampaign, onStartCampaign, onOpenInterestInbox, onToast }) {
  const [tab, setTab] = useState('planning')
  const [phases, setPhases] = useState([])
  const [types, setTypes] = useState([])
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey((k) => k + 1)

  useEffect(() => {
    let alive = true
    supabase.from('event_phases').select('kind, sort_order, start_by, finish_by, started_at, completed_at').eq('activity_id', ev.id).order('sort_order')
      .then(({ data }) => { if (alive) setPhases(data || []) })
    fetchActivityTypes().then((t) => { if (alive) setTypes(t || []) }).catch(() => {})
    return () => { alive = false }
  }, [ev.id])

  const cur = currentPhase(ev, phases)
  const flags = phases.map((p) => ({ kind: p.kind, flag: phaseFlag(p) })).filter((f) => f.flag)
  const TABS = [
    { k: 'planning', label: 'Planning' },
    { k: 'teams', label: 'Teams' },
    { k: 'interest', label: 'Volunteer Interests' },
    { k: 'campaigns', label: 'Campaigns' },
    { k: 'attendance', label: 'Attendance' },
  ]

  return (
    <Pad>
      <button className="btn btn-ghost" style={{ fontSize: 13, marginBottom: 14 }} onClick={onBack}>← All events</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ minWidth: 0, flex: '1 1 240px', overflow: 'hidden' }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0, fontFamily: "'Newsreader',serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {ev.name}{ev.series_id && <span title="Recurring occurrence" style={{ marginLeft: 8, fontSize: 16, color: 'var(--muted-2)' }}>↻</span>}
          </h2>
          <div style={{ fontSize: 14, color: 'var(--muted)', marginTop: 2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rangeLabel(ev.start_date || ev.activity_date, ev.end_date)} · {ev.center_id}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          {(() => {
            const cd = countdownLabel(ev.start_date || ev.activity_date)
            const over = cd.startsWith('Overdue')
            return cd ? <span className="pill" style={{ background: over ? '#FBE0DA' : '#EAF2E5', color: over ? '#B5391F' : '#4E7C3F', fontWeight: 600 }}>{cd}</span> : null
          })()}
          <EventActions activity={ev} me={me} isCoordinator={isCoordinator} onToast={onToast} onChanged={reload} onDeleted={onBack} />
        </div>
      </div>

      <div className="scroll-tabs" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t.k} className="tap44" onClick={() => setTab(t.k)}
            style={{ padding: '9px 14px', fontSize: 14, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', color: tab === t.k ? 'var(--ink)' : 'var(--muted)', borderBottom: tab === t.k ? '2px solid var(--orange)' : '2px solid transparent', marginBottom: -1, whiteSpace: 'nowrap' }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'planning' && <PlanningEvent ev={ev} me={me} isCoordinator={isCoordinator} embedded onToast={onToast} onEventChanged={reload} onStartCampaign={onStartCampaign} onOpenInterest={onOpenInterestInbox} />}
      {tab === 'teams' && <EventTeams ev={ev} me={me} isCoordinator={isCoordinator} onToast={onToast} />}
      {tab === 'interest' && <EventInterestTab ev={ev} me={me} isCoordinator={isCoordinator} onToast={onToast} />}
      {tab === 'campaigns' && <EventCampaignsTab ev={ev} isCoordinator={isCoordinator} onOpenCampaign={onOpenCampaign} onStartCampaign={onStartCampaign} />}
      {tab === 'attendance' && <AttendanceDetail activity={ev} me={me} isCoordinator={isCoordinator} types={types} embedded onToast={onToast} onActivityChanged={reload} />}
    </Pad>
  )
}

// Volunteer Interests tab — a READ-THROUGH of everyone who showed interest for THIS
// event. Import / scan / tag live in ONE place: the Interest Inbox. This tab links
// there (scoped to this event) rather than duplicating the importers.
// Add/Import interest happens IN-CONTEXT here (modal), never navigating away — so the
// event context is never lost and the new interest shows immediately on save.
function EventInterestTab({ ev, me, isCoordinator, onToast }) {
  const [addOpen, setAddOpen] = useState(false)
  const [reloadKey, setReloadKey] = useState(0)

  return (
    <div>
      {isCoordinator && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-primary tap44" style={{ fontSize: 12, padding: '8px 14px' }} onClick={() => setAddOpen(true)}>＋ Add / Import Interest</button>
          <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>Add or import against this event — stays right here.</span>
        </div>
      )}
      <EventInterestPanel uid={me?.id} lockEventId={ev.id} reloadKey={reloadKey} onToast={onToast} isCoordinator={isCoordinator} />
      {addOpen && <AddImport lockEventId={ev.id} me={me} onClose={() => setAddOpen(false)} onToast={onToast} onDone={() => { setAddOpen(false); setReloadKey((k) => k + 1) }} />}
    </div>
  )
}

// Linked Campaigns tab — ONLY campaigns for THIS event; create pre-attaches it.
function EventCampaignsTab({ ev, isCoordinator, onOpenCampaign, onStartCampaign }) {
  const [camps, setCamps] = useState(null)
  const [menu, setMenu] = useState(false)
  useEffect(() => {
    let alive = true
    supabase.from('campaigns').select('id, name, status, is_test, audience').eq('event_id', ev.id).order('created_at', { ascending: false })
      .then(({ data }) => { if (alive) setCamps(data || []) })
    return () => { alive = false }
  }, [ev.id])

  return (
    <div>
      {isCoordinator && (
        <div style={{ position: 'relative', marginBottom: 14 }}>
          <button className="btn btn-primary tap44" style={{ fontSize: 12, padding: '8px 14px' }} onClick={() => setMenu((m) => !m)}>＋ Create campaign</button>
          {menu && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setMenu(false)} />
              <div style={{ position: 'absolute', top: 40, left: 0, background: '#fff', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: 6, zIndex: 50, width: 230 }}>
                <div style={{ fontSize: 12, color: 'var(--muted-2)', padding: '4px 8px' }}>Pick who to call — you’ll select them next; they become the call list.</div>
                <div className="rowhover" style={{ padding: '9px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }} onClick={() => { setMenu(false); onStartCampaign && onStartCampaign(ev.id, ev.name, 'volunteer') }}>Recruit volunteers →</div>
                <div className="rowhover" style={{ padding: '9px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 14, fontWeight: 600 }} onClick={() => { setMenu(false); onStartCampaign && onStartCampaign(ev.id, ev.name, 'meditator') }}>Invite meditators →</div>
              </div>
            </>
          )}
        </div>
      )}
      {!camps ? <Loading label="Loading campaigns…" /> : camps.length === 0 ? (
        <Empty label="No campaigns for this event yet." />
      ) : (
        <div className="card" style={{ padding: 16 }}>
          {camps.map((c) => (
            <Row key={c.id} onClick={() => onOpenCampaign && onOpenCampaign(c.id)}
              main={<>{c.name}{c.is_test && <span className="pill" style={{ ...pill('#F6E0CE', 'var(--red)'), marginLeft: 6, fontSize: 12 }}>test</span>}</>}
              side={<span className="pill" style={statusPill(c.status)}>{c.status}</span>} />
          ))}
        </div>
      )}
    </div>
  )
}

// Teams tab — a ROSTER view of the event's activity blocks (a block IS a team).
// Name = block heading/activity, size = volunteers_needed, members = block_assignments,
// POCs = flagged members (is_poc). Reads + writes the SAME blocks — no parallel store.
// Size, activity and dates are edited in Planning only; here you set members + POCs.
function EventTeams({ ev, me, isCoordinator, onToast }) {
  const [blocks, setBlocks] = useState(null)
  const [assigns, setAssigns] = useState([])
  const [people, setPeople] = useState({})
  const [types, setTypes] = useState([])
  const [err, setErr] = useState(null)
  const [creating, setCreating] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [phaseSpanByBlock, setPhaseSpanByBlock] = useState({})
  const [teamDaysByBlock, setTeamDaysByBlock] = useState({})

  const load = useCallback(async () => {
    setErr(null)
    const [bl, ty] = await Promise.all([
      supabase.from('activity_blocks').select('id, heading, volunteers_needed, activity_type_id').eq('activity_id', ev.id).is('archived_at', null).order('created_at'),
      fetchActivityTypes().catch(() => []),
    ])
    if (bl.error) { setErr(bl.error.message); setBlocks([]); return }
    setBlocks(bl.data || []); setTypes(ty || [])
    const ids = (bl.data || []).map((b) => b.id)
    if (ids.length) {
      const [asgRes, bpRes, epRes] = await Promise.all([
        supabase.from('block_assignments').select('id, block_id, person_id, status, is_poc').in('block_id', ids),
        supabase.from('block_phases').select('block_id, phase_id').in('block_id', ids),
        supabase.from('event_phases').select('id, start_by, finish_by').eq('activity_id', ev.id),
      ])
      const asg = asgRes.data
      setAssigns(asg || [])
      const pids = [...new Set((asg || []).map((a) => a.person_id))]
      if (pids.length) { const { data: pp } = await supabase.from('people').select('id, full_name, phone, email').in('id', pids); setPeople(Object.fromEntries((pp || []).map((p) => [p.id, p]))) }
      else setPeople({})
      // Each team's execution period — its own phase span if it has one, else the event's.
      // Also its DAY SET (actual dates) for the availability-mismatch check at assign time.
      const phaseById = Object.fromEntries((epRes.data || []).map((p) => [p.id, p]))
      const eventSpan = rangeLabel(ev.start_date || ev.activity_date, ev.end_date)
      const eventDayList = eventDays(ev.start_date || ev.activity_date, ev.end_date)
      const byBlock = {}
      for (const r of bpRes.data || []) (byBlock[r.block_id] ||= []).push(r.phase_id)
      const spans = {}
      const teamDays = {}
      for (const id of ids) {
        const phases = (byBlock[id] || []).map((pid) => phaseById[pid]).filter(Boolean)
        const starts = phases.map((p) => p.start_by).filter(Boolean).sort()
        const finishes = phases.map((p) => p.finish_by).filter(Boolean).sort()
        spans[id] = starts.length ? rangeLabel(starts[0], finishes[finishes.length - 1] || starts[starts.length - 1]) : eventSpan
        // Team days = its phase windows ∩ the event's own days (so pre/post-event phases
        // like "Promotion" don't cause false mismatches). No phases → the whole event.
        if (phases.length) {
          const evSet = new Set(eventDayList)
          const s = new Set()
          for (const ph of phases) if (ph.start_by) for (const d of eventDays(ph.start_by, ph.finish_by || ph.start_by)) if (evSet.has(d)) s.add(d)
          teamDays[id] = [...s].sort()
        } else teamDays[id] = eventDayList
      }
      setPhaseSpanByBlock(spans)
      setTeamDaysByBlock(teamDays)
    } else { setAssigns([]); setPhaseSpanByBlock({}); setTeamDaysByBlock({}) }
  }, [ev.id])
  useEffect(() => { load() }, [load])

  const typeLabel = (id) => types.find((t) => t.id === id)?.label
  const firstDay = ev.start_date || ev.activity_date

  // Export = the SAME data already on screen (blocks/assignments/people), plus two
  // extra reads for fields the roster needs but this view doesn't otherwise load:
  // each team's phase span (execution period) and per-person comments for this event.
  async function exportRoster(kind) {
    setExporting(true)
    try {
      const ids = blocks.map((b) => b.id)
      const [bp, ep, cm] = await Promise.all([
        ids.length ? supabase.from('block_phases').select('block_id, phase_id').in('block_id', ids) : Promise.resolve({ data: [] }),
        supabase.from('event_phases').select('id, start_by, finish_by').eq('activity_id', ev.id),
        supabase.from('comments').select('subject_person_id, body').eq('activity_id', ev.id).not('subject_person_id', 'is', null),
      ])
      const blockPhases = {}
      for (const r of bp.data || []) (blockPhases[r.block_id] ||= []).push(r.phase_id)
      const commentsByPerson = {}
      for (const c of cm.data || []) (commentsByPerson[c.subject_person_id] ||= []).push(c.body)

      const teams = buildTeamRoster({ ev, blocks, assigns, people, blockPhases, eventPhases: ep.data || [], commentsByPerson })
      const safeName = ev.name.replace(/[^\w\- ]/g, '').trim() || 'event'
      if (kind === 'csv') downloadCSV(`${safeName} - teams.csv`, teamsToCSV(teams))
      else teamsToPDF(ev.name, teams).save(`${safeName} - teams.pdf`)
    } catch (e) { onToast('Could not export: ' + (e.message || e)) } finally { setExporting(false) }
  }

  if (err) return <ErrorCard>{err}</ErrorCard>
  if (!blocks) return <Loading label="Loading teams…" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: -2, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 14, fontWeight: 600 }}>Teams</span>
        <button onClick={() => setShowInfo((s) => !s)} title="Teams are this event's activity blocks — create teams, set members &amp; POCs here; a team's dates &amp; attendance mode are set in Planning (same block)."
          style={{ width: 18, height: 18, borderRadius: '50%', border: '1px solid var(--border)', background: showInfo ? '#EDE4D6' : '#fff', color: 'var(--muted)', fontSize: 12, cursor: 'pointer', lineHeight: 1, padding: 0 }}>ⓘ</button>
        {blocks.length > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className="btn btn-ghost tap44" disabled={exporting} onClick={() => exportRoster('csv')} style={{ fontSize: 12, padding: '6px 11px', opacity: exporting ? 0.6 : 1 }}>⬇ CSV</button>
            <button className="btn btn-ghost tap44" disabled={exporting} onClick={() => exportRoster('pdf')} style={{ fontSize: 12, padding: '6px 11px', opacity: exporting ? 0.6 : 1 }}>⬇ PDF</button>
          </div>
        )}
      </div>
      {showInfo && (
        <div style={{ fontSize: 12, color: 'var(--muted-2)', background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 11px' }}>
          Teams are this event's activity blocks. Here you create teams and set members &amp; POCs; a team's <strong>dates &amp; attendance mode</strong> are set in <strong>Planning</strong> — it's the same block.
        </div>
      )}
      {blocks.length === 0 ? <Empty label="No teams yet — create one below." /> : blocks.map((b) => (
        <TeamCard key={b.id} ev={ev} block={b} typeLabel={typeLabel} firstDay={firstDay} me={me} isCoordinator={isCoordinator} types={types}
          assigns={assigns.filter((a) => a.block_id === b.id)} allAssigns={assigns} allBlocks={blocks} people={people}
          phaseSpan={phaseSpanByBlock[b.id]} teamDays={teamDaysByBlock[b.id] || []} eventDayList={eventDays(ev.start_date || ev.activity_date, ev.end_date)}
          onToast={onToast} onChanged={load} />
      ))}
      {isCoordinator && (
        <button className="btn btn-primary tap44" style={{ padding: '11px', fontSize: 14 }} onClick={() => setCreating(true)}>＋ Create team</button>
      )}
      {creating && <CreateTeamForm ev={ev} types={types} firstDay={firstDay} me={me} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); load() }} onToast={onToast} />}
    </div>
  )
}

function TeamCard({ ev, block, typeLabel, firstDay, me, isCoordinator, assigns, allAssigns = [], allBlocks = [], people, phaseSpan, teamDays = [], eventDayList = [], types = [], onToast, onChanged }) {
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [pickerTab, setPickerTab] = useState('interest') // 'interest' (default) | 'all'
  const [interestPool, setInterestPool] = useState([])
  const [allResults, setAllResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [showComments, setShowComments] = useState(false)
  const [collapsed, setCollapsed] = useState(false)

  const byPerson = {}
  for (const a of assigns) {
    if (!['assigned', 'show', 'involved'].includes(a.status)) continue
    const m = (byPerson[a.person_id] ||= { person_id: a.person_id, poc: false })
    if (a.is_poc) m.poc = true
  }
  const members = Object.values(byPerson)
  const filled = members.length
  const size = block.volunteers_needed || 0
  const short = size - filled
  const full = short <= 0
  const pocs = members.filter((m) => m.poc)
  const memberIds = new Set(members.map((m) => m.person_id))

  // Existing team memberships FOR THIS EVENT ONLY — shown in the add-member picker so a
  // coordinator adding someone sees where they already are, without being blocked (a
  // person can legitimately be on more than one team for the same event).
  const blockNameById = Object.fromEntries(allBlocks.map((bl) => [bl.id, bl.heading]))
  const teamsForPerson = (personId) => {
    const ids = [...new Set(allAssigns.filter((a) => a.person_id === personId && ['assigned', 'show', 'involved'].includes(a.status)).map((a) => a.block_id))]
    return ids.map((id) => ({ id, name: blockNameById[id] || 'Unknown team' }))
  }

  // Debounce the raw keystroke ~300ms before it drives either tab's search.
  useEffect(() => {
    const h = setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => clearTimeout(h)
  }, [q])

  // Tab 1 (default): this event's Volunteer Interest pool = every APPROVED interest.
  // Interested/Contacted/Declined/No-Response never appear here — approval is what
  // flows a volunteer into the pool. A volunteer already on another team for this
  // event (or even this one) still shows up here — a person can legitimately be on
  // more than one team, and each row already surfaces "Already in: <team>" / "on
  // team" via teamsForPerson/memberIds below, same as the All-Volunteers tab. (A
  // prior version pre-filtered out anyone assigned to ANY team, which meant someone
  // already on one team could never be found here to add to a second.)
  // Loaded once per picker-open (a fresh open reloads, so it can't go stale).
  useEffect(() => {
    if (!adding) return
    setPickerTab('interest')
    let alive = true
    supabase.from('event_interest').select('availability_dates, person:people!event_interest_person_id_fkey(id, full_name, phone)')
      .eq('activity_id', ev.id).eq('status', 'approved')
      .then(({ data }) => {
        if (!alive) return
        const seen = new Set()
        const pool = []
        for (const row of data || []) {
          const p = row.person
          if (!p || seen.has(p.id)) continue
          seen.add(p.id); pool.push({ ...p, availability_dates: row.availability_dates || [] })
        }
        setInterestPool(pool)
      })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [adding, ev.id])

  // Tab 2: the full volunteers list, name-or-phone search (same pattern as the Volunteers page).
  useEffect(() => {
    if (!adding || pickerTab !== 'all' || !debouncedQ) { setAllResults([]); return }
    let alive = true
    const searchOr = multiFieldOr(debouncedQ, ['full_name', 'phone'])
    supabase.from('people').select('id, full_name, phone').eq('is_volunteer', true).or(searchOr).limit(8)
      .then(({ data }) => { if (alive) setAllResults(data || []) })
    return () => { alive = false }
  }, [adding, pickerTab, debouncedQ])

  const matchesQuery = (p, term) => {
    const t = term.toLowerCase()
    return (p.full_name || '').toLowerCase().includes(t) || (p.phone || '').includes(t)
  }
  const interestFiltered = debouncedQ ? interestPool.filter((p) => matchesQuery(p, debouncedQ)) : interestPool
  const pickerResults = pickerTab === 'interest' ? interestFiltered : allResults

  // Map a set of dates to "Day 1, Day 3" labels (day number = position in the event's
  // day list); dates outside that list fall back to their own short date.
  const dayLabels = (dates) => (dates || []).map((d) => { const i = eventDayList.indexOf(d); return i >= 0 ? `Day ${i + 1}` : fmtDay(d) }).join(', ')

  async function addMember(p) {
    if (memberIds.has(p.id)) { onToast(`${p.full_name} already on the team.`); return }
    // Availability-vs-team-days mismatch check (warns, never blocks — coordinator overrides).
    try {
      let avail = p.availability_dates
      if (avail === undefined) { // came from All-Volunteers tab → look up this event's interest row
        const { data: ei } = await supabase.from('event_interest').select('availability_dates').eq('activity_id', ev.id).eq('person_id', p.id).maybeSingle()
        avail = ei?.availability_dates || []
      }
      let msg = null
      if (!avail || !avail.length) msg = `Availability not set for ${p.full_name} — confirm before assigning.`
      else if (teamDays.length && !teamDays.some((d) => avail.includes(d))) {
        msg = `${p.full_name} is available ${dayLabels(avail)} but this team runs ${dayLabels(teamDays)}. Assign anyway?`
      }
      if (msg && !window.confirm(msg)) return
    } catch { /* availability check is best-effort — never blocks the add */ }
    setBusy(true)
    try {
      const { error } = await supabase.from('block_assignments').insert({ block_id: block.id, person_id: p.id, day_date: firstDay, status: 'assigned', assigned_by: me?.id || null })
      if (error) throw error
      setQ(''); setAdding(false); onToast(`${p.full_name} added to ${block.heading}.`); onChanged()
    } catch (e) { onToast(/duplicate/i.test(e.message || '') ? 'Already on the team.' : 'Could not add: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function removeMember(pid, name) {
    if (!window.confirm(`Remove ${name} from ${block.heading}?`)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('block_assignments').delete().eq('block_id', block.id).eq('person_id', pid)
      if (error) throw error
      onToast(`${name} removed.`); onChanged()
    } catch (e) { onToast('Could not remove: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function togglePoc(pid, name, currentlyPoc) {
    setBusy(true)
    try {
      const { error } = await supabase.from('block_assignments').update({ is_poc: !currentlyPoc }).eq('block_id', block.id).eq('person_id', pid)
      if (error) throw error
      onToast(`${name} ${currentlyPoc ? 'is no longer' : 'set as'} POC.`); onChanged()
    } catch (e) { onToast('Could not update POC: ' + (e.message || e)) } finally { setBusy(false) }
  }

  // Destructive-action guard: a team with MARKED attendance (assignment show/no-show/
  // involved, or event-level attendance rows tagged to this block), public tap-to-accept
  // submissions, comments, or phase data is ARCHIVED so that all of it survives. Only a
  // genuinely untouched team is hard-deleted — and even then we warn about the members
  // whose assignments the cascade removes. (block_acceptances/comments/block_phases were
  // previously left out of this check entirely, same gap that caused the event-level
  // incident — a team with public tap-to-accept responses but no marked attendance would
  // hard-delete those responses with no warning.)
  async function removeTeam() {
    const markedAssign = assigns.filter((a) => ['show', 'no_show', 'involved'].includes(a.status)).length
    const [{ count: attCount }, { count: acceptCount }, { count: commentCount }, { count: phaseCount }] = await Promise.all([
      supabase.from('attendance').select('id', { count: 'exact', head: true }).eq('block_id', block.id),
      supabase.from('block_acceptances').select('id', { count: 'exact', head: true }).eq('block_id', block.id),
      supabase.from('comments').select('id', { count: 'exact', head: true }).eq('block_id', block.id),
      supabase.from('block_phases').select('id', { count: 'exact', head: true }).eq('block_id', block.id),
    ])
    const marked = markedAssign + (attCount || 0) + (acceptCount || 0) + (commentCount || 0) + (phaseCount || 0)
    setBusy(true)
    try {
      if (marked > 0) {
        const parts = []
        if (attCount) parts.push(`${attCount} attendance record${attCount === 1 ? '' : 's'}`)
        if (markedAssign) parts.push(`${markedAssign} marked assignment${markedAssign === 1 ? '' : 's'}`)
        if (acceptCount) parts.push(`${acceptCount} tap-to-accept response${acceptCount === 1 ? '' : 's'}`)
        if (commentCount) parts.push(`${commentCount} comment${commentCount === 1 ? '' : 's'}`)
        if (phaseCount) parts.push(`${phaseCount} phase${phaseCount === 1 ? '' : 's'}`)
        if (!window.confirm(`"${block.heading}" has ${parts.join(', ')}. It will be ARCHIVED — hidden from Teams but everything is preserved. Continue?`)) return
        const { error } = await supabase.from('activity_blocks').update({ archived_at: new Date().toISOString(), archived_by: me?.id || null }).eq('id', block.id)
        if (error) throw error
        onToast(`Team "${block.heading}" archived (all records preserved).`)
      } else {
        const n = assigns.length
        const msg = n ? `Delete "${block.heading}"? No attendance, responses, comments, or phases are recorded, but ${n} member assignment(s) will be removed. This cannot be undone.`
          : `Delete "${block.heading}"? This cannot be undone.`
        if (!window.confirm(msg)) return
        const { error } = await supabase.from('activity_blocks').delete().eq('id', block.id)
        if (error) throw error
        onToast(`Team "${block.heading}" deleted.`)
      }
      onChanged()
    } catch (e) { onToast('Could not remove team: ' + (e.message || e)) } finally { setBusy(false) }
  }

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 6 }}>
        <button className="tap44" onClick={() => setCollapsed((c) => !c)} title={collapsed ? 'Expand team' : 'Collapse team'}
          style={{ fontSize: 13, padding: '4px 6px', borderRadius: 7, border: 'none', background: 'transparent', color: 'var(--muted)', cursor: 'pointer', flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', transform: collapsed ? 'rotate(-90deg)' : 'none', transition: 'transform .15s ease' }}>▾</button>
        <div style={{ minWidth: 0, flex: 1, cursor: 'pointer' }} onClick={() => setCollapsed((c) => !c)}>
          <div style={{ fontSize: 16, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{block.heading}{block.activity_type_id && typeLabel(block.activity_type_id) ? <span style={{ fontWeight: 400, color: 'var(--muted)' }}> · {typeLabel(block.activity_type_id)}</span> : null}</div>
          {pocs.length > 0 && <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>POC: {pocs.map((m) => people[m.person_id]?.full_name).filter(Boolean).join(', ')}</div>}
        </div>
        <span className="pill" style={{ ...(full ? pill('#EAF2E5', '#4E7C3F') : pill('#FBEAD9', '#C2691F')), flexShrink: 0 }}>{filled}/{size}{full ? ' · full' : ` · short ${short}`}</span>

        {/* Desktop: inline actions when space allows. Opening add/edit/comments also
            expands the card so the coordinator immediately sees what they opened. */}
        <div className="desktop-only" style={{ gap: 8, flexShrink: 0 }}>
          {isCoordinator && (
            <button className="tap44" onClick={() => { setAdding((a) => !a); setCollapsed(false) }} title="Add member" style={{ fontSize: 12, fontWeight: 600, padding: '4px 9px', borderRadius: 7, border: '1px solid var(--border)', background: adding ? '#F6E8D8' : '#fff', color: adding ? 'var(--orange)' : 'var(--ink-soft)', cursor: 'pointer' }}>＋ Member</button>
          )}
          {isCoordinator && (
            <button className="tap44" onClick={() => { setEditing(true); setCollapsed(false) }} title="Edit team" style={{ fontSize: 12, padding: '4px 8px', borderRadius: 7, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer' }}>✏️</button>
          )}
          {isCoordinator && (
            <button className="tap44" disabled={busy} onClick={removeTeam} title="Delete / archive team" style={{ fontSize: 12, padding: '4px 8px', borderRadius: 7, border: '1px solid #E7C9B8', background: '#fff', color: 'var(--red)', cursor: 'pointer' }}>🗑</button>
          )}
          <button className="tap44" onClick={() => { setShowComments((s) => !s); setCollapsed(false) }} title="Comments" style={{ fontSize: 12, padding: '4px 8px', borderRadius: 7, border: '1px solid var(--border)', background: showComments ? '#EDE4D6' : '#fff', cursor: 'pointer' }}>💬</button>
        </div>

        {/* Mobile: everything collapses behind one 3-dot menu so it never crowds the team name. */}
        <div className="mobile-only">
          <KebabMenu items={[
            { label: 'Dates: ' + (phaseSpan || '—'), view: true },
            ...(isCoordinator ? [{ label: adding ? 'Hide add member' : '＋ Add member', onClick: () => { setAdding((a) => !a); setCollapsed(false) } }] : []),
            ...(isCoordinator ? [{ label: 'Edit team', onClick: () => { setEditing(true); setCollapsed(false) } }] : []),
            { label: showComments ? 'Hide comments' : 'Show comments', onClick: () => { setShowComments((s) => !s); setCollapsed(false) } },
            ...(isCoordinator ? [{ label: 'Delete / archive team', onClick: removeTeam, danger: true, disabled: busy }] : []),
          ]} />
        </div>
      </div>
      {!collapsed && (
        <>
          {editing && (
            <CreateTeamForm ev={ev} types={types} firstDay={firstDay} me={me} block={block}
              onClose={() => setEditing(false)} onToast={onToast} onCreated={() => { setEditing(false); onChanged() }} />
          )}

          {members.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginTop: 8 }}>
              {members.map((m) => {
                const p = people[m.person_id]
                return (
                  <div key={m.person_id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid #F4EEE2' }}>
                    <div style={{ width: 26, height: 26, borderRadius: '50%', background: avatarFor(0), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>{initials(p?.full_name || '?')}</div>
                    <div style={{ fontSize: 14, fontWeight: 500 }}>{p?.full_name || 'Unknown'}</div>
                    {m.poc && <span className="pill" style={{ ...pill('#F3E3D2', 'var(--rust)'), fontSize: 12 }}>POC</span>}
                    {isCoordinator && (
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        <button className="tap44" disabled={busy} onClick={() => togglePoc(m.person_id, p?.full_name, m.poc)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 7, border: '1px solid var(--border)', background: '#fff', color: m.poc ? 'var(--rust)' : 'var(--muted)', cursor: 'pointer' }}>{m.poc ? '★ POC' : '☆ POC'}</button>
                        <button className="tap44" disabled={busy} onClick={() => removeMember(m.person_id, p?.full_name)} style={{ fontSize: 12, padding: '4px 8px', borderRadius: 7, border: '1px solid #E7C9B8', background: '#fff', color: 'var(--red)', cursor: 'pointer' }}>Remove</button>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {isCoordinator && adding && (
            <div style={{ marginTop: 10 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                <button className="tap44" onClick={() => setPickerTab('interest')}
                  style={{ fontSize: 12, fontWeight: 600, padding: '6px 11px', borderRadius: 7, border: '1px solid var(--border)', cursor: 'pointer', background: pickerTab === 'interest' ? '#241B14' : '#fff', color: pickerTab === 'interest' ? '#F6ECDC' : 'var(--ink-soft)' }}>
                  Volunteer Interests{interestPool.length ? ` (${interestPool.length})` : ''}
                </button>
                <button className="tap44" onClick={() => setPickerTab('all')}
                  style={{ fontSize: 12, fontWeight: 600, padding: '6px 11px', borderRadius: 7, border: '1px solid var(--border)', cursor: 'pointer', background: pickerTab === 'all' ? '#241B14' : '#fff', color: pickerTab === 'all' ? '#F6ECDC' : 'var(--ink-soft)' }}>
                  All Volunteers
                </button>
              </div>
              <div style={{ position: 'relative' }}>
                <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or phone…" style={{ fontSize: 13, padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 9, width: '100%' }} />
                <div className="card" style={{ marginTop: 6, boxShadow: 'var(--shadow-lg)', padding: 6, maxHeight: 260, overflowY: 'auto' }}>
                  {pickerTab === 'all' && !debouncedQ ? (
                    <div style={{ padding: '10px 9px', fontSize: 12, color: 'var(--muted-2)' }}>Type a name or phone number to search all volunteers.</div>
                  ) : pickerResults.length === 0 ? (
                    <div style={{ padding: '10px 9px', fontSize: 12, color: 'var(--muted-2)' }}>
                      {pickerTab === 'interest' ? (interestPool.length ? 'No matches.' : 'No one from Volunteer Interests is available for this event yet.') : 'No matches.'}
                    </div>
                  ) : pickerResults.map((p) => {
                    const teams = teamsForPerson(p.id)
                    const inThisTeam = teams.some((t) => t.id === block.id)
                    return (
                      <div key={p.id} className="rowhover" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 8, cursor: 'pointer' }} onClick={() => !busy && addMember(p)}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontSize: 14, fontWeight: 500 }}>{p.full_name}</div>
                          <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>{p.phone || 'no phone'}</div>
                          {inThisTeam ? (
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--rust)' }}>Already a member of this team.</div>
                          ) : teams.length ? (
                            <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>Already in: {teams.map((t) => t.name).join(' · ')}</div>
                          ) : (
                            <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>Not in any team yet</div>
                          )}
                        </div>
                        <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 12, color: memberIds.has(p.id) ? 'var(--muted)' : 'var(--orange)', fontWeight: 600 }}>{memberIds.has(p.id) ? 'on team' : '+ add'}</span>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          )}
          {showComments && <CommentThread scope={{ block_id: block.id }} me={me} onToast={onToast} />}
        </>
      )}
    </div>
  )
}

function Row({ avatar, main, side, onClick }) {
  return (
    <div className={onClick ? 'rowhover' : undefined} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F4EEE2', cursor: onClick ? 'pointer' : 'default' }}>
      {avatar && <div style={{ width: 28, height: 28, borderRadius: '50%', background: avatarFor(avatar.i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(avatar.name || '?')}</div>}
      <div style={{ fontSize: 14, fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{main}</div>
      <div style={{ marginLeft: 'auto', flexShrink: 0 }}>{side}</div>
    </div>
  )
}
function statusPill(status) {
  const map = { active: ['#EAF2E5', '#4E7C3F'], paused: ['#FBEAD9', '#C28A2A'], done: ['#F1EADD', '#8C7E6B'] }
  const [bg, fg] = map[status] || map.active
  return { background: bg, color: fg }
}
