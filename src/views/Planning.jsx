import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Pad, ErrorCard, Loading, Empty } from '../components/View'
import { pill } from '../lib/ui'
import { fetchActivityTypes } from '../lib/activityTypes'
import EventList from '../components/EventList'
import CreateTeamForm from '../components/CreateTeamForm'
import { CreateSessionForm } from './Events'
import { AddImport } from './Interest'
import KebabMenu from '../components/KebabMenu'
import { eventDays, fmtDay, rangeLabel } from '../lib/planning'
import { ensureSeriesWindow } from '../lib/series'

// Planning = the per-event TO-DO LIST + action launchers (block/team editing lives in
// the Teams tab now). Phases remain as the invisible backbone (current-phase pill +
// notifications). Event CREATION lives at the site-toolbar entry point (CreateEventModal).

export default function Planning({ me, isCoordinator, onToast, openEventId = null, onEventConsumed, onCreateEvent }) {
  const [events, setEvents] = useState(null)
  const [err, setErr] = useState(null)
  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    setErr(null)
    await ensureSeriesWindow().catch(() => {}) // roll the recurring-event window forward
    const a = await supabase.from('activities').select('id, name, center_id, activity_date, start_date, end_date, activity_type_id, description, series_id, default_attendance_mode').is('archived_at', null).order('start_date', { ascending: true })
    if (a.error) { setErr(a.error.message); setEvents([]); return }
    setEvents(a.data || [])
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
      <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--muted)' }}>Staff volunteers for each event — activity blocks, per-day slots, recruiting.</p>
      <EventList events={events} onOpen={setOpenId} right={isCoordinator && onCreateEvent && (
        <button className="btn btn-primary" style={{ fontSize: 12, padding: '8px 14px' }} onClick={() => onCreateEvent()}>＋ Create event</button>
      )} />
    </Pad>
  )
}

// ------------------------------------------------------------- Event planning detail
// Phases (from the template) group the activity blocks. Each phase carries a date
// The per-event surface is the to-do list. Teams live in the Teams tab and
// attendance sessions in the Attendance tab; nothing is duplicated here.
export function PlanningEvent({ ev, me, isCoordinator, onBack, onToast, onStartCampaign, onOpenInterest, embedded = false }) {
  const eventSpan = eventDays(ev.start_date, ev.end_date)

  const inner = (
    <>
      {!embedded && (
        <div onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: 'var(--orange)', cursor: 'pointer', marginBottom: 16 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
          Calendar
        </div>
      )}

      {/* Event header only on the standalone page — redundant in the Event Hub,
          which already shows name and date above the tabs. */}
      {!embedded && (
        <div className="card" style={{ padding: 22, marginBottom: 18 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 14, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 21, fontWeight: 600, margin: '0 0 3px' }}>{ev.name}</h2>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{rangeLabel(ev.start_date, ev.end_date)} · {eventSpan.length} day{eventSpan.length !== 1 ? 's' : ''} · {ev.center_id}</div>
            </div>
          </div>
        </div>
      )}
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

function EventTodos({ ev, me, isCoordinator, onToast, onStartCampaign, onOpenInterest }) {
  const [rows, setRows] = useState(null)
  const [text, setText] = useState('')
  const [date, setDate] = useState('')
  const [busy, setBusy] = useState(false)
  const [launch, setLaunch] = useState(null)   // { todo, kind } for inline modals
  const [dragId, setDragId] = useState(null)   // to-do id being dragged
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
  function toggleStar(r) { return patch(r.id, { is_priority: !r.is_priority }) }
  async function remove(r) { if (!window.confirm(`Delete to-do “${r.text}”?`)) return; const { error } = await supabase.from('event_todos').delete().eq('id', r.id); if (error) return onToast('Could not delete: ' + error.message); load() }
  // Drag-to-reorder: drop `fromId` at `toId`'s position, renumber sort_order, persist.
  async function reorder(fromId, toId) {
    if (!fromId || fromId === toId) return
    const arr = [...rows]
    const from = arr.findIndex((r) => r.id === fromId)
    const to = arr.findIndex((r) => r.id === toId)
    if (from < 0 || to < 0) return
    const [moved] = arr.splice(from, 1); arr.splice(to, 0, moved)
    setRows(arr.map((r, i) => ({ ...r, sort_order: i }))) // optimistic
    await Promise.all(arr.map((r, i) => supabase.from('event_todos').update({ sort_order: i }).eq('id', r.id)))
    load()
  }

  function pickAction(todo, kind) {
    // Attendance / team / interest all run IN-CONTEXT as modals — no navigation, so the
    // event context is never lost. Only campaign navigates (it needs the Volunteers table
    // to build a call-list); it stashes a link-back token resolved when we return.
    if (kind === 'attendance' || kind === 'team' || kind === 'interest') { setLaunch({ todo, kind }); return }
    localStorage.setItem('todo_pending', JSON.stringify({ todoId: todo.id, actionKind: kind, activityId: ev.id, since: new Date().toISOString() }))
    return onStartCampaign ? onStartCampaign(ev.id, ev.name, 'volunteer') : onToast('Campaign flow unavailable here.')
  }

  if (rows === null) return <Loading label="Loading to-dos…" />
  const done = rows.filter((r) => r.done).length
  // Starred to-dos float to the top; stable sort preserves each group's existing drag order.
  const displayRows = [...rows].sort((a, b) => (b.is_priority ? 1 : 0) - (a.is_priority ? 1 : 0))
  return (
    <div className="card" style={{ padding: 18 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>To-do</h3>
        <span className="pill" style={{ ...pill('var(--neutral-bg)', 'var(--neutral-fg)'), fontSize: 11 }}>{done}/{rows.length} done</span>
      </div>
      {rows.length === 0 && <Empty label="No to-dos yet — add the first below." />}
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {displayRows.map((r) => (
          <TodoRow key={r.id} r={r} isCoordinator={isCoordinator}
            onToggle={() => toggleDone(r)} onStar={() => toggleStar(r)} onText={(v) => patch(r.id, { text: v })} onDate={(v) => patch(r.id, { due_date: v || null })}
            onDelete={() => remove(r)} onPick={(k) => pickAction(r, k)}
            dragging={dragId === r.id}
            onDragStart={() => setDragId(r.id)} onDragEnd={() => setDragId(null)}
            onDragOver={(e) => e.preventDefault()} onDrop={() => { reorder(dragId, r.id); setDragId(null) }} />
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
      {launch?.kind === 'interest' && (
        <AddImport lockEventId={ev.id} me={me} onToast={onToast} onClose={() => setLaunch(null)}
          onDone={() => { stamp(launch.todo.id, 'event_interest', null).then(() => { setLaunch(null); load(); onToast('Interest added — checked off the to-do.') }) }} />
      )}
    </div>
  )
}

function TodoRow({ r, isCoordinator, onToggle, onStar, onText, onDate, onDelete, onPick, dragging, onDragStart, onDragEnd, onDragOver, onDrop }) {
  // Two lines: text is NEVER shared with the date control (that's what let the date
  // input crowd/cover to-do text on narrow screens) — date + the actions menu sit on
  // their own row below, indented to align under the text.
  return (
    <div draggable={isCoordinator} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragOver={onDragOver} onDrop={onDrop}
      style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 0', borderBottom: '1px solid #F4EEE2', opacity: dragging ? 0.4 : 1, background: dragging ? '#FBF1E6' : 'transparent' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {isCoordinator && <span title="Drag to reorder" style={{ cursor: 'grab', color: 'var(--muted-2)', fontSize: 14, flexShrink: 0, userSelect: 'none' }}>⠿</span>}
        <input type="checkbox" checked={!!r.done} disabled={!isCoordinator} onChange={onToggle} style={{ width: 16, height: 16, flexShrink: 0, cursor: isCoordinator ? 'pointer' : 'default' }} />
        <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          {isCoordinator ? (
            <input defaultValue={r.text} key={r.text} onBlur={(e) => { const v = e.target.value.trim(); if (v && v !== r.text) onText(v) }}
              style={{ flex: 1, minWidth: 0, border: 'none', outline: 'none', fontSize: 13.5, background: 'transparent', fontFamily: 'inherit', color: r.done ? 'var(--muted-2)' : 'var(--ink)', textDecoration: r.done ? 'line-through' : 'none' }} />
          ) : (
            <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, color: r.done ? 'var(--muted-2)' : 'var(--ink)', textDecoration: r.done ? 'line-through' : 'none' }}>{r.text}</span>
          )}
          {(r.linked_id || r.linked_type) && <span className="pill" style={{ ...pill('var(--success-bg)', 'var(--success-fg)'), fontSize: 9.5, flexShrink: 0 }}>{r.action_kind || 'linked'} ✓</span>}
        </div>
        {/* Priority star: a primary, always-visible action — never hidden behind the menu. */}
        <button className="tap44" title={r.is_priority ? 'Unstar' : 'Mark as priority'} disabled={!isCoordinator} onClick={onStar}
          style={{ flexShrink: 0, background: 'none', border: 'none', fontSize: 16, lineHeight: 1, padding: '2px 4px', cursor: isCoordinator ? 'pointer' : 'default', color: r.is_priority ? '#C2691F' : 'var(--muted-2)' }}>{r.is_priority ? '★' : '☆'}</button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingLeft: isCoordinator ? 40 : 24 }}>
        {isCoordinator ? (
          <input type="date" value={r.due_date || ''} onChange={(e) => onDate(e.target.value)}
            style={{ fontSize: 11.5, padding: '3px 6px', border: '1px solid var(--border)', borderRadius: 7, background: '#fff', color: 'var(--ink-soft)', flexShrink: 0 }} />
        ) : r.due_date ? <span style={{ fontSize: 11.5, color: 'var(--muted)', flexShrink: 0 }}>{fmtDay(r.due_date)}</span> : null}
        {isCoordinator && (
          <div style={{ marginLeft: 'auto' }}>
            <KebabMenu items={[
              ...TODO_ACTIONS.map((a) => ({ label: a.label + ' →', onClick: () => onPick(a.kind) })),
              { label: 'Delete to-do', onClick: onDelete, danger: true },
            ]} />
          </div>
        )}
      </div>
    </div>
  )
}
