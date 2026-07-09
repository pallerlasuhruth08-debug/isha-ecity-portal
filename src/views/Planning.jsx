import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Pad, ErrorCard, Loading, Empty } from '../components/View'
import { initials, avatarFor, pill } from '../lib/ui'
import { fetchActivityTypes } from '../lib/activityTypes'
import { waHref } from '../lib/phone'
import EventList from '../components/EventList'
import CreateTeamForm from '../components/CreateTeamForm'
import { CreateSessionForm } from './Events'
import {
  eventDays, currentPhase, phaseTone, groupPhases, PHASE_SHORT,
  phaseFlag, phaseShortfall, flaggedPhases, FLAG_META,
  ATTENDANCE_MODES, MODE_LABEL, MODE_HINT, inheritedMode, modeSummary,
  fillCount, fmtDay, rangeLabel,
} from '../lib/planning'
import { ensureSeriesWindow } from '../lib/series'

// BOUNDARY: the whole volunteer-staffing loop lives HERE (blocks, per-day slots,
// recruiting, assignment, attendance, reliability). The Events screen stays
// attendance-only and shares the same event record — planning never renders there.
// Event CREATION lives at the single site-toolbar entry point (CreateEventModal in
// App) — neither this screen nor Events owns a create form any more.

const inputStyle = { padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: 'var(--ink)', outline: 'none', width: '100%', boxSizing: 'border-box' }
const selStyle = { ...inputStyle, cursor: 'pointer' }
const label = { fontSize: 11.5, fontWeight: 600, color: 'var(--muted)', display: 'block', marginBottom: 4 }

export default function Planning({ me, isCoordinator, onToast, openEventId = null, onEventConsumed, onCreateEvent }) {
  const [events, setEvents] = useState(null)
  const [phasesByEvent, setPhasesByEvent] = useState({}) // activity_id -> phases[]
  const [err, setErr] = useState(null)
  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    setErr(null)
    await ensureSeriesWindow().catch(() => {}) // roll the recurring-event window forward
    const [a, p] = await Promise.all([
      supabase.from('activities').select('id, name, center_id, activity_date, start_date, end_date, activity_type_id, description, series_id, default_attendance_mode').is('archived_at', null).order('start_date', { ascending: true }),
      supabase.from('event_phases').select('activity_id, kind, sort_order, start_by, finish_by, started_at, completed_at'),
    ])
    if (a.error) { setErr(a.error.message); setEvents([]); return }
    setEvents(a.data || [])
    setPhasesByEvent(groupPhases(p.data))
  }, [])
  useEffect(() => { load() }, [load])

  // Open a specific event when routed here (e.g. just created from the toolbar).
  useEffect(() => {
    if (!openEventId || events === null) return
    if (events.some((e) => e.id === openEventId)) setOpenId(openEventId)
    onEventConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEventId, events])

  if (err) return <Pad><ErrorCard>Couldn't load planning: {err}</ErrorCard></Pad>
  if (!events) return <Pad><Loading label="Loading planning…" /></Pad>

  if (openId) {
    const ev = events.find((e) => e.id === openId)
    if (!ev) { setOpenId(null); return null }
    return <PlanningEvent ev={ev} me={me} isCoordinator={isCoordinator} onBack={() => { setOpenId(null); load() }} onToast={onToast} onEventChanged={load} />
  }

  // List-first (upcoming default). Clicking an event opens the STAFFING detail
  // (distinct from the Attendance page). Create is in-context here (coordinators).
  return (
    <Pad>
      <p style={{ margin: '0 0 14px', fontSize: 13.5, color: 'var(--muted)' }}>Staff volunteers for each event — activity blocks, per-day slots, recruiting.</p>
      <AttentionPanel events={events} phasesByEvent={phasesByEvent} onOpen={setOpenId} />
      <EventList events={events} phasesByEvent={phasesByEvent} onOpen={setOpenId} right={isCoordinator && onCreateEvent && (
        <button className="btn btn-primary" style={{ fontSize: 12.5, padding: '8px 14px' }} onClick={() => onCreateEvent()}>＋ Create event</button>
      )} />
    </Pad>
  )
}

// Global "needs attention" — every OVERDUE / AT-RISK phase across all events in one
// place (the demoted Planning view's headline). Click routes to that event's detail.
function AttentionPanel({ events, phasesByEvent, onOpen }) {
  const flagged = flaggedPhases(events, phasesByEvent)
  if (!flagged.length) return null
  return (
    <div className="card" style={{ padding: 16, marginBottom: 16, borderColor: '#EBC7BB', background: '#FDF3EF' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B5391F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#8A2E18' }}>Needs attention</div>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{flagged.length} phase{flagged.length > 1 ? 's' : ''} across all events</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {flagged.map(({ event, phase, flag }) => {
          const m = FLAG_META[flag]
          return (
            <div key={phase.activity_id + phase.kind} className="rowhover" onClick={() => onOpen(event.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, cursor: 'pointer', background: '#fff', border: '1px solid #F0DED6' }}>
              <span className="pill" style={{ background: m.bg, color: m.fg, fontSize: 10.5 }}>{m.label}</span>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.name}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>· {PHASE_SHORT[phase.kind] || phase.label}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted-2)', whiteSpace: 'nowrap' }}>
                {flag === 'overdue' ? `start by ${fmtDay(phase.start_by)}` : `finish by ${fmtDay(phase.finish_by)}`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ------------------------------------------------------------- Event planning detail
// Phases (from the template) group the activity blocks. Each phase carries a date
// window (start_by/finish_by) and explicit started/complete toggles. A phase-linked
// block draws its per-day slots from the PHASE window; unphased blocks fall back to
// the event span.
export function PlanningEvent({ ev, me, isCoordinator, onBack, onToast, onEventChanged, onStartCampaign, onOpenInterest, embedded = false }) {
  const [phases, setPhases] = useState([])
  const [err, setErr] = useState(null)

  const eventSpan = eventDays(ev.start_date, ev.end_date)

  // Phases stay as the invisible backbone (current-phase pill + notifications); the
  // Planning surface itself is now a to-do list. Blocks/teams live in the Teams tab.
  const load = useCallback(async () => {
    setErr(null)
    const { data, error } = await supabase.from('event_phases').select('*').eq('activity_id', ev.id).order('sort_order')
    if (error) { setErr(error.message); return }
    setPhases(data || [])
  }, [ev.id])
  useEffect(() => { load() }, [load])

  const cur = currentPhase(ev, phases || [])

  const inner = (
    <>
      {!embedded && (
        <div onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: 'var(--orange)', cursor: 'pointer', marginBottom: 16 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
          Calendar
        </div>
      )}

      {/* Event header only on the standalone page — redundant in the Event Hub,
          which already shows name/date/phase above the tabs. */}
      {!embedded && (
        <div className="card" style={{ padding: 22, marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 21, fontWeight: 600, margin: '0 0 3px' }}>{ev.name}</h2>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{rangeLabel(ev.start_date, ev.end_date)} · {eventSpan.length} day{eventSpan.length !== 1 ? 's' : ''} · {ev.center_id}</div>
            </div>
            <span className="pill" style={{ background: phaseTone(cur.kind).bg, color: phaseTone(cur.kind).fg }}>{cur.label}</span>
          </div>
        </div>
      )}

      {err && <ErrorCard>{err}</ErrorCard>}
      <EventTodos ev={ev} me={me} isCoordinator={isCoordinator} onToast={onToast}
        onStartCampaign={onStartCampaign} onOpenInterest={onOpenInterest} />
    </>
  )
  return embedded ? inner : <Pad>{inner}</Pad>
}

// ------------------------------------------------------------- Event to-do list
// Per-event checklist with action launchers. Each 3-dot action opens the SAME
// creation flow used elsewhere, pre-attached to THIS event, and links the created
// record back to the to-do (checking it off). Planning holds NO copies — campaigns,
// teams (=blocks), attendance sessions and interest all live in their own stores.
const TODO_ACTIONS = [
  { kind: 'campaign', label: 'Create Campaign' },
  { kind: 'interest', label: 'Create Volunteer Interest' },
  { kind: 'attendance', label: 'Create Attendance session' },
  { kind: 'team', label: 'Create Team' },
]
const miniBtn = { fontSize: 12, padding: '3px 7px', borderRadius: 7, border: '1px solid var(--border)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', lineHeight: 1 }

function EventTodos({ ev, me, isCoordinator, onToast, onStartCampaign, onOpenInterest }) {
  const [rows, setRows] = useState(null)
  const [text, setText] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [menuFor, setMenuFor] = useState(null) // to-do id whose ⋯ menu is open
  const [launch, setLaunch] = useState(null)   // { todo, kind } for inline modals
  const [types, setTypes] = useState([])
  const firstDay = ev.start_date || ev.activity_date

  const load = useCallback(async () => {
    const { data } = await supabase.from('event_todos').select('*').eq('activity_id', ev.id).order('sort_order').order('created_at')
    setRows(data || [])
  }, [ev.id])
  useEffect(() => { load() }, [load])
  useEffect(() => { fetchActivityTypes().then(setTypes).catch(() => {}) }, [])

  async function stamp(todoId, linkedType, linkedId) {
    await supabase.from('event_todos').update({ done: true, done_at: new Date().toISOString(), done_by: me?.id || null, linked_type: linkedType, linked_id: linkedId }).eq('id', todoId)
  }

  // Returning from a navigation flow (campaign / interest): if a matching record was
  // created since launch, link it back and check off the to-do.
  useEffect(() => {
    let raw = null
    try { raw = JSON.parse(localStorage.getItem('todo_pending') || 'null') } catch { raw = null }
    if (!raw || raw.activityId !== ev.id) return
    ;(async () => {
      let found = null
      if (raw.actionKind === 'campaign') {
        const { data } = await supabase.from('campaigns').select('id').eq('event_id', ev.id).gt('created_at', raw.since).order('created_at', { ascending: false }).limit(1)
        if (data?.[0]) found = { type: 'campaigns', id: data[0].id }
      } else if (raw.actionKind === 'interest') {
        const { data } = await supabase.from('event_interest').select('id').eq('activity_id', ev.id).gt('created_at', raw.since).order('created_at', { ascending: false }).limit(1)
        if (data?.[0]) found = { type: 'event_interest', id: data[0].id }
      }
      localStorage.removeItem('todo_pending')
      if (found) { await stamp(raw.todoId, found.type, found.id); onToast('Action done — checked off the to-do.'); load() }
    })()
  }, [ev.id]) // eslint-disable-line react-hooks/exhaustive-deps

  async function addTodo() {
    const t = text.trim(); if (!t) return
    setBusy(true)
    const nextOrder = rows?.length ? Math.max(...rows.map((r) => r.sort_order || 0)) + 1 : 0
    const { error } = await supabase.from('event_todos').insert({ activity_id: ev.id, text: t, due_date: date || null, sort_order: nextOrder, created_by: me?.id || null })
    setBusy(false)
    if (error) return onToast('Could not add: ' + error.message)
    setText(''); setDate(''); load()
  }
  async function patch(id, p) { const { error } = await supabase.from('event_todos').update(p).eq('id', id); if (error) return onToast('Could not update: ' + error.message); load() }
  function toggleDone(r) { return patch(r.id, r.done ? { done: false, done_at: null, done_by: null } : { done: true, done_at: new Date().toISOString(), done_by: me?.id || null }) }
  async function remove(r) { if (!window.confirm(`Delete to-do “${r.text}”?`)) return; const { error } = await supabase.from('event_todos').delete().eq('id', r.id); if (error) return onToast('Could not delete: ' + error.message); load() }
  async function move(idx, dir) {
    const j = idx + dir; if (j < 0 || j >= rows.length) return
    const a = rows[idx], b = rows[j]
    await supabase.from('event_todos').update({ sort_order: b.sort_order }).eq('id', a.id)
    await supabase.from('event_todos').update({ sort_order: a.sort_order }).eq('id', b.id)
    load()
  }

  function pickAction(todo, kind) {
    setMenuFor(null)
    if (kind === 'attendance' || kind === 'team') { setLaunch({ todo, kind }); return }
    // Navigation flows leave the hub — stash a link-back token, launch the real flow.
    localStorage.setItem('todo_pending', JSON.stringify({ todoId: todo.id, actionKind: kind, activityId: ev.id, since: new Date().toISOString() }))
    if (kind === 'campaign') return onStartCampaign ? onStartCampaign(ev.id, ev.name, 'volunteer') : onToast('Campaign flow unavailable here.')
    if (kind === 'interest') return onOpenInterest ? onOpenInterest(ev.id) : onToast('Interest flow unavailable here.')
  }

  if (rows === null) return <Loading label="Loading to-dos…" />
  const done = rows.filter((r) => r.done).length
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>To-do</h3>
        <span className="pill" style={{ ...pill('#F1EADD', '#8C7E6B'), fontSize: 11 }}>{done}/{rows.length} done</span>
      </div>
      {rows.length === 0 && <Empty label="No to-dos yet — add the first below." />}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((r, i) => (
          <TodoRow key={r.id} r={r} i={i} n={rows.length} isCoordinator={isCoordinator}
            menuOpen={menuFor === r.id} onMenu={() => setMenuFor(menuFor === r.id ? null : r.id)}
            onToggle={() => toggleDone(r)} onText={(v) => patch(r.id, { text: v })} onDate={(v) => patch(r.id, { due_date: v || null })}
            onUp={() => move(i, -1)} onDown={() => move(i, 1)} onDelete={() => remove(r)} onPick={(k) => pickAction(r, k)} />
        ))}
      </div>
      {isCoordinator && (
        <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
          <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && addTodo()} placeholder="Add a to-do…"
            style={{ flex: 1, minWidth: 160, fontSize: 13, padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 9, background: '#fff', color: 'var(--ink)' }} />
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} title="Due date (optional)"
            style={{ fontSize: 12.5, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 9, background: '#fff', color: 'var(--ink-soft)' }} />
          <button className="btn btn-primary" disabled={busy || !text.trim()} onClick={addTodo} style={{ fontSize: 13, padding: '9px 16px' }}>Add</button>
        </div>
      )}

      {launch?.kind === 'attendance' && (
        <CreateSessionForm activity={ev} types={types} me={me} onToast={onToast} onClose={() => setLaunch(null)}
          onCreated={(sessionId) => { stamp(launch.todo.id, 'attendance_sessions', sessionId).then(() => { setLaunch(null); load(); onToast('Attendance session created — checked off the to-do.') }) }} />
      )}
      {launch?.kind === 'team' && (
        <CreateTeamForm ev={ev} types={types} firstDay={firstDay} me={me} onToast={onToast} onClose={() => setLaunch(null)}
          onCreated={(blockId) => { stamp(launch.todo.id, 'activity_blocks', blockId).then(() => { setLaunch(null); load(); onToast('Team created — checked off the to-do.') }) }} />
      )}
    </div>
  )
}

function TodoRow({ r, i, n, isCoordinator, menuOpen, onMenu, onToggle, onText, onDate, onUp, onDown, onDelete, onPick }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid #F4EEE2' }}>
      <input type="checkbox" checked={!!r.done} disabled={!isCoordinator} onChange={onToggle} style={{ width: 16, height: 16, flexShrink: 0, cursor: isCoordinator ? 'pointer' : 'default' }} />
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
        {isCoordinator ? (
          <input defaultValue={r.text} key={r.text} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.text) onText(v) }}
            style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 13.5, background: 'transparent', fontFamily: 'inherit', color: r.done ? 'var(--muted-2)' : 'var(--ink)', textDecoration: r.done ? 'line-through' : 'none' }} />
        ) : (
          <span style={{ fontSize: 13.5, color: r.done ? 'var(--muted-2)' : 'var(--ink)', textDecoration: r.done ? 'line-through' : 'none' }}>{r.text}</span>
        )}
        {r.linked_id && <span className="pill" style={{ ...pill('#EAF2E5', '#4E7C3F'), fontSize: 9.5 }}>{r.action_kind || 'linked'} ✓</span>}
      </div>
      {isCoordinator ? (
        <input type="date" value={r.due_date || ''} onChange={(e) => onDate(e.target.value)}
          style={{ fontSize: 11.5, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 7, background: '#fff', color: 'var(--ink-soft)', flexShrink: 0 }} />
      ) : r.due_date ? <span style={{ fontSize: 11.5, color: 'var(--muted)', flexShrink: 0 }}>{fmtDay(r.due_date)}</span> : null}
      {isCoordinator && (
        <div style={{ display: 'flex', gap: 2, position: 'relative', flexShrink: 0 }}>
          <button title="Move up" onClick={onUp} disabled={i === 0} style={{ ...miniBtn, opacity: i === 0 ? 0.4 : 1 }}>↑</button>
          <button title="Move down" onClick={onDown} disabled={i === n - 1} style={{ ...miniBtn, opacity: i === n - 1 ? 0.4 : 1 }}>↓</button>
          <button title="Actions" onClick={onMenu} style={miniBtn}>⋯</button>
          {menuOpen && (
            <div className="card" style={{ position: 'absolute', top: 26, right: 0, zIndex: 30, boxShadow: 'var(--shadow-lg)', padding: 6, width: 214 }}>
              {TODO_ACTIONS.map((a) => (
                <div key={a.kind} className="rowhover" style={{ padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, fontWeight: 600 }} onClick={() => onPick(a.kind)}>{a.label} →</div>
              ))}
              <div style={{ borderTop: '1px solid var(--border)', margin: '4px 0' }} />
              <div className="rowhover" style={{ padding: '8px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 12.5, color: '#B5532F' }} onClick={onDelete}>Delete to-do</div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// Phase status from explicit toggles (Stage 2 adds OVERDUE / AT-RISK on top).
function phaseStatus(p) {
  if (!p) return { label: 'Unphased', tone: { bg: '#F1EADD', fg: '#8C7E6B' } }
  if (p.completed_at) return { label: 'Complete', tone: { bg: '#EAF2E5', fg: '#4E7C3F' } }
  if (p.started_at) return { label: 'Started', tone: { bg: '#F6E8D8', fg: '#C2691F' } }
  return { label: 'Not started', tone: { bg: '#F1EADD', fg: '#8C7E6B' } }
}

function PhaseSection({ phase, event, isCoordinator, me, blocks, days, assignments, acceptances, people, eventName, onPatch, onAddBlock, onEditBlock, onToast, onChanged }) {
  const [editDates, setEditDates] = useState(false)
  const st = phaseStatus(phase)
  const title = phase ? (PHASE_SHORT[phase.kind] || phase.label) : 'Other blocks'
  const nowISO = () => new Date().toISOString()
  const flag = phase ? phaseFlag(phase) : null
  const short = phaseShortfall(days, blocks, assignments)
  const urgent = flag === 'overdue' && short > 0
  const defaultMode = phase?.default_attendance_mode || event?.default_attendance_mode || 'per_day'

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', borderLeft: flag ? `4px solid ${FLAG_META[flag].fg}` : undefined }}>
      <div style={{ padding: '15px 18px', background: urgent ? '#FDF3EF' : 'var(--panel)', borderBottom: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ fontSize: 15, fontWeight: 600 }}>{title}</div>
          <span className="pill" style={{ background: st.tone.bg, color: st.tone.fg, fontSize: 11 }}>{st.label}</span>
          {flag && <span className="pill" style={{ background: FLAG_META[flag].bg, color: FLAG_META[flag].fg, fontSize: 11 }}>{FLAG_META[flag].label}</span>}
          {short > 0 && <span className="pill" style={{ background: urgent ? '#FBE0DA' : '#F1EADD', color: urgent ? '#B5391F' : '#8C7E6B', fontSize: 11 }}>{short} slot{short > 1 ? 's' : ''} short</span>}
          {phase?.start_by && (
            <span style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtDay(phase.start_by)} → {fmtDay(phase.finish_by)}</span>
          )}
          {isCoordinator && phase && (
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {!phase.started_at
                ? <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => onPatch({ started_at: nowISO() }, 'Phase started.')}>Start</button>
                : !phase.completed_at
                  ? <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => onPatch({ completed_at: nowISO() }, 'Phase complete.')}>Mark complete</button>
                  : <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => onPatch({ completed_at: null, started_at: null }, 'Phase reopened.')}>Reopen</button>}
              <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => setEditDates((v) => !v)}>Dates</button>
              <button className="btn btn-primary" style={{ fontSize: 12, padding: '5px 10px' }} onClick={onAddBlock}>＋ Block</button>
            </div>
          )}
          {isCoordinator && !phase && (
            <button className="btn btn-primary" style={{ marginLeft: 'auto', fontSize: 12, padding: '5px 10px' }} onClick={onAddBlock}>＋ Block</button>
          )}
        </div>
        {editDates && phase && (
          <div style={{ display: 'flex', gap: 10, marginTop: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Start by <input type="date" defaultValue={phase.start_by || ''} onChange={(e) => onPatch({ start_by: e.target.value || null })} style={{ ...inputStyle, width: 'auto', display: 'inline-block', marginLeft: 4 }} /></label>
            <label style={{ fontSize: 12, color: 'var(--muted)' }}>Finish by <input type="date" defaultValue={phase.finish_by || ''} onChange={(e) => onPatch({ finish_by: e.target.value || null })} style={{ ...inputStyle, width: 'auto', display: 'inline-block', marginLeft: 4 }} /></label>
          </div>
        )}
        {/* Attendance-mode DEFAULT for this phase (inherited by NEW blocks only) +
            a read-only summary of overrides. The block’s own mode always governs. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, fontSize: 12, color: 'var(--muted)', flexWrap: 'wrap' }}>
          <span>Attendance: {modeSummary(defaultMode, blocks)}</span>
          {isCoordinator && phase && (
            <select value={phase.default_attendance_mode || defaultMode} onChange={(e) => onPatch({ default_attendance_mode: e.target.value }, 'Phase default set (existing blocks unchanged).')}
              style={{ fontSize: 11.5, padding: '3px 7px', border: '1px solid var(--border)', borderRadius: 7, background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer' }}>
              {ATTENDANCE_MODES.map((m) => <option key={m} value={m}>Default: {MODE_LABEL[m]}</option>)}
            </select>
          )}
        </div>
      </div>
      <div style={{ padding: 16 }}>
        {blocks.length === 0 ? (
          <Empty label={phase ? 'No blocks in this phase yet.' : 'No unphased blocks.'} />
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {blocks.map((b) => (
              <BlockCard key={b.id} block={b} days={days} isCoordinator={isCoordinator} me={me}
                assignments={assignments.filter((a) => a.block_id === b.id)}
                acceptances={acceptances.filter((a) => a.block_id === b.id)}
                people={people} eventName={eventName} onToast={onToast} onChanged={onChanged} onEdit={() => onEditBlock(b)} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function AddBlockForm({ activityId, block, phaseId = null, defaultMode = 'per_day', me, onClose, onToast, onAdded }) {
  const editing = !!block
  const [heading, setHeading] = useState(block?.heading || '')
  const [desc, setDesc] = useState(block?.description || '')
  const [needed, setNeeded] = useState(block?.volunteers_needed ?? 4)
  const [mode, setMode] = useState(block?.attendance_mode || defaultMode) // inherited default; block governs
  const [method, setMethod] = useState(block?.recruiting_method || 'manual')
  const [start, setStart] = useState(block?.start_time?.slice(0, 5) || '')
  const [end, setEnd] = useState(block?.end_time?.slice(0, 5) || '')
  const [typeId, setTypeId] = useState(block?.activity_type_id || '')
  const [types, setTypes] = useState([])
  const [newType, setNewType] = useState('')
  const [busy, setBusy] = useState(false)

  const reloadTypes = useCallback(() => fetchActivityTypes().then((all) => setTypes((all || []).filter((t) => t.kind === 'volunteer'))), [])
  useEffect(() => { reloadTypes() }, [reloadTypes])

  async function createType() {
    const lbl = newType.trim()
    if (!lbl) return
    const maxSort = Math.max(0, ...types.map((t) => t.sort_order || 0))
    const { data, error } = await supabase.from('activity_types').insert({ label: lbl, kind: 'volunteer', active: true, sort_order: maxSort + 1 }).select('id, label').single()
    if (error) return onToast(error.message?.includes('duplicate') ? 'That type already exists.' : 'Could not add type: ' + error.message)
    setNewType('')
    await reloadTypes()
    setTypeId(data.id)
    onToast(`Activity type "${lbl}" added (now reusable for future events).`)
  }

  async function save() {
    if (!heading.trim()) return onToast('Block needs a heading.')
    setBusy(true)
    try {
      const payload = {
        activity_type_id: typeId || null, heading: heading.trim(), description: desc.trim() || null,
        volunteers_needed: Number(needed) || 0, start_time: start || null, end_time: end || null, recruiting_method: method,
        attendance_mode: mode,
      }
      const { error } = editing
        ? await supabase.from('activity_blocks').update(payload).eq('id', block.id)
        : await supabase.from('activity_blocks').insert({ ...payload, activity_id: activityId, phase_id: phaseId || null, created_by: me?.id || null })
      if (error) throw error
      onToast(`Block "${heading.trim()}" ${editing ? 'updated' : 'added'}.`)
      onAdded()
    } catch (e) {
      onToast(`Could not ${editing ? 'update' : 'add'} block: ` + (e.message || e))
    } finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} title={editing ? 'Edit activity block' : 'Add activity block'}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div><span style={label}>Heading</span><input value={heading} onChange={(e) => setHeading(e.target.value)} placeholder="e.g. Kitchen Coordination" style={inputStyle} autoFocus /></div>
        <div>
          <span style={label}>Activity type (suggested from the shared list)</span>
          <select value={typeId} onChange={(e) => setTypeId(e.target.value)} style={selStyle}>
            <option value="">— none —</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <input value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="…or create a new type" style={{ ...inputStyle, fontSize: 12 }} />
            <button className="btn btn-ghost" style={{ padding: '6px 11px', fontSize: 12, whiteSpace: 'nowrap' }} onClick={createType}>Add type</button>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ width: 120 }}><span style={label}>Needed / day</span><input type="number" min={0} value={needed} onChange={(e) => setNeeded(e.target.value)} style={inputStyle} /></div>
          <div style={{ flex: 1 }}><span style={label}>Recruiting</span>
            <select value={method} onChange={(e) => setMethod(e.target.value)} style={selStyle}>
              <option value="manual">Manual — pick from Volunteers</option>
              <option value="broadcast">Broadcast — WhatsApp tap-to-accept</option>
              <option value="form">Form — controlled intake</option>
            </select>
          </div>
        </div>
        <div>
          <span style={label}>Attendance mode {!editing && <span style={{ fontWeight: 400, color: 'var(--muted-2)' }}>· inherited default, editable</span>}</span>
          <select value={mode} onChange={(e) => setMode(e.target.value)} style={selStyle}>
            {ATTENDANCE_MODES.map((m) => <option key={m} value={m}>{MODE_LABEL[m]}</option>)}
          </select>
          <div style={{ fontSize: 11.5, color: 'var(--muted)', marginTop: 4 }}>{MODE_HINT[mode]}</div>
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ flex: 1 }}><span style={label}>Start time (optional)</span><input type="time" value={start} onChange={(e) => setStart(e.target.value)} style={inputStyle} /></div>
          <div style={{ flex: 1 }}><span style={label}>End time (optional)</span><input type="time" value={end} onChange={(e) => setEnd(e.target.value)} style={inputStyle} /></div>
        </div>
        <div><span style={label}>Description (optional)</span><textarea value={desc} onChange={(e) => setDesc(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} /></div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : editing ? 'Save' : 'Add block'}</button>
        </div>
      </div>
    </Modal>
  )
}

const METHOD_LABEL = { manual: 'Manual pick', broadcast: 'Broadcast', form: 'Form' }

function BlockCard({ block, days, isCoordinator, me, assignments, acceptances, people, eventName, onToast, onChanged, onEdit }) {
  const [open, setOpen] = useState(false)
  const [picking, setPicking] = useState(null) // day being assigned
  const [broadcast, setBroadcast] = useState(false)
  const [recording, setRecording] = useState(false)

  // Destructive-action guard: a block that already holds MARKED attendance (present /
  // absent / involved on its assignments, or event-level walk-in rows tagged to it) is
  // ARCHIVED (soft-deleted, records preserved). Only an attendance-free block may be
  // hard-deleted — and even then we warn about the staffing plan the cascade removes.
  async function removeBlock() {
    const markedAssign = assignments.filter((a) => ['show', 'no_show', 'involved'].includes(a.status)).length
    const { count: attCount } = await supabase.from('attendance').select('id', { count: 'exact', head: true }).eq('block_id', block.id)
    const marked = markedAssign + (attCount || 0)
    if (marked > 0) {
      if (!window.confirm(`"${block.heading}" has ${marked} marked attendance record(s). It will be ARCHIVED — hidden from planning but all attendance is preserved. Continue?`)) return
      const { error } = await supabase.from('activity_blocks').update({ archived_at: new Date().toISOString() }).eq('id', block.id)
      if (error) return onToast('Could not archive: ' + error.message)
      onToast(`Block "${block.heading}" archived (attendance preserved).`)
      return onChanged()
    }
    const plan = assignments.length + acceptances.length
    const msg = plan
      ? `Delete "${block.heading}"? No attendance is marked, but ${assignments.length} assignment(s) and ${acceptances.length} pool acceptance(s) will be removed. This cannot be undone.`
      : `Delete "${block.heading}"? This cannot be undone.`
    if (!window.confirm(msg)) return
    const { error } = await supabase.from('activity_blocks').delete().eq('id', block.id)
    if (error) return onToast('Could not delete: ' + error.message)
    onToast(`Block "${block.heading}" deleted.`)
    onChanged()
  }

  const needed = block.volunteers_needed
  const perDay = (block.attendance_mode || 'per_day') === 'per_day'
  const dayFill = days.map((d) => ({ day: d, filled: fillCount(assignments, d), needed }))
  // span / involved_only are staffed once for the whole block, not per day.
  const spanFill = assignments.filter((a) => ['assigned', 'show', 'involved'].includes(a.status)).length
  const shortfall = perDay ? dayFill.some((d) => d.filled < d.needed) : spanFill < needed

  // Backfill a day from the acceptance pool (accepted that day, not yet assigned).
  async function backfill(day) {
    const assignedIds = new Set(assignments.filter((a) => a.day_date === day && a.status !== 'no_show' && a.status !== 'dropped').map((a) => a.person_id))
    const pool = acceptances.filter((ac) => (ac.day_dates || []).includes(day) && !assignedIds.has(ac.person_id))
    if (!pool.length) return onToast('No one in the backfill pool for this day.')
    const pick = pool[0]
    const { error } = await supabase.from('block_assignments').insert({ block_id: block.id, person_id: pick.person_id, day_date: day, status: 'assigned', is_backfill: true, assigned_by: me?.id || null })
    if (error) return onToast(error.message?.includes('duplicate') ? 'Already assigned that day.' : 'Could not backfill: ' + error.message)
    onToast(`${people[pick.person_id]?.full_name || 'Volunteer'} backfilled into ${fmtDay(day)}.`)
    onChanged()
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 12, cursor: 'pointer', flexWrap: 'wrap' }} onClick={() => setOpen((o) => !o)}>
        <div style={{ flex: 1, minWidth: 160 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <div style={{ fontSize: 15, fontWeight: 600 }}>{block.heading}</div>
            <span className="pill" style={{ background: '#F1EADD', color: '#8C7E6B', fontSize: 10 }}>{MODE_LABEL[block.attendance_mode || 'per_day']}</span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>
            {needed}/{perDay ? 'day' : 'block'} · {METHOD_LABEL[block.recruiting_method]}{block.start_time ? ` · ${block.start_time.slice(0, 5)}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {perDay ? dayFill.map((d) => (
            <span key={d.day} title={fmtDay(d.day)} style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: d.filled >= d.needed ? '#EAF2E5' : '#FBEAD9', color: d.filled >= d.needed ? '#4E7C3F' : '#C2691F' }}>
              {days.length > 1 ? `${fmtDay(d.day).split(' ')[0]} ` : ''}{d.filled}/{d.needed}
            </span>
          )) : (
            <span style={{ fontSize: 11, fontWeight: 600, padding: '3px 8px', borderRadius: 6, background: spanFill >= needed ? '#EAF2E5' : '#FBEAD9', color: spanFill >= needed ? '#4E7C3F' : '#C2691F' }}>{spanFill}/{needed}</span>
          )}
        </div>
        {isCoordinator && (
          <button title="Edit block" onClick={(e) => { e.stopPropagation(); onEdit && onEdit() }}
            style={{ fontSize: 12, fontWeight: 600, padding: '4px 9px', borderRadius: 7, border: '1px solid var(--border)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer' }}>✎ Edit</button>
        )}
        <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>{open ? '▲' : '▼'}</span>
      </div>

      {open && (
        <div style={{ borderTop: '1px solid var(--border)', padding: '14px 18px', background: 'var(--panel)' }}>
          {block.description && <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginBottom: 12 }}>{block.description}</div>}
          {isCoordinator && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
              {block.recruiting_method === 'broadcast' && <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setBroadcast(true)}>Compose broadcast</button>}
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setRecording(true)}>Record reply</button>
              <span style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>Pool: {acceptances.length} accepted</span>
              <button className="btn btn-ghost" style={{ fontSize: 12, marginLeft: 'auto' }} onClick={() => onEdit && onEdit()}>Edit block</button>
              <button onClick={removeBlock} style={{ fontSize: 12, fontWeight: 600, padding: '7px 11px', borderRadius: 8, border: '1px solid #E7C9B8', background: '#fff', color: '#B5532F', cursor: 'pointer' }}>Remove…</button>
            </div>
          )}
          {acceptances.length > 0 && (
            <div style={{ marginBottom: 14, background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 12px' }}>
              <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', marginBottom: 5 }}>Pool — accepted, available to assign / backfill</div>
              {acceptances.map((ac) => (
                <div key={ac.id} style={{ display: 'flex', gap: 8, fontSize: 12, padding: '2px 0' }}>
                  <span style={{ fontWeight: 600 }}>{people[ac.person_id]?.full_name || 'Unknown'}</span>
                  <span style={{ color: 'var(--muted)' }}>{(ac.day_dates || []).map(fmtDay).join(', ')}</span>
                </div>
              ))}
            </div>
          )}

          {/* per_day → a slot group per day; span / involved_only → one group for the
              whole block, staffed once (canonical date = the block's first day). */}
          {(perDay ? days : days.slice(0, 1)).map((day) => {
            const dayAsg = perDay ? assignments.filter((a) => a.day_date === day) : assignments
            const active = dayAsg.filter((a) => a.status === 'assigned' || a.status === 'show' || a.status === 'involved')
            const openSlots = Math.max(0, needed - active.length)
            const poolCount = acceptances.filter((ac) => (ac.day_dates || []).includes(day) && !active.some((a) => a.person_id === ac.person_id)).length
            return (
              <div key={day} style={{ marginBottom: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                  <div style={{ fontSize: 12.5, fontWeight: 700 }}>{perDay ? fmtDay(day) : 'Whole block'}</div>
                  <span style={{ fontSize: 11, color: active.length >= needed ? '#4E7C3F' : '#C2691F', fontWeight: 600 }}>{active.length}/{needed}</span>
                  {isCoordinator && openSlots > 0 && <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 11.5 }} onClick={() => setPicking(day)}>＋ Assign</button>}
                  {isCoordinator && openSlots > 0 && poolCount > 0 && <button className="btn btn-ghost" style={{ padding: '4px 9px', fontSize: 11.5 }} onClick={() => backfill(day)}>Backfill ({poolCount})</button>}
                </div>
                {dayAsg.length === 0 && <div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>No one assigned.</div>}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {dayAsg.map((a) => (
                    <AssignmentRow key={a.id} a={a} person={people[a.person_id]} />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {picking && <AssignPicker block={block} day={picking} me={me} assignments={assignments} onClose={() => setPicking(null)} onToast={onToast} onDone={() => { setPicking(null); onChanged() }} />}
      {broadcast && <BroadcastComposer block={block} days={days} eventName={eventName} onClose={() => setBroadcast(false)} />}
      {recording && <RecordAcceptanceDialog block={block} days={days} onClose={() => setRecording(false)} onToast={onToast} onDone={() => { setRecording(false); onChanged() }} />}
    </div>
  )
}

// Read-only on Planning — show/no-show is MARKED on the Attendance page. Status
// here reflects whatever was marked there (and drives fill/backfill).
function AssignmentRow({ a, person }) {
  const STATUS = { assigned: { t: 'assigned', c: 'var(--muted)' }, show: { t: 'showed', c: '#4E7C3F' }, no_show: { t: 'no-show', c: '#B5532F' }, dropped: { t: 'dropped', c: '#9C4A14' } }
  const s = STATUS[a.status] || STATUS.assigned
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: '7px 10px' }}>
      <div style={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
        {person?.full_name || 'Unknown'}{a.is_backfill && <span style={{ fontSize: 10, color: 'var(--muted-2)', marginLeft: 6 }}>backfill</span>}
      </div>
      <span style={{ fontSize: 11, fontWeight: 600, color: s.c }}>{s.t}</span>
    </div>
  )
}

// Manual pick from Volunteers, ordered for targeting: interested first, then
// done_count (specialists), then reliability. Choice stays open — any volunteer.
// Dual-source add-to-block. DEFAULT source = this occurrence's Event Interest pool
// (people who registered interest in this event); secondary = the Volunteers master.
// Both resolve to canonical people and write the same block_assignments set.
function AssignPicker({ block, day, me, assignments, onClose, onToast, onDone }) {
  const [source, setSource] = useState('interest') // land on Event Interest first
  const [busy, setBusy] = useState(false)
  const alreadyDay = new Set(assignments.filter((a) => a.day_date === day && a.status !== 'no_show' && a.status !== 'dropped').map((a) => a.person_id))

  async function assign(p) {
    setBusy(true)
    try {
      const { error } = await supabase.from('block_assignments').insert({ block_id: block.id, person_id: p.id, day_date: day, status: 'assigned', assigned_by: me?.id || null })
      if (error) throw error
      onToast(`${p.full_name} assigned to ${fmtDay(day)}.`)
      onDone()
    } catch (e) {
      onToast(e.message?.includes('duplicate') ? 'Already assigned that day.' : 'Could not assign: ' + (e.message || e))
    } finally { setBusy(false) }
  }

  const Tab = ({ k, label }) => (
    <button onClick={() => setSource(k)} className="btn" style={{ padding: '7px 12px', fontSize: 12, borderRadius: 20, background: source === k ? '#241B14' : '#fff', color: source === k ? '#F6ECDC' : 'var(--ink-soft)', border: source === k ? 'none' : '1px solid var(--border)' }}>{label}</button>
  )

  return (
    <Modal onClose={onClose} title={`Add to ${block.heading} · ${fmtDay(day)}`}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <Tab k="interest" label="From Event Interest" />
        <Tab k="volunteers" label="From Volunteers" />
      </div>
      {source === 'interest'
        ? <InterestSource activityId={block.activity_id} alreadyDay={alreadyDay} busy={busy} onAssign={assign} />
        : <VolunteerSource block={block} alreadyDay={alreadyDay} busy={busy} onAssign={assign} />}
    </Modal>
  )
}

// Priority source: people who registered interest in THIS occurrence (event-wide).
function InterestSource({ activityId, alreadyDay, busy, onAssign }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: ei } = await supabase.from('event_interest').select('person_id').eq('activity_id', activityId)
      const ids = [...new Set((ei || []).map((r) => r.person_id))]
      if (!ids.length) { if (alive) setRows([]); return }
      const { data: ppl } = await supabase.from('people').select('id, full_name, phone, pincode').in('id', ids)
      if (alive) setRows((ppl || []).map((p) => ({ ...p, _meta: [p.phone, p.pincode].filter(Boolean).join(' · ') || '—' })))
    })()
    return () => { alive = false }
  }, [activityId])
  if (!rows) return <Loading label="Loading interest…" />
  if (!rows.length) return <Empty label="No one has registered interest for this event yet. Share the interest link, or switch to Volunteers." />
  return <><div style={{ fontSize: 11, color: 'var(--muted-2)', marginBottom: 8 }}>Registered interest in this event.</div><PickList rows={rows} alreadyDay={alreadyDay} busy={busy} onAssign={onAssign} /></>
}

// Secondary source: the Volunteers master, ordered interested → done → reliability.
function VolunteerSource({ block, alreadyDay, busy, onAssign }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let alive = true
    const t = setTimeout(async () => {
      let query = supabase.from('people').select('id, full_name, phone, pincode').eq('is_volunteer', true).limit(40)
      if (q.trim()) query = query.or(`full_name.ilike.%${q.trim()}%,phone.ilike.%${q.trim()}%`)
      const { data } = await query
      if (!alive) return
      const ppl = data || []
      const ids = ppl.map((p) => p.id)
      const [rel, stats, intr] = await Promise.all([
        ids.length ? supabase.from('volunteer_reliability').select('person_id, reliability_pct').in('person_id', ids) : { data: [] },
        block.activity_type_id && ids.length ? supabase.from('volunteer_activity_stats').select('person_id, done_count').eq('activity_type_id', block.activity_type_id).in('person_id', ids) : { data: [] },
        block.activity_type_id && ids.length ? supabase.from('volunteer_activity_interest').select('person_id').eq('activity_type_id', block.activity_type_id).in('person_id', ids) : { data: [] },
      ])
      const relMap = Object.fromEntries((rel.data || []).map((r) => [r.person_id, r.reliability_pct]))
      const doneMap = Object.fromEntries((stats.data || []).map((r) => [r.person_id, r.done_count]))
      const intrSet = new Set((intr.data || []).map((r) => r.person_id))
      const enriched = ppl.map((p) => {
        const done = doneMap[p.id] || 0, rel2 = relMap[p.id]
        return { ...p, _interested: intrSet.has(p.id), _done: done, _rel: rel2, _meta: `${rel2 != null ? `${rel2}% reliable` : 'no history'} · done ${done}×${p.pincode ? ` · ${p.pincode}` : ''}` }
      })
      enriched.sort((a, b) => (b._interested - a._interested) || (b._done - a._done) || ((b._rel ?? -1) - (a._rel ?? -1)))
      setRows(enriched)
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [q, block.activity_type_id])
  return (
    <>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search volunteers by name or phone…" style={{ ...inputStyle, marginBottom: 8 }} autoFocus />
      {!rows ? <Loading label="Loading…" /> : rows.length === 0 ? <Empty label="No volunteers match." /> : <PickList rows={rows} alreadyDay={alreadyDay} busy={busy} onAssign={onAssign} />}
    </>
  )
}

function PickList({ rows, alreadyDay, busy, onAssign }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 360, overflowY: 'auto' }} className="scrollarea">
      {rows.map((p, i) => (
        <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--border)', borderRadius: 9, padding: '8px 11px' }}>
          <div style={{ width: 32, height: 32, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(p.full_name || '?')}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.full_name || 'Unknown'}
              {p._interested && <span className="pill" style={{ background: '#EAF2E5', color: '#4E7C3F', marginLeft: 6, fontSize: 10 }}>interested</span>}
            </div>
            <div style={{ fontSize: 11, color: 'var(--muted)' }}>{p._meta}</div>
          </div>
          {alreadyDay.has(p.id) ? <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>assigned</span> : (
            <button className="btn btn-primary" disabled={busy} style={{ padding: '6px 12px', fontSize: 12 }} onClick={() => onAssign(p)}>Assign</button>
          )}
        </div>
      ))}
    </div>
  )
}

// Broadcast: a shareable WhatsApp message listing this block as a tap-to-accept
// option. The accepter replies / a coordinator records it into the pool. (A fully
// public auto-landing endpoint is a separate surface; this drives the outreach.)
function BroadcastComposer({ block, days, eventName, onClose }) {
  const acceptUrl = `${window.location.origin}${window.location.pathname}#accept=${block.id}`
  const text = `🙏 Namaskaram! Volunteers needed for *${block.heading}* at ${eventName} (${block.volunteers_needed}/day).\n\n${days.map((d) => `• ${fmtDay(d)}`).join('\n')}\n\n👉 Tap to accept & choose your days:\n${acceptUrl}`
  return (
    <Modal onClose={onClose} title="Broadcast — tap to accept">
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 10 }}>Share this on your volunteer WhatsApp group. The link opens a no-login page where they pick days — replies land as typed acceptances in this block's pool.</div>
      <textarea readOnly value={text} rows={8} style={{ ...inputStyle, resize: 'vertical', marginBottom: 10 }} />
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
        <button className="btn btn-ghost" onClick={() => { navigator.clipboard?.writeText(text) }}>Copy</button>
        <a className="btn btn-primary" href={waHref('', text)} target="_blank" rel="noreferrer" style={{ textDecoration: 'none' }}>Open WhatsApp</a>
      </div>
    </Modal>
  )
}

// Coordinator records a reply (e.g. a WhatsApp message) into the block's pool as a
// typed acceptance. Resolves to an existing person by name/phone.
function RecordAcceptanceDialog({ block, days, onClose, onToast, onDone }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState(null)
  const [sel, setSel] = useState(null)
  const [pickDays, setPickDays] = useState(days)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    const t = setTimeout(async () => {
      let query = supabase.from('people').select('id, full_name, phone, pincode').limit(30)
      if (q.trim()) query = query.or(`full_name.ilike.%${q.trim()}%,phone.ilike.%${q.trim()}%`)
      else query = query.eq('is_volunteer', true)
      const { data } = await query
      if (alive) setRows(data || [])
    }, 250)
    return () => { alive = false; clearTimeout(t) }
  }, [q])

  const toggle = (d) => setPickDays((ds) => (ds.includes(d) ? ds.filter((x) => x !== d) : [...ds, d]))

  async function save() {
    if (!sel) return onToast('Pick a person.')
    if (!pickDays.length) return onToast('Pick at least one day.')
    setBusy(true)
    try {
      const { error } = await supabase.from('block_acceptances').upsert(
        { block_id: block.id, person_id: sel.id, day_dates: pickDays, method: 'manual' }, { onConflict: 'block_id,person_id' })
      if (error) throw error
      onToast(`${sel.full_name} added to the pool.`)
      onDone()
    } catch (e) {
      onToast('Could not record: ' + (e.message || e))
    } finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} title={`Record reply · ${block.heading}`}>
      {!sel ? (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or phone…" style={{ ...inputStyle, marginBottom: 10 }} autoFocus />
          {!rows ? <Loading label="Loading…" /> : rows.length === 0 ? <Empty label="No match." /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }} className="scrollarea">
              {rows.map((p, i) => (
                <div key={p.id} onClick={() => setSel(p)} className="rowhover" style={{ display: 'flex', alignItems: 'center', gap: 10, border: '1px solid var(--border)', borderRadius: 9, padding: '8px 11px', cursor: 'pointer' }}>
                  <div style={{ width: 30, height: 30, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 600 }}>{initials(p.full_name || '?')}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{p.full_name || 'Unknown'}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{p.phone || 'no phone'}{p.pincode ? ` · ${p.pincode}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ fontSize: 13.5, marginBottom: 12 }}>Recording <strong>{sel.full_name}</strong> — which days?</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 16 }}>
            {days.map((d) => (
              <label key={d} style={{ display: 'flex', alignItems: 'center', gap: 7, border: `1px solid ${pickDays.includes(d) ? 'var(--orange)' : 'var(--border)'}`, background: pickDays.includes(d) ? '#FBF1E6' : '#fff', borderRadius: 8, padding: '7px 11px', cursor: 'pointer' }}>
                <input type="checkbox" checked={pickDays.includes(d)} onChange={() => toggle(d)} />
                <span style={{ fontSize: 12.5, fontWeight: 600 }}>{fmtDay(d)}</span>
              </label>
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
            <button className="btn btn-ghost" onClick={() => setSel(null)}>‹ Back</button>
            <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Add to pool'}</button>
          </div>
        </>
      )}
    </Modal>
  )
}

// -------------------------------------------------------------------- shared modal
function Modal({ title, onClose, children }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, zIndex: 120, overflowY: 'auto' }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 540, width: '100%', marginTop: 40, padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h3 style={{ fontSize: 17, fontWeight: 600, margin: 0 }}>{title}</h3>
          <div onClick={onClose} style={{ fontSize: 13, fontWeight: 600, color: 'var(--orange)', cursor: 'pointer' }}>✕ Close</div>
        </div>
        {children}
      </div>
    </div>
  )
}
