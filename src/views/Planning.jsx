import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Pad, ErrorCard, Loading, Empty } from '../components/View'
import { pill } from '../lib/ui'
import { fetchActivityTypes } from '../lib/activityTypes'
import EventList from '../components/EventList'
import CreateTeamForm from '../components/CreateTeamForm'
import { CreateSessionForm } from './Events'
import { eventDays, currentPhase, phaseTone, groupPhases, PHASE_SHORT, flaggedPhases, FLAG_META, fmtDay, rangeLabel } from '../lib/planning'
import { ensureSeriesWindow } from '../lib/series'

// Planning = the per-event TO-DO LIST + action launchers (block/team editing lives in
// the Teams tab now). Phases remain as the invisible backbone (current-phase pill +
// notifications). Event CREATION lives at the site-toolbar entry point (CreateEventModal).

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
