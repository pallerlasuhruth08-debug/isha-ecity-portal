import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { pill, initials, avatarFor } from '../lib/ui'
import { Pad, ErrorCard, Loading, Empty } from '../components/View'
import WalkinCapture from '../components/WalkinCapture'
import { ensureParticipation } from '../lib/volunteers'
import { fetchActivityTypes } from '../lib/activityTypes'
import { fmtDay, effectiveStage, generateOccurrences } from '../lib/planning'
import EventList, { EventCalendarPanel } from '../components/EventList'
import RecurrenceFields, { toRule } from '../components/RecurrenceFields'

// ────────────────────────────────────────────────────────────────────────────
// BOUNDARY (do not remove): Event CREATION and MANAGEMENT live HERE, on the
// Events screen, permanently. Coordinators create/run/type events from this
// screen. The "view-only" rule from the Planning work applies ONLY to how
// Planning CONSUMES events (Planning reads events + edits stage, read-only) — it
// must NEVER make this Events screen read-only or strip the Create-event action.
// If you're tempted to remove "Create event", you're re-introducing a recurring
// regression. Keep it.
// ────────────────────────────────────────────────────────────────────────────

// Three-stage lifecycle (matches the event_stages CHECK + the Planning page).
const STAGES = ['Planning', 'Ongoing', 'Done']
const STAGE_PILL = {
  Planning: pill('#FBEAD9', '#C28A2A'),
  Ongoing: pill('#F6E8D8', '#C2691F'),
  Done: pill('#EAF2E5', '#4E7C3F'),
}
const STAGE_DOT = { Planning: '#C28A2A', Ongoing: '#C2691F', Done: '#4E7C3F' }

function fmtDate(d) {
  if (!d) return 'TBD'
  return new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function Events({ me, isCoordinator = false, onToast, openEventId = null, onEventConsumed }) {
  const [acts, setActs] = useState(null)
  const [stageRows, setStageRows] = useState({}) // activity_id -> {stage, manual}
  const [types, setTypes] = useState([])
  const [centers, setCenters] = useState([])
  const [creating, setCreating] = useState(null) // preset date | true
  const [showCal, setShowCal] = useState(false)
  const [err, setErr] = useState(null)
  const [openId, setOpenId] = useState(null)

  async function load() {
    try {
      const [a, s, t, c] = await Promise.all([
        supabase.from('activities').select('id, name, center_id, activity_date, start_date, end_date, activity_type, activity_type_id, is_open, description, archived_at, series_id').is('archived_at', null).order('start_date', { ascending: true }).limit(300),
        supabase.from('event_stages').select('activity_id, stage, manual'),
        fetchActivityTypes().catch(() => []),
        supabase.from('centers').select('id, name').order('name'),
      ])
      if (a.error) throw a.error
      if (s.error) throw s.error
      setActs(a.data || [])
      setStageRows(Object.fromEntries((s.data || []).map((r) => [r.activity_id, r])))
      setTypes(t || [])
      setCenters(c.data || [])
    } catch (e) {
      setErr(e.message || String(e))
    }
  }
  useEffect(() => {
    load()
  }, [])

  // Open a specific event when routed here (e.g. from the utility-drawer calendar).
  useEffect(() => {
    if (!openEventId || acts === null) return
    if (acts.some((a) => a.id === openEventId)) setOpenId(openEventId)
    onEventConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEventId, acts])

  async function setStage(activityId, stage) {
    setStageRows((p) => ({ ...p, [activityId]: { ...(p[activityId] || {}), stage, manual: true } }))
    const { error } = await supabase.from('event_stages').upsert({ activity_id: activityId, stage, manual: true, updated_at: new Date().toISOString() }, { onConflict: 'activity_id' })
    if (error) {
      onToast('Could not save stage: ' + error.message)
      load()
    }
  }

  const loading = !acts && !err
  const open = openId ? (acts || []).find((a) => a.id === openId) : null

  if (open) return <Detail activity={open} stage={effectiveStage(open, stageRows[open.id])} onStage={(st) => setStage(open.id, st)} onBack={() => setOpenId(null)} me={me} isCoordinator={isCoordinator} types={types} onActivityChanged={load} onToast={onToast} />

  return (
    <Pad>
      {/* Header: intro + the PERMANENT Create-event action (coordinators). See the
          BOUNDARY note at the top of this file — do not remove this. */}
      <p style={{ margin: '0 0 14px', fontSize: 13.5, color: 'var(--muted)' }}>Mark show / no-show for planned volunteers and capture walk-ins on the day.</p>
      {err && <ErrorCard>Couldn't load events: {err}</ErrorCard>}
      {loading ? <Loading label="Loading events…" /> : (
        <EventList events={acts} stageRows={stageRows} onOpen={setOpenId} right={isCoordinator && (
          <>
            <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '8px 13px' }} onClick={() => setShowCal(true)}>📅 Calendar</button>
            <button className="btn btn-primary" style={{ fontSize: 12.5, padding: '8px 14px' }} onClick={() => setCreating(true)}>＋ Create event</button>
          </>
        )} />
      )}

      {showCal && (
        <EventCalendarPanel events={acts || []} stageRows={stageRows}
          onOpen={(id) => { setShowCal(false); setOpenId(id) }}
          onCreateDay={isCoordinator ? (d) => { setShowCal(false); setCreating(d) } : undefined}
          onClose={() => setShowCal(false)} />
      )}

      {creating && (
        <CreateEventForm
          me={me}
          types={types}
          centers={centers}
          preset={creating === true ? '' : creating}
          onClose={() => setCreating(null)}
          onCreated={(id) => { setCreating(null); load().then(() => id && setOpenId(id)) }}
          onToast={onToast}
        />
      )}
    </Pad>
  )
}

// The permanent Create-event form (see BOUNDARY note at top of file). Inserts an
// activities row; RLS (act_all) allows coordinators / center coordinators.
function CreateEventForm({ me, types = [], centers = [], preset = '', onClose, onCreated, onToast }) {
  const [name, setName] = useState('')
  const [date, setDate] = useState(preset || '')
  const [centerId, setCenterId] = useState(me?.center_id && me.center_id !== 'all' ? me.center_id : '')
  const [typeId, setTypeId] = useState('')
  const [description, setDescription] = useState('')
  const [recur, setRecur] = useState({ freq: 'none' })
  const [busy, setBusy] = useState(false)

  async function create() {
    if (!name.trim()) return onToast('Give the event a name.')
    setBusy(true)
    try {
      const d0 = date || new Date().toISOString().slice(0, 10)
      const base = {
        name: name.trim(),
        center_id: centerId || me?.center_id || 'unassigned',
        activity_type_id: typeId || null,
        description: description.trim() || null,
        is_open: true,
        created_by: me?.id || null,
      }
      const rule = toRule(recur)
      if (rule.freq === 'none') {
        const { data, error } = await supabase.from('activities')
          .insert({ ...base, activity_date: d0, start_date: d0, end_date: d0 }).select('id').single()
        if (error) throw error
        onToast(`Event “${name.trim()}” created.`)
        onCreated?.(data.id)
      } else {
        // One INDEPENDENT activities row per occurrence, grouped by series_id.
        const seriesId = crypto.randomUUID()
        const ruleStr = JSON.stringify(rule)
        const rows = generateOccurrences(d0, rule).map((s) => ({ ...base, activity_date: s, start_date: s, end_date: s, series_id: seriesId, recurrence_rule: ruleStr }))
        const { data, error } = await supabase.from('activities').insert(rows).select('id')
        if (error) throw error
        onToast(`Created ${rows.length} occurrences of “${name.trim()}”.`)
        onCreated?.(data?.[0]?.id)
      }
    } catch (e) {
      onToast('Could not create event: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const inputStyle = { width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 12px', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: '#fff', color: 'var(--ink)' }
  const label = { display: 'block', fontSize: 12, fontWeight: 600, color: '#5C5142', marginBottom: 5, marginTop: 12 }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 130, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 460, maxWidth: '100%', padding: 24, boxShadow: 'var(--shadow-lg)', maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 2px' }}>Create event</h3>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>Attendance, walk-ins, to-dos and stage are managed on the event afterwards.</div>

        <label style={{ ...label, marginTop: 16 }}>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Pournami Devi seva" style={inputStyle} autoFocus />

        <label style={label}>Date</label>
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} style={inputStyle} />

        <label style={label}>Centre</label>
        <select value={centerId} onChange={(e) => setCenterId(e.target.value)} style={inputStyle}>
          <option value="">— select —</option>
          {centers.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
        </select>

        <label style={label}>Activity type</label>
        <select value={typeId} onChange={(e) => setTypeId(e.target.value)} style={inputStyle}>
          <option value="">— none —</option>
          <optgroup label="Volunteer">
            {types.filter((t) => t.kind === 'volunteer').map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </optgroup>
          <optgroup label="Meditator">
            {types.filter((t) => t.kind === 'meditator').map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </optgroup>
        </select>

        <label style={label}>Description (optional)</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />

        <label style={label}>Repeats</label>
        <RecurrenceFields value={recur} onChange={setRecur} />

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={create}>{busy ? 'Creating…' : toRule(recur).freq === 'none' ? 'Create event' : 'Create series'}</button>
        </div>
      </div>
    </div>
  )
}

function Detail({ activity, stage, onStage, onBack, me, isCoordinator, types = [], onActivityChanged, onToast }) {
  const [attendees, setAttendees] = useState(null)
  const [todos, setTodos] = useState([])
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [todoLabel, setTodoLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [editing, setEditing] = useState(false)
  const [typeChange, setTypeChange] = useState(null) // { newId } — keep-vs-propagate prompt
  const [busyAction, setBusyAction] = useState(false)

  async function load() {
    try {
      const [att, td] = await Promise.all([
        supabase.from('attendance').select('id, person_id, time_in, person:people!attendance_person_id_fkey(full_name)').eq('activity_id', activity.id).order('time_in', { ascending: false }),
        supabase.from('event_todos').select('id, label, when_label, kind, done').eq('activity_id', activity.id).order('created_at', { ascending: true }),
      ])
      if (att.error) throw att.error
      if (td.error) throw td.error
      setAttendees(att.data || [])
      setTodos(td.data || [])
    } catch (e) {
      setErr(e.message || String(e))
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.id])

  async function search(v) {
    setQ(v)
    if (v.trim().length < 2) return setResults([])
    const { data } = await supabase.from('people').select('id, full_name, phone').ilike('full_name', `%${v.trim()}%`).limit(8)
    setResults(data || [])
  }

  async function addAttendee(p) {
    setBusy(true)
    try {
      const { error } = await supabase.from('attendance').insert({ activity_id: activity.id, person_id: p.id, activity_type_id: activity.activity_type_id || null })
      if (error) throw error
      // Auto-promote by the event type's kind (meditator -> meditator, else volunteer).
      const kind = types.find((t) => t.id === activity.activity_type_id)?.kind || 'volunteer'
      await ensureParticipation(p.id, kind, { source: 'event_attendance' })
      setQ('')
      setResults([])
      onToast(`${p.full_name} marked present — confirmed as ${kind}.`)
      load()
    } catch (e) {
      onToast('Could not mark present: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function addTodo() {
    const label = todoLabel.trim()
    if (!label) return
    setTodoLabel('')
    const { data, error } = await supabase.from('event_todos').insert({ activity_id: activity.id, label }).select('id, label, when_label, kind, done').single()
    if (error) return onToast('Could not add to-do: ' + error.message)
    setTodos((t) => [...t, data])
  }
  async function toggleTodo(t) {
    setTodos((prev) => prev.map((x) => (x.id === t.id ? { ...x, done: !x.done } : x)))
    const { error } = await supabase.from('event_todos').update({ done: !t.done }).eq('id', t.id)
    if (error) {
      onToast('Could not update to-do')
      load()
    }
  }

  const resolved = (attendees || []).filter((r) => r.person_id)
  const unresolvedCount = (attendees || []).filter((r) => !r.person_id).length
  const attCount = resolved.length
  const totalAtt = attendees?.length ?? 0 // resolved + unresolved — the delete gate

  const nowISO = () => new Date().toISOString()
  const typeLabel = (id) => types.find((t) => t.id === id)?.label || '— none —'

  // Type edit with attendance present -> ask keep vs propagate (never auto-pick).
  function onTypeSelect(newId) {
    const id = newId || null
    if (id === (activity.activity_type_id || null)) return
    if (totalAtt > 0) { setTypeChange({ newId: id }); return }
    applyTypeChange(id, false)
  }
  async function applyTypeChange(newId, propagate) {
    setBusyAction(true)
    try {
      const { error } = await supabase.from('activities').update({ activity_type_id: newId, edited_at: nowISO(), edited_by: me?.id || null }).eq('id', activity.id)
      if (error) throw error
      if (propagate) {
        // Bulk-overwrite the stamped attendance for THIS event (coordinator chose this).
        const { error: e2 } = await supabase.from('attendance').update({ activity_type_id: newId }).eq('activity_id', activity.id)
        if (e2) throw e2
      }
      onToast(propagate ? `Type changed and applied to ${totalAtt} attendance record(s).` : 'Event type changed (existing attendance kept its captured type).')
      setTypeChange(null)
      onActivityChanged?.()
    } catch (e) { onToast('Could not change type: ' + (e.message || e)) } finally { setBusyAction(false) }
  }

  async function setArchived(on) {
    setBusyAction(true)
    try {
      const { error } = await supabase.from('activities').update({ archived_at: on ? nowISO() : null, archived_by: on ? me?.id || null : null }).eq('id', activity.id)
      if (error) throw error
      onToast(on ? 'Event archived (attendance preserved).' : 'Event unarchived.')
      onActivityChanged?.()
      if (on) onBack?.()
    } catch (e) { onToast('Could not archive: ' + (e.message || e)) } finally { setBusyAction(false) }
  }

  async function hardDelete() {
    if (totalAtt > 0) { onToast(`This event has ${totalAtt} attendance record(s) — archive instead of delete.`); return }
    if (!window.confirm(`Permanently delete “${activity.name}”? It has no attendance. Its stage & to-dos go with it. This cannot be undone.`)) return
    setBusyAction(true)
    try {
      const { error } = await supabase.from('activities').delete().eq('id', activity.id)
      if (error) throw error // RESTRICT FK also blocks if attendance somehow exists
      onToast('Event deleted.')
      onActivityChanged?.()
      onBack?.()
    } catch (e) { onToast('Could not delete: ' + (e.message || e)) } finally { setBusyAction(false) }
  }

  return (
    <Pad>
      <div onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: 'var(--orange)', cursor: 'pointer', marginBottom: 16 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
        All events
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px' }}>{activity.name}{activity.archived_at && <span className="pill" style={{ ...pill('#F1EADD', '#8C7E6B'), marginLeft: 10, verticalAlign: 'middle' }}>archived</span>}</h2>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{fmtDate(activity.activity_date)} · {activity.center_id}</div>
          </div>
          {isCoordinator && (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-ghost" disabled={busyAction} style={{ fontSize: 12.5, padding: '7px 12px' }} onClick={() => setEditing(true)}>Edit</button>
              {activity.archived_at
                ? <button className="btn btn-ghost" disabled={busyAction} style={{ fontSize: 12.5, padding: '7px 12px' }} onClick={() => setArchived(false)}>Unarchive</button>
                : <button className="btn btn-ghost" disabled={busyAction} style={{ fontSize: 12.5, padding: '7px 12px' }} onClick={() => setArchived(true)}>Archive</button>}
              <button
                title={totalAtt > 0 ? `Has ${totalAtt} attendance record(s) — archive instead` : 'Delete (no attendance)'}
                disabled={busyAction}
                onClick={hardDelete}
                style={{ fontSize: 12.5, padding: '7px 12px', fontWeight: 600, borderRadius: 8, border: '1px solid #E7C9B8', background: '#fff', color: totalAtt > 0 ? 'var(--muted-2)' : '#B5532F', cursor: busyAction ? 'default' : 'pointer' }}
              >
                Delete
              </button>
            </div>
          )}
        </div>

        {/* activity type — the shared vocabulary; attendees inherit this id.
            Changing it while attendance exists prompts keep-vs-propagate. */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#5C5142' }}>Activity type</span>
          <select
            value={activity.activity_type_id || ''}
            disabled={!isCoordinator || busyAction}
            onChange={(e) => onTypeSelect(e.target.value)}
            style={{ fontSize: 13, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 9, background: '#fff', color: 'var(--ink)' }}
          >
            <option value="">— none —</option>
            {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
          </select>
        </div>

        {/* stage stepper */}
        <div style={{ display: 'flex', gap: 8, marginTop: 18, flexWrap: 'wrap' }}>
          {STAGES.map((st) => {
            const on = st === stage
            return (
              <button key={st} onClick={() => onStage(st)} className="btn" style={{ padding: '7px 13px', fontSize: 12.5, borderRadius: 20, background: on ? '#241B14' : '#fff', color: on ? '#F6ECDC' : 'var(--ink-soft)', border: on ? 'none' : '1px solid var(--border)' }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: STAGE_DOT[st], display: 'inline-block', marginRight: 6 }} />
                {st}
              </button>
            )
          })}
        </div>
      </div>

      {err && <ErrorCard>{err}</ErrorCard>}

      <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 16 }} className="dash-grid2">
        {/* attendance */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Attendance</h3>
            <span className="pill" style={pill('#EAF2E5', '#4E7C3F')}>{attCount} present</span>
          </div>

          {isCoordinator && (
            <button className="btn btn-primary" style={{ width: '100%', padding: '11px', fontSize: 14, marginBottom: 12 }} onClick={() => setCapturing(true)}>
              + Capture walk-in
            </button>
          )}
          {unresolvedCount > 0 && (
            <div style={{ fontSize: 12.5, color: '#9C4A14', background: '#FBF1E4', border: '1px solid #E7C9B8', borderRadius: 9, padding: '8px 11px', marginBottom: 12 }}>
              {unresolvedCount} unresolved walk-in{unresolvedCount > 1 ? 's' : ''} — resolve in the <strong>Unresolved</strong> queue.
            </div>
          )}

          <div style={{ position: 'relative', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 12px' }}>
              {Icon.search(15)}
              <input value={q} onChange={(e) => search(e.target.value)} placeholder="Search a person to mark present…" style={{ border: 'none', outline: 'none', fontSize: 13, fontFamily: 'inherit', background: 'transparent', width: '100%' }} />
            </div>
            {results.length > 0 && (
              <div className="card" style={{ position: 'absolute', top: 44, left: 0, right: 0, zIndex: 20, boxShadow: 'var(--shadow-lg)', padding: 6 }}>
                {results.map((p) => (
                  <div key={p.id} className="rowhover" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 8, cursor: 'pointer' }} onClick={() => addAttendee(p)}>
                    <div style={{ width: 28, height: 28, borderRadius: '50%', background: avatarFor(0), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{initials(p.full_name)}</div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{p.full_name}</div>
                    <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--orange)', fontWeight: 600 }}>{busy ? '…' : '+ present'}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {attendees === null ? (
            <Loading label="Loading attendance…" />
          ) : resolved.length === 0 ? (
            <Empty label="No one marked present yet." />
          ) : (
            resolved.map((r, i) => (
              <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #F4EEE2' }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{initials(r.person?.full_name || '?')}</div>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{r.person?.full_name || 'Unknown'}</div>
                <span className="pill" style={{ ...pill('#EAF2E5', '#4E7C3F'), marginLeft: 'auto' }}>Present</span>
              </div>
            ))
          )}
        </div>

        {/* to-dos */}
        <div className="card" style={{ padding: 20 }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>To-dos</h3>
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <input
              value={todoLabel}
              onChange={(e) => setTodoLabel(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && addTodo()}
              placeholder="Add a to-do…"
              style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 9, padding: '8px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none' }}
            />
            <button className="btn btn-primary" onClick={addTodo} style={{ padding: '8px 12px' }}>{Icon.plus(15)}</button>
          </div>
          {todos.length === 0 && <Empty label="No to-dos yet." />}
          {todos.map((t) => (
            <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 0', borderBottom: '1px solid #F4EEE2' }}>
              <div onClick={() => toggleTodo(t)} style={{ width: 22, height: 22, borderRadius: 7, flexShrink: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', cursor: 'pointer', border: '1.5px solid ' + (t.done ? '#4E7C3F' : '#D8CBB6'), background: t.done ? '#4E7C3F' : '#fff' }}>
                {t.done && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5" /></svg>}
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600, color: t.done ? 'var(--muted-2)' : 'var(--ink)', textDecoration: t.done ? 'line-through' : 'none' }}>{t.label}</div>
              {t.when_label && <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted)' }}>{t.when_label}</span>}
            </div>
          ))}
        </div>
      </div>

      {/* Attendance for planned volunteers — marked HERE (show/no-show). The
          staffing/vacate/backfill logic lives on Planning, which reflects these marks. */}
      <PlannedVolunteers activityId={activity.id} isCoordinator={isCoordinator} me={me} onToast={onToast} />

      {capturing && (
        <WalkinCapture
          activity={activity}
          me={me}
          onClose={() => setCapturing(false)}
          onChanged={load}
          onToast={onToast}
        />
      )}

      {/* Type-change keep-vs-propagate prompt (attendance present). */}
      {typeChange && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 130, padding: 20 }} onClick={() => setTypeChange(null)}>
          <div className="card" style={{ width: 440, maxWidth: '100%', padding: 24, boxShadow: 'var(--shadow-lg)' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>Change event type?</h3>
            <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.55, marginBottom: 16 }}>
              This event has <strong>{totalAtt}</strong> attendance record(s) captured under <strong>{typeLabel(activity.activity_type_id)}</strong>. Changing the event to <strong>{typeLabel(typeChange.newId)}</strong> — what should happen to those already-captured records?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-primary" disabled={busyAction} onClick={() => applyTypeChange(typeChange.newId, false)} style={{ padding: '11px', fontSize: 13.5 }}>Keep their captured type (recommended)</button>
              <button className="btn btn-ghost" disabled={busyAction} onClick={() => applyTypeChange(typeChange.newId, true)} style={{ padding: '11px', fontSize: 13.5, color: '#B5532F' }}>Update all {totalAtt} to “{typeLabel(typeChange.newId)}” (overwrites history)</button>
              <button className="btn btn-ghost" disabled={busyAction} onClick={() => setTypeChange(null)} style={{ padding: '8px', fontSize: 12.5, color: 'var(--muted)' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {editing && (
        <EditEventForm
          activity={activity}
          me={me}
          centers={[]}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); onActivityChanged?.() }}
          onToast={onToast}
        />
      )}
    </Pad>
  )
}

// Edit an event's safe fields (name, date, centre, description). Type is edited via
// the header selector (which runs the keep-vs-propagate prompt when attendance exists).
function EditEventForm({ activity, me, onClose, onSaved, onToast }) {
  const [name, setName] = useState(activity.name || '')
  const [date, setDate] = useState(activity.activity_date || '')
  const [centerId, setCenterId] = useState(activity.center_id || '')
  const [description, setDescription] = useState(activity.description || '')
  const [centers, setCenters] = useState([])
  const [busy, setBusy] = useState(false)
  useEffect(() => { supabase.from('centers').select('id, name').order('name').then(({ data }) => setCenters(data || [])) }, [])

  async function save() {
    if (!name.trim()) return onToast('Name cannot be empty.')
    setBusy(true)
    try {
      const { error } = await supabase.from('activities').update({
        name: name.trim(),
        activity_date: date || null,
        center_id: centerId || activity.center_id,
        description: description.trim() || null,
        edited_at: new Date().toISOString(),
        edited_by: me?.id || null,
      }).eq('id', activity.id)
      if (error) throw error
      onToast('Event updated.')
      onSaved?.()
    } catch (e) { onToast('Could not save: ' + (e.message || e)) } finally { setBusy(false) }
  }

  const inputStyle = { width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 12px', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: '#fff', color: 'var(--ink)' }
  const label = { display: 'block', fontSize: 12, fontWeight: 600, color: '#5C5142', marginBottom: 5, marginTop: 12 }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 130, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 460, maxWidth: '100%', padding: 24, boxShadow: 'var(--shadow-lg)', maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 2px' }}>Edit event</h3>
        <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>To change the type, use the Activity type selector on the event (it handles captured attendance).</div>
        <label style={{ ...label, marginTop: 16 }}>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} style={inputStyle} autoFocus />
        <label style={label}>Date</label>
        <input type="date" value={date || ''} onChange={(e) => setDate(e.target.value)} style={inputStyle} />
        <label style={label}>Centre</label>
        <select value={centerId} onChange={(e) => setCenterId(e.target.value)} style={inputStyle}>
          <option value="">— select —</option>
          {centers.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
        </select>
        <label style={label}>Description</label>
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy || !name.trim()} onClick={save}>{busy ? 'Saving…' : 'Save changes'}</button>
        </div>
      </div>
    </div>
  )
}

// Planned-volunteer ATTENDANCE — marked here (show / no-show). The staffing +
// vacate/backfill logic lives on Planning and reflects these marks. Renders
// nothing if the event has no activity blocks.
function PlannedVolunteers({ activityId, isCoordinator, me, onToast }) {
  const [data, setData] = useState(undefined)
  const load = useCallback(async () => {
    const { data: blocks } = await supabase.from('activity_blocks').select('id, heading').eq('activity_id', activityId).order('created_at')
    const ids = (blocks || []).map((b) => b.id)
    let asg = []
    let people = {}
    if (ids.length) {
      const r = await supabase.from('block_assignments').select('id, block_id, person_id, day_date, status').in('block_id', ids)
      asg = r.data || []
      const pids = [...new Set(asg.map((a) => a.person_id))]
      if (pids.length) {
        const pp = await supabase.from('people').select('id, full_name').in('id', pids)
        people = Object.fromEntries((pp.data || []).map((p) => [p.id, p]))
      }
    }
    setData({ blocks: blocks || [], asg, people })
  }, [activityId])
  useEffect(() => { load() }, [load])

  async function mark(a, status) {
    // Toggle off if the same status is tapped again → back to 'assigned' (re-fills the slot).
    const next = a.status === status ? 'assigned' : status
    const { error } = await supabase.from('block_assignments').update({ status: next, marked_by: me?.id || null, marked_at: new Date().toISOString() }).eq('id', a.id)
    if (error) return onToast('Could not mark: ' + error.message)
    onToast(`Marked ${next === 'assigned' ? 'cleared' : next.replace('_', '-')}.`)
    load()
  }

  if (data === undefined || data.blocks.length === 0) return null
  const STATUS = { assigned: { t: '—', c: 'var(--muted-2)' }, show: { t: 'showed', c: '#4E7C3F' }, no_show: { t: 'no-show', c: '#B5532F' }, dropped: { t: 'dropped', c: '#9C4A14' } }

  return (
    <div className="card" style={{ padding: 20, marginTop: 16 }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px' }}>Planned volunteers · attendance</h3>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>Mark who showed. A no-show reopens the slot on Planning for backfill.</div>
      {data.blocks.map((b) => {
        const rows = data.asg.filter((a) => a.block_id === b.id)
        return (
          <div key={b.id} style={{ marginBottom: 14 }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 6 }}>{b.heading}</div>
            {rows.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>No one assigned.</div> : rows.map((a) => {
              const s = STATUS[a.status] || STATUS.assigned
              return (
                <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #F4EEE2' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.people[a.person_id]?.full_name || 'Unknown'}</div>
                  <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{fmtDay(a.day_date)}</span>
                  {isCoordinator ? (
                    <div style={{ display: 'flex', gap: 4 }}>
                      <button onClick={() => mark(a, 'show')} title="Showed" style={{ padding: '4px 9px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid #CDE3C6', background: a.status === 'show' ? '#EAF2E5' : '#fff', color: '#4E7C3F', cursor: 'pointer' }}>Show</button>
                      <button onClick={() => mark(a, 'no_show')} title="No-show (reopens the slot)" style={{ padding: '4px 9px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid #E7C9B8', background: a.status === 'no_show' ? '#FBE6E0' : '#fff', color: '#B5532F', cursor: 'pointer' }}>No-show</button>
                    </div>
                  ) : (
                    <span style={{ fontSize: 11, fontWeight: 600, color: s.c, minWidth: 56, textAlign: 'right' }}>{s.t}</span>
                  )}
                </div>
              )
            })}
          </div>
        )
      })}
    </div>
  )
}
