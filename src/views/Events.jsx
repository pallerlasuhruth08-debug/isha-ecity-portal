import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { pill, initials, avatarFor } from '../lib/ui'
import { Pad, ErrorCard, Loading, Empty } from '../components/View'
import { ensureParticipation } from '../lib/volunteers'
import CommentThread from '../components/CommentThread'
import { fetchActivityTypes } from '../lib/activityTypes'
import { fmtDay, groupPhases } from '../lib/planning'
import { ensureSeriesWindow } from '../lib/series'
import EventList from '../components/EventList'
import KebabMenu from '../components/KebabMenu'
import { useBreakpoint } from '../lib/useBreakpoint'

// ────────────────────────────────────────────────────────────────────────────
// BOUNDARY (do not remove): Event CREATION now lives at the SINGLE site-toolbar
// entry point (CreateEventModal, rendered in App and gated to coordinators; RLS
// act_insert is the real backstop). This Events screen owns attendance + event
// MANAGEMENT (stage, walk-ins, show/no-show) — it must stay fully usable for
// coordinators and must never silently lose the ability to open/manage events.
// Do NOT re-add an in-view create form here: creation is centralised on purpose.
// ────────────────────────────────────────────────────────────────────────────

function fmtDate(d) {
  if (!d) return 'TBD'
  return new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

// Every attendance record shows its type: volunteer or participant (from the type's
// kind) + the specific activity type (e.g. "volunteer · Setup").
function TypeBadge({ typeId, types = [] }) {
  const t = types.find((x) => x.id === typeId)
  const kind = t?.kind || 'volunteer'
  const [bg, fg] = kind === 'meditator' ? ['#E9F0EF', '#2F6E5E'] : ['#F6E8D8', '#C2691F']
  return <span className="pill" style={{ background: bg, color: fg, fontSize: 10 }}>{kind === 'meditator' ? 'participant' : 'volunteer'}{t ? ` · ${t.label}` : ''}</span>
}

export default function Events({ me, isCoordinator = false, onToast, openEventId = null, onEventConsumed, onCreateEvent }) {
  const [acts, setActs] = useState(null)
  const [phasesByEvent, setPhasesByEvent] = useState({}) // activity_id -> phases[]
  const [types, setTypes] = useState([])
  const [centers, setCenters] = useState([])
  const [err, setErr] = useState(null)
  const [openId, setOpenId] = useState(null)

  async function load() {
    try {
      await ensureSeriesWindow().catch(() => {}) // roll the recurring-event window forward
      const [a, p, t, c] = await Promise.all([
        supabase.from('activities').select('id, name, center_id, activity_date, start_date, end_date, activity_type, activity_type_id, is_open, description, archived_at, series_id').is('archived_at', null).order('start_date', { ascending: true }).limit(300),
        supabase.from('event_phases').select('activity_id, kind, sort_order, start_by, finish_by'),
        fetchActivityTypes().catch(() => []),
        supabase.from('centers').select('id, name').order('name'),
      ])
      if (a.error) throw a.error
      setActs(a.data || [])
      setPhasesByEvent(groupPhases(p.data))
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

  const loading = !acts && !err
  const open = openId ? (acts || []).find((a) => a.id === openId) : null

  if (open) return <Detail activity={open} onBack={() => setOpenId(null)} me={me} isCoordinator={isCoordinator} types={types} onActivityChanged={load} onToast={onToast} />

  return (
    <Pad>
      {/* Attendance list. Event creation lives on the Event Hub now, not here. */}
      <p style={{ margin: '0 0 14px', fontSize: 14, color: 'var(--muted)' }}>Mark show / no-show for planned volunteers and capture walk-ins on the day.</p>
      {err && <ErrorCard>Couldn't load events: {err}</ErrorCard>}
      {loading ? <Loading label="Loading events…" /> : (
        <EventList events={acts} phasesByEvent={phasesByEvent} onOpen={setOpenId} />
      )}
    </Pad>
  )
}

export function Detail({ activity, onBack, me, isCoordinator, types = [], onActivityChanged, onToast, embedded = false }) {
  const [attendees, setAttendees] = useState(null)
  const [err, setErr] = useState(null)
  const [typeChange, setTypeChange] = useState(null) // { newId } — keep-vs-propagate prompt
  const [busyAction, setBusyAction] = useState(false)

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('attendance')
        .select('id, person_id').eq('activity_id', activity.id)
      if (error) throw error
      setAttendees(data || [])
    } catch (e) {
      setErr(e.message || String(e))
    }
  }, [activity.id])
  useEffect(() => { load() }, [load])

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

  return (
    <AttWrap embedded={embedded}>
      {!embedded && (
        <div onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: 'var(--orange)', cursor: 'pointer', marginBottom: 16 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
          All events
        </div>
      )}

      {/* Header (name/date/event-type) only on the standalone page — in the Event
          Hub the hub header already shows all this, so it's redundant there. */}
      {!embedded && (
        <div className="card" style={{ padding: 24, marginBottom: 20 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px' }}>{activity.name}{activity.archived_at && <span className="pill" style={{ ...pill('#F1EADD', '#8C7E6B'), marginLeft: 10, verticalAlign: 'middle' }}>archived</span>}</h2>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>{fmtDate(activity.activity_date)} · {activity.center_id}</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)' }}>Activity type</span>
            <select value={activity.activity_type_id || ''} disabled={!isCoordinator || busyAction} onChange={(e) => onTypeSelect(e.target.value)}
              style={{ fontSize: 14, padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 9, background: '#fff', color: 'var(--ink)' }}>
              <option value="">— none —</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
        </div>
      )}

      {err && <ErrorCard>{err}</ErrorCard>}

      <div>
        {/* attendance (show/no-show + walk-ins only — no to-dos here) */}
        <div className="card" style={{ padding: 20 }}>
          {unresolvedCount > 0 && (
            <div style={{ fontSize: 12, color: 'var(--rust)', background: '#FBF1E4', border: '1px solid #E7C9B8', borderRadius: 9, padding: '8px 11px', marginBottom: 12 }}>
              {unresolvedCount} unresolved walk-in{unresolvedCount > 1 ? 's' : ''} — resolve in the <strong>Unresolved</strong> queue.
            </div>
          )}
          <AttendanceSessions activity={activity} types={types} me={me} isCoordinator={isCoordinator} onToast={onToast} onChanged={load} />
        </div>
      </div>

      {/* Planned volunteers are NOT shown here as attended — planned ≠ attended.
          Team members surface as a REFERENCE quick-mark list inside each session's
          capture (matched by activity_type); presence is always explicitly captured. */}

      {/* Type-change keep-vs-propagate prompt (attendance present). */}
      {typeChange && (
        <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 130, padding: 20 }} onClick={() => setTypeChange(null)}>
          <div className="card modal-sheet" style={{ width: 440, maxWidth: '100%', padding: 24, boxShadow: 'var(--shadow-lg)' }} onClick={(e) => e.stopPropagation()}>
            <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 8px' }}>Change event type?</h3>
            <div style={{ fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.55, marginBottom: 16 }}>
              This event has <strong>{totalAtt}</strong> attendance record(s) captured under <strong>{typeLabel(activity.activity_type_id)}</strong>. Changing the event to <strong>{typeLabel(typeChange.newId)}</strong> — what should happen to those already-captured records?
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <button className="btn btn-primary" disabled={busyAction} onClick={() => applyTypeChange(typeChange.newId, false)} style={{ padding: '11px', fontSize: 14 }}>Keep their captured type (recommended)</button>
              <button className="btn btn-ghost" disabled={busyAction} onClick={() => applyTypeChange(typeChange.newId, true)} style={{ padding: '11px', fontSize: 14, color: 'var(--red)' }}>Update all {totalAtt} to “{typeLabel(typeChange.newId)}” (overwrites history)</button>
              <button className="btn btn-ghost" disabled={busyAction} onClick={() => setTypeChange(null)} style={{ padding: '8px', fontSize: 12, color: 'var(--muted)' }}>Cancel</button>
            </div>
          </div>
        </div>
      )}

    </AttWrap>
  )
}

// ATTENDANCE SESSIONS — an event has many. Each session is one (type, date, centre,
// activity_type); it lists on the event's Attendance tab and opens to capture people.
const daysBetween = (a, b) => Math.round((new Date(a) - new Date(b)) / 86400000)
const addDays = (iso, n) => { const d = new Date(iso); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10) }

function AttendanceSessions({ activity, types = [], me, isCoordinator = false, onToast, onChanged }) {
  const [sessions, setSessions] = useState(null)
  const [counts, setCounts] = useState({})
  const [openId, setOpenId] = useState(null)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const load = useCallback(async () => {
    setErr(null)
    const { data, error } = await supabase.from('attendance_sessions')
      .select('id, title, type, session_date, center_id, activity_type_id')
      .eq('activity_id', activity.id).is('archived_at', null).order('session_date').order('created_at')
    if (error) { setErr(error.message); setSessions([]); return }
    setSessions(data || [])
    const { data: att } = await supabase.from('attendance').select('session_id').eq('activity_id', activity.id).not('session_id', 'is', null)
    const c = {}; (att || []).forEach((r) => { c[r.session_id] = (c[r.session_id] || 0) + 1 })
    setCounts(c)
    onChanged?.()
  }, [activity.id, onChanged])
  useEffect(() => { load() }, [load])

  const typeLabel = (id) => types.find((t) => t.id === id)?.label

  // A session with ZERO captured records has nothing to protect → hard delete.
  // A session WITH records is archived (records preserved via attendance.session_id
  // SET NULL is avoided — we keep the row, just hide the session).
  async function removeSession(e, s) {
    e.stopPropagation()
    const n = counts[s.id] || 0
    setBusy(true)
    try {
      if (n > 0) {
        if (!window.confirm(`This session has ${n} attendance record(s). It will be ARCHIVED — hidden here, records preserved. Continue?`)) return
        const { error } = await supabase.from('attendance_sessions').update({ archived_at: new Date().toISOString(), archived_by: me?.id || null }).eq('id', s.id)
        if (error) throw error
        onToast('Session archived (records preserved).')
      } else {
        if (!window.confirm('Delete this session? It has no attendance records.')) return
        const { error } = await supabase.from('attendance_sessions').delete().eq('id', s.id)
        if (error) throw error
        onToast('Session deleted.')
      }
      load()
    } catch (err2) { onToast('Could not remove session: ' + (err2.message || err2)) } finally { setBusy(false) }
  }

  if (openId && sessions) {
    const s = sessions.find((x) => x.id === openId)
    if (s) return <SessionCapture session={s} activity={activity} types={types} me={me} typeLabel={typeLabel} onBack={() => { setOpenId(null); load() }} onToast={onToast} />
  }

  return (
    <div>
      {err && <ErrorCard>{err}</ErrorCard>}
      {!sessions ? <Loading label="Loading sessions…" /> : sessions.length === 0 ? (
        <Empty label="No attendance sessions yet — create one below." />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
          {sessions.map((s) => (
            <div key={s.id} className="rowhover" onClick={() => setOpenId(s.id)}
              style={{ cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 14px', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', background: '#fff' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title || typeLabel(s.activity_type_id) || 'Attendance'}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{fmtDay(s.session_date)} · {s.center_id || '—'}{s.activity_type_id ? ` · ${typeLabel(s.activity_type_id)}` : ''}</div>
              </div>
              <span className="pill" style={{ ...(s.type === 'meditator' ? pill('#E9F0EF', '#2F6E5E') : pill('#F6E8D8', '#C2691F')), flexShrink: 0 }}>{s.type === 'meditator' ? 'participant' : 'volunteer'}</span>
              <span className="pill" style={{ ...pill('#EAF2E5', '#4E7C3F'), flexShrink: 0 }}>{counts[s.id] || 0} present</span>

              {/* Desktop: inline actions when space allows. */}
              <div className="desktop-only" style={{ gap: 8, flexShrink: 0 }}>
                {isCoordinator && (
                  <button className="tap44" disabled={busy} onClick={(e) => { e.stopPropagation(); setEditing(s) }} title="Edit session" style={{ fontSize: 12, padding: '4px 8px', borderRadius: 7, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer' }}>✏️</button>
                )}
                {isCoordinator && (
                  <button className="tap44" disabled={busy} onClick={(e) => removeSession(e, s)} title={(counts[s.id] || 0) > 0 ? 'Archive session (has records)' : 'Delete empty session'}
                    style={{ fontSize: 12, padding: '4px 8px', borderRadius: 7, border: '1px solid #E7C9B8', background: '#fff', color: 'var(--red)', cursor: 'pointer' }}>🗑</button>
                )}
              </div>

              {/* Mobile: collapse behind one 3-dot menu so actions never crowd the title. */}
              {isCoordinator && (
                <div className="mobile-only">
                  <KebabMenu items={[
                    { label: 'Edit session', onClick: () => setEditing(s) },
                    { label: (counts[s.id] || 0) > 0 ? 'Archive session' : 'Delete session', onClick: () => removeSession({ stopPropagation() {} }, s), danger: true, disabled: busy },
                  ]} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <button className="btn btn-primary" style={{ width: '100%', padding: '11px', fontSize: 14 }} onClick={() => setCreating(true)}>＋ Create Attendance</button>
      {creating && (
        <CreateSessionForm activity={activity} types={types} me={me} onClose={() => setCreating(false)}
          onCreated={(id) => { setCreating(false); load(); setOpenId(id) }} onToast={onToast} />
      )}
      {editing && (
        <CreateSessionForm activity={activity} session={editing} attnCount={counts[editing.id] || 0} types={types} me={me}
          onClose={() => setEditing(null)} onCreated={() => { setEditing(null); load() }} onToast={onToast} />
      )}
    </div>
  )
}

const _lbl = { fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', display: 'block', marginBottom: 5 }
const _fld = { fontSize: 14, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 9, background: '#fff', color: 'var(--ink)', width: '100%' }

export function CreateSessionForm({ activity, session = null, attnCount = 0, types = [], me, onClose, onCreated, onToast }) {
  const editing = !!session
  // After attendance is captured, activity_type + date are LOCKED (changing either
  // corrupts existing history); title + centre stay editable.
  const locked = editing && attnCount > 0
  const spanStart = activity.start_date || activity.activity_date
  const spanEnd = activity.end_date || activity.start_date || activity.activity_date
  const today = new Date().toISOString().slice(0, 10)
  const [kind, setKind] = useState(session?.type || 'volunteer')
  const [date, setDate] = useState(session?.session_date || (today >= spanStart && today <= spanEnd ? today : spanStart))
  const [centre, setCentre] = useState(session?.center_id || activity.center_id || '')
  const [centres, setCentres] = useState([])
  const [localTypes, setLocalTypes] = useState([])
  const [typeId, setTypeId] = useState(session?.activity_type_id || '')
  const [newType, setNewType] = useState('')
  const [addingType, setAddingType] = useState(false)
  const [title, setTitle] = useState(session?.title || '')
  const [titleEdited, setTitleEdited] = useState(!!session?.title)
  const [earliestPhase, setEarliestPhase] = useState(null)
  const [confirmedFar, setConfirmedFar] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('centers').select('id, name, active').order('name')
      .then(({ data }) => setCentres((data || []).filter((c) => c.active && !['all', 'unassigned'].includes(c.id))))
    supabase.from('event_phases').select('start_by').eq('activity_id', activity.id).not('start_by', 'is', null).order('start_by').limit(1)
      .then(({ data }) => setEarliestPhase(data?.[0]?.start_by || null))
  }, [activity.id])

  const allTypes = [...types, ...localTypes]
  const typeOpts = allTypes.filter((t) => (t.kind || 'volunteer') === kind && t.active !== false)
  useEffect(() => { if (typeId && !typeOpts.some((t) => t.id === typeId)) setTypeId('') }, [kind]) // eslint-disable-line

  const autoTitle = `${allTypes.find((t) => t.id === typeId)?.label || 'Attendance'} — ${fmtDay(date)}`
  const effTitle = titleEdited && title.trim() ? title.trim() : autoTitle

  // Soft window: from 1 day before the event start (or the earliest planned phase,
  // whichever is earlier) through the event end. Outside is allowed but warns.
  const startMinus1 = addDays(spanStart, -1)
  const windowStart = earliestPhase && earliestPhase < startMinus1 ? earliestPhase : startMinus1
  const outside = date < windowStart || date > spanEnd
  const nBefore = date < spanStart ? daysBetween(spanStart, date) : 0
  const nAfter = date > spanEnd ? daysBetween(date, spanEnd) : 0
  // Creating a session for any in-range date is always allowed (setup in advance is valid).
  // The future-date gate lives on CAPTURE, not creation.

  async function createType() {
    const label = newType.trim()
    if (!label) return
    setBusy(true)
    try {
      const { data, error } = await supabase.from('activity_types').insert({ label, kind }).select('id, label, kind, active').single()
      if (error) throw error
      setLocalTypes((l) => [...l, data]); setTypeId(data.id); setNewType(''); setAddingType(false)
      onToast(`Activity type "${label}" added — reusable everywhere.`)
    } catch (e) { onToast('Could not add type: ' + (e.message || e)) } finally { setBusy(false) }
  }

  async function create() {
    if (!typeId) return onToast('Pick an activity type.')
    if (outside && !confirmedFar) return
    setBusy(true)
    try {
      if (editing) {
        // locked fields (activity_type, date) are never written once attendance exists.
        const patch = { title: effTitle, type: kind, center_id: centre || activity.center_id || null }
        if (!locked) { patch.session_date = date; patch.activity_type_id = typeId }
        const { error } = await supabase.from('attendance_sessions').update(patch).eq('id', session.id)
        if (error) throw error
        onToast('Session updated.')
        onCreated(session.id)
        return
      }
      const { data, error } = await supabase.from('attendance_sessions').insert({
        activity_id: activity.id, title: effTitle, type: kind, session_date: date,
        center_id: centre || activity.center_id || null, activity_type_id: typeId, created_by: me?.id || null,
      }).select('id').single()
      if (error) throw error
      onToast('Session created — capture attendance.')
      onCreated(data.id)
    } catch (e) { onToast(`Could not ${editing ? 'update' : 'create'} session: ` + (e.message || e)) } finally { setBusy(false) }
  }

  return (
    <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 130, padding: 20 }} onClick={onClose}>
      <div className="card modal-sheet" style={{ width: 520, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 22, boxShadow: 'var(--shadow-lg)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{editing ? 'Edit attendance session' : 'Create attendance session'}</h3>
          <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={onClose}>✕ Close</button>
        </div>
        {locked && (
          <div style={{ fontSize: 12, color: 'var(--rust)', background: '#FBF1E4', border: '1px solid #E7C9B8', borderRadius: 8, padding: '7px 10px', marginBottom: 12 }}>
            🔒 This session has {attnCount} captured record(s). Activity type and date are locked (changing them would corrupt that history); title and centre stay editable.
          </div>
        )}
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>{activity.name} · {fmtDay(spanStart)}{spanEnd !== spanStart ? `–${fmtDay(spanEnd)}` : ''}</div>

        <div style={{ marginBottom: 14 }}>
          <span style={_lbl}>They attended as</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['volunteer', 'Volunteer'], ['meditator', 'Participant']].map(([k, label]) => (
              <button key={k} onClick={() => setKind(k)} style={{ flex: 1, padding: '9px', fontSize: 14, fontWeight: 600, borderRadius: 9, cursor: 'pointer',
                border: kind === k ? '1px solid var(--orange)' : '1px solid var(--border)', background: kind === k ? '#F6E8D8' : '#fff', color: kind === k ? 'var(--orange)' : 'var(--muted)' }}>{label}</button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 150 }}>
            <span style={_lbl}>Date</span>
            <input type="date" value={date} disabled={locked} onChange={(e) => { setDate(e.target.value); setConfirmedFar(false) }} style={{ ..._fld, borderColor: outside ? '#E7A08A' : 'var(--border)', opacity: locked ? 0.6 : 1, cursor: locked ? 'not-allowed' : 'pointer' }} />
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <span style={_lbl}>Centre <span style={{ fontWeight: 400, color: 'var(--muted-2)' }}>· where it happened</span></span>
            <select value={centre} onChange={(e) => setCentre(e.target.value)} style={_fld}>
              {!centres.some((c) => c.id === centre) && centre && <option value={centre}>{centre}</option>}
              {centres.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
            </select>
          </div>
        </div>

        {outside && (
          <div style={{ fontSize: 12, color: 'var(--rust)', background: '#FBF1E4', border: '1px solid #E7C9B8', borderRadius: 9, padding: '9px 11px', marginBottom: 14 }}>
            This date is {nBefore ? `${nBefore} day${nBefore > 1 ? 's' : ''} before the event start` : `${nAfter} day${nAfter > 1 ? 's' : ''} after the event end`} — confirm this is correct.
            <label style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 7, cursor: 'pointer', fontWeight: 600 }}>
              <input type="checkbox" checked={confirmedFar} onChange={(e) => setConfirmedFar(e.target.checked)} /> Yes, this date is intentional
            </label>
          </div>
        )}

        <div style={{ marginBottom: 14 }}>
          <span style={_lbl}>Activity type <span style={{ fontWeight: 400, color: 'var(--muted-2)' }}>· shared list</span></span>
          {addingType ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <input autoFocus value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="New activity type (e.g. Kitchen)" onKeyDown={(e) => e.key === 'Enter' && createType()} style={_fld} />
              <button className="btn btn-primary" disabled={busy || !newType.trim()} onClick={createType} style={{ fontSize: 12, padding: '8px 12px' }}>Add</button>
              <button className="btn btn-ghost" onClick={() => { setAddingType(false); setNewType('') }} style={{ fontSize: 12, padding: '8px 10px' }}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={typeId} disabled={locked} onChange={(e) => setTypeId(e.target.value)} style={{ ..._fld, opacity: locked ? 0.6 : 1, cursor: locked ? 'not-allowed' : 'pointer' }}>
                <option value="">— pick {kind === 'meditator' ? 'participant' : 'volunteer'} activity —</option>
                {typeOpts.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              {!locked && <button className="btn btn-ghost" onClick={() => setAddingType(true)} style={{ fontSize: 12, padding: '8px 12px', whiteSpace: 'nowrap' }}>＋ New type</button>}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 18 }}>
          <span style={_lbl}>Title <span style={{ fontWeight: 400, color: 'var(--muted-2)' }}>· optional</span></span>
          <input value={titleEdited ? title : autoTitle} onChange={(e) => { setTitle(e.target.value); setTitleEdited(true) }} placeholder={autoTitle} style={_fld} />
        </div>

        <button className="btn btn-primary" disabled={busy || !typeId || (outside && !confirmedFar)} onClick={create}
          style={{ width: '100%', padding: '12px', fontSize: 14, opacity: busy || !typeId || (outside && !confirmedFar) ? 0.55 : 1 }}>
          {busy ? (editing ? 'Saving…' : 'Creating…') : (editing ? 'Save changes' : 'Create & capture →')}
        </button>
      </div>
    </div>
  )
}

// Capture people into a session — resolve by name/phone, mark present. Each row
// saves to the person's history with the session's type + activity_type.
function SessionCapture({ session, activity, types = [], me, typeLabel, onBack, onToast }) {
  const [present, setPresent] = useState(null)
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [newP, setNewP] = useState(null) // { name, phone } — create-new mini form
  const [centres, setCentres] = useState([])
  const [localTypes, setLocalTypes] = useState([])
  const [ovrType, setOvrType] = useState(session.activity_type_id || '')
  const [ovrCentre, setOvrCentre] = useState(session.center_id || '')
  const [addingType, setAddingType] = useState(false)
  const [newType, setNewType] = useState('')
  const [openComment, setOpenComment] = useState(null) // person_id whose comments are open
  const [refMembers, setRefMembers] = useState([]) // team members whose team activity = this session's activity
  const seq = useRef(0)
  // Capture is HARD-gated until the session's own date: creating a session in advance is
  // fine, but people can only be marked present on or after the day.
  const captureOpen = session.session_date <= new Date().toISOString().slice(0, 10)

  useEffect(() => {
    supabase.from('centers').select('id, name, active').order('name')
      .then(({ data }) => setCentres((data || []).filter((c) => c.active && !['all', 'unassigned'].includes(c.id))))
  }, [])

  const allTypes = [...types, ...localTypes]
  const typeOpts = allTypes.filter((t) => (t.kind || 'volunteer') === session.type && t.active !== false)
  const nameOf = (id) => allTypes.find((t) => t.id === id)?.label

  const load = useCallback(async () => {
    const { data } = await supabase.from('attendance')
      .select('id, person_id, activity_type_id, center_id, person:people!attendance_person_id_fkey(full_name, phone)')
      .eq('session_id', session.id).order('time_in', { ascending: false })
    setPresent(data || [])
  }, [session.id])
  useEffect(() => { load() }, [load])

  // REFERENCE list (quick-mark assist, NEVER auto-marked): team members whose team's
  // activity_type matches this session's. Presence is still explicitly captured; tapping
  // a member marks them present and inherits the activity_type FROM their team (#7).
  useEffect(() => {
    if (!session.activity_type_id) { setRefMembers([]); return }
    let alive = true
    ;(async () => {
      const { data: blocks } = await supabase.from('activity_blocks')
        .select('id').eq('activity_id', activity.id).eq('activity_type_id', session.activity_type_id).is('archived_at', null)
      const ids = (blocks || []).map((b) => b.id)
      if (!ids.length) { if (alive) setRefMembers([]); return }
      const { data: asg } = await supabase.from('block_assignments')
        .select('person_id, block_id, person:people!block_assignments_person_id_fkey(id, full_name, phone)')
        .in('block_id', ids)
      const seen = new Set(); const out = []
      for (const a of asg || []) { if (a.person_id && !seen.has(a.person_id) && a.person) { seen.add(a.person_id); out.push({ id: a.person_id, full_name: a.person.full_name, phone: a.person.phone }) } }
      if (alive) setRefMembers(out)
    })()
    return () => { alive = false }
  }, [activity.id, session.activity_type_id])

  useEffect(() => {
    const h = setTimeout(async () => {
      const term = q.trim()
      if (term.length < 2) { setResults([]); return }
      const s = ++seq.current
      const digits = term.replace(/\D/g, '')
      const query = digits.length >= 4
        ? supabase.from('people').select('id, full_name, phone').ilike('phone', `%${digits}%`).limit(8)
        : supabase.from('people').select('id, full_name, phone').ilike('full_name', `%${term}%`).limit(8)
      const { data } = await query
      if (s === seq.current) setResults(data || [])
    }, 300)
    return () => clearTimeout(h)
  }, [q])

  const presentIds = new Set((present || []).map((p) => p.person_id))

  async function createType() {
    const label = newType.trim()
    if (!label) return
    setBusy(true)
    try {
      const { data, error } = await supabase.from('activity_types').insert({ label, kind: session.type }).select('id, label, kind, active').single()
      if (error) throw error
      setLocalTypes((l) => [...l, data]); setOvrType(data.id); setNewType(''); setAddingType(false)
      onToast(`Activity type "${label}" added — reusable everywhere.`)
    } catch (e) { onToast('Could not add type: ' + (e.message || e)) } finally { setBusy(false) }
  }

  // opts.activityTypeId — a matched team member inherits their team's activity_type (#7).
  // Walk-ins (from search) fall back to the per-next-person override, then the session default.
  async function mark(person, opts = {}) {
    if (!captureOpen) { onToast(`Attendance capture opens on ${fmtDay(session.session_date)}.`); return }
    if (presentIds.has(person.id)) { onToast(`${person.full_name} already present.`); setQ(''); setResults([]); return }
    const typeForRow = opts.activityTypeId || ovrType || session.activity_type_id
    setBusy(true)
    try {
      const { error } = await supabase.from('attendance').insert({
        session_id: session.id, activity_id: activity.id, person_id: person.id,
        activity_type_id: typeForRow, attended_on: session.session_date,
        center_id: opts.centerId || ovrCentre || session.center_id,
      })
      if (error) throw error
      await ensureParticipation(person.id, session.type, { source: 'event_attendance' })
      setQ(''); setResults([]); setNewP(null); load()
      onToast(`${person.full_name} — present${typeForRow && typeForRow !== session.activity_type_id ? ` · ${nameOf(typeForRow)}` : ''}.`)
    } catch (e) { onToast('Could not mark present: ' + (e.message || e)) } finally { setBusy(false) }
  }

  async function createAndMark() {
    const name = (newP?.name || '').trim()
    const phone = (newP?.phone || '').replace(/\D/g, '')
    if (!name) return onToast('Enter a name.')
    setBusy(true)
    try {
      let person = null
      if (phone) { const { data } = await supabase.from('people').select('id, full_name, phone').eq('phone', phone).maybeSingle(); person = data || null }
      if (!person) {
        const { data, error } = await supabase.from('people').insert({ full_name: name, phone: phone || null }).select('id, full_name, phone').single()
        if (error) throw error
        person = data
      }
      await mark(person)
    } catch (e) { onToast('Could not add person: ' + (e.message || e)); setBusy(false) }
  }

  // Remove a mis-marked row. Credit is derived from attendance rows, so deleting the
  // row reverses that person's activity credit — no orphaned counter.
  async function removeRow(r) {
    if (!window.confirm(`Remove ${r.person?.full_name || 'this person'} from this session? Their activity credit for this reverses. This cannot be undone.`)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('attendance').delete().eq('id', r.id)
      if (error) throw error
      onToast(`${r.person?.full_name || 'Attendance'} removed.`); load()
    } catch (e) { onToast('Could not remove: ' + (e.message || e)) } finally { setBusy(false) }
  }

  const ovrDiffers = (r) => r.activity_type_id && r.activity_type_id !== session.activity_type_id

  return (
    <div>
      <button className="btn btn-ghost" style={{ fontSize: 13, marginBottom: 12 }} onClick={onBack}>← All sessions</button>
      <div className="card" style={{ padding: 14, marginBottom: 12, background: 'var(--panel)' }}>
        <div style={{ fontSize: 16, fontWeight: 600 }}>{session.title || typeLabel?.(session.activity_type_id) || 'Attendance'}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtDay(session.session_date)} · {session.center_id || '—'} · {session.type === 'meditator' ? 'participant' : 'volunteer'}{session.activity_type_id ? ` · ${typeLabel?.(session.activity_type_id)}` : ''}</div>
        {!captureOpen && (
          <div style={{ fontSize: 12, color: 'var(--rust)', background: '#FBF1E4', border: '1px solid #E7C9B8', borderRadius: 8, padding: '7px 10px', marginTop: 8 }}>
            🔒 Attendance capture opens on {fmtDay(session.session_date)}. The session is set up; marking people present unlocks on the day.
          </div>
        )}
      </div>

      {captureOpen && (<>
      {/* REFERENCE list (assist only — never auto-marked): team members whose team's
          activity matches this session. Tapping marks present + inherits their team's type. */}
      {refMembers.filter((m) => !presentIds.has(m.id)).length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--muted)', marginBottom: 5 }}>Team members for this activity · tap to mark present (not auto-marked)</div>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {refMembers.filter((m) => !presentIds.has(m.id)).map((m) => (
              <button key={m.id} disabled={busy} onClick={() => mark(m, { activityTypeId: session.activity_type_id })}
                style={{ fontSize: 12, padding: '5px 10px', borderRadius: 16, border: '1px solid #CDE3C6', background: '#fff', color: '#4E7C3F', cursor: busy ? 'default' : 'pointer' }}>＋ {m.full_name}</button>
            ))}
          </div>
        </div>
      )}
      {/* Per-person override: activity + centre applied to whoever you mark next
          (defaults to the session's — change it only when someone did something else). */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: 1, minWidth: 150 }}>
          <span style={{ ..._lbl, marginBottom: 3, fontSize: 12 }}>Activity for next person</span>
          {addingType ? (
            <div style={{ display: 'flex', gap: 6 }}>
              <input autoFocus value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="New activity type" onKeyDown={(e) => e.key === 'Enter' && createType()} style={_fld} />
              <button className="btn btn-primary" disabled={busy || !newType.trim()} onClick={createType} style={{ fontSize: 12, padding: '7px 10px' }}>Add</button>
              <button className="btn btn-ghost" onClick={() => { setAddingType(false); setNewType('') }} style={{ fontSize: 12, padding: '7px 9px' }}>✕</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 6 }}>
              <select value={ovrType} onChange={(e) => setOvrType(e.target.value)} style={_fld}>
                <option value="">— session default —</option>
                {typeOpts.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <button className="btn btn-ghost" onClick={() => setAddingType(true)} style={{ fontSize: 12, padding: '7px 10px', whiteSpace: 'nowrap' }}>＋ New</button>
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 130 }}>
          <span style={{ ..._lbl, marginBottom: 3, fontSize: 12 }}>Centre</span>
          <select value={ovrCentre} onChange={(e) => setOvrCentre(e.target.value)} style={_fld}>
            {!centres.some((c) => c.id === ovrCentre) && ovrCentre && <option value={ovrCentre}>{ovrCentre}</option>}
            {centres.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
          </select>
        </div>
      </div>

      <div style={{ position: 'relative', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 12px' }}>
          {Icon.search(15)}
          <input value={q} onChange={(e) => { setQ(e.target.value); setNewP(null) }} placeholder="Name or phone…" style={{ border: 'none', outline: 'none', fontSize: 13, background: 'transparent', width: '100%' }} />
        </div>
        {q.trim().length >= 2 && (
          <div className="card" style={{ position: 'absolute', top: 46, left: 0, right: 0, zIndex: 20, boxShadow: 'var(--shadow-lg)', padding: 6 }}>
            {results.map((p) => (
              <div key={p.id} className="rowhover" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 8, cursor: busy ? 'default' : 'pointer' }} onClick={() => !busy && mark(p)}>
                <div style={{ width: 26, height: 26, borderRadius: '50%', background: avatarFor(0), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>{initials(p.full_name)}</div>
                <div><div style={{ fontSize: 14, fontWeight: 500 }}>{p.full_name}</div><div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.phone || 'no phone'}</div></div>
                <span style={{ marginLeft: 'auto', fontSize: 12, color: presentIds.has(p.id) ? 'var(--muted)' : 'var(--orange)', fontWeight: 600 }}>{presentIds.has(p.id) ? 'present' : busy ? '…' : '+ present'}</span>
              </div>
            ))}
            {newP ? (
              <div style={{ padding: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <input autoFocus value={newP.name} onChange={(e) => setNewP({ ...newP, name: e.target.value })} placeholder="Full name" style={_fld} />
                <input value={newP.phone} onChange={(e) => setNewP({ ...newP, phone: e.target.value })} placeholder="Phone (optional)" style={_fld} />
                <button className="btn btn-primary" disabled={busy || !newP.name.trim()} onClick={createAndMark} style={{ fontSize: 12, padding: '8px' }}>Add & mark present</button>
              </div>
            ) : (
              <div className="rowhover" style={{ padding: '8px 10px', borderRadius: 8, cursor: 'pointer', color: 'var(--orange)', fontWeight: 600, fontSize: 12 }}
                onClick={() => setNewP({ name: /\d/.test(q) ? '' : q, phone: /\d/.test(q) ? q.replace(/\D/g, '') : '' })}>＋ Not listed — add new person</div>
            )}
          </div>
        )}
      </div>
      </>)}

      {present === null ? <Loading label="Loading…" /> : present.length === 0 ? <Empty label="No one marked present yet." /> : (
        <div>
          <div style={{ fontSize: 12, color: 'var(--muted-2)', marginBottom: 6 }}>{present.length} present</div>
          {present.map((r, i) => (
            <div key={r.id} style={{ padding: '9px 0', borderBottom: '1px solid #F4EEE2' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <div style={{ width: 30, height: 30, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>{initials(r.person?.full_name || '?')}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>{r.person?.full_name || 'Unknown'}</div>
                  {ovrDiffers(r) && <div style={{ fontSize: 12, color: 'var(--orange)' }}>{nameOf(r.activity_type_id)}{r.center_id && r.center_id !== session.center_id ? ` · ${r.center_id}` : ''}</div>}
                </div>
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button onClick={() => setOpenComment(openComment === r.person_id ? null : r.person_id)} title="Comments" style={{ fontSize: 12, padding: '4px 8px', borderRadius: 7, border: '1px solid var(--border)', background: '#fff', cursor: 'pointer' }}>💬</button>
                  <button disabled={busy} onClick={() => removeRow(r)} title="Remove this attendance" style={{ fontSize: 12, padding: '4px 8px', borderRadius: 7, border: '1px solid #E7C9B8', background: '#fff', color: 'var(--red)', cursor: 'pointer' }}>Remove</button>
                </div>
              </div>
              {openComment === r.person_id && (
                <div style={{ marginLeft: 40, marginTop: 4 }}>
                  <CommentThread scope={{ activity_id: activity.id, subject_person_id: r.person_id }} me={me} onToast={onToast} compact />
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <button className="btn btn-primary" style={{ width: '100%', padding: '11px', fontSize: 14, marginTop: 14 }} onClick={onBack}>OK — done</button>
    </div>
  )
}

// Event-level Edit / Archive / Delete — belongs to the EVENT, not the attendance
// sheet. Rendered in the Event Hub header. Self-contained: it fetches counts across
// every table that cascade-deletes with the event (attendance, to-dos, volunteer
// interest submissions, comments, phases, teams) for the delete gate — any of them
// existing routes to Archive instead. Only a genuinely untouched event hard-deletes.
// (A prior version only checked attendance; an event with 222 interest submissions
// and 4 to-dos but zero attendance was hard-deleted with no warning about either.)
export function EventActions({ activity, me, isCoordinator, onToast, onChanged, onDeleted }) {
  const { isPhone } = useBreakpoint()
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [counts, setCounts] = useState(null) // null while loading
  const nowISO = () => new Date().toISOString()

  useEffect(() => {
    let alive = true
    Promise.all([
      supabase.from('attendance').select('id', { count: 'exact', head: true }).eq('activity_id', activity.id),
      supabase.from('event_todos').select('id', { count: 'exact', head: true }).eq('activity_id', activity.id),
      supabase.from('event_interest').select('id', { count: 'exact', head: true }).eq('activity_id', activity.id),
      supabase.from('comments').select('id', { count: 'exact', head: true }).eq('activity_id', activity.id),
      // Every event auto-gets 4 phase rows (pre_far/pre_near/day_of/post) on creation --
      // scaffolding, not data. Only count ones that actually have progress recorded.
      supabase.from('event_phases').select('id', { count: 'exact', head: true }).eq('activity_id', activity.id).or('started_at.not.is.null,completed_at.not.is.null'),
      supabase.from('activity_blocks').select('id', { count: 'exact', head: true }).eq('activity_id', activity.id),
    ]).then(([att, todos, interest, comm, phases, blocks]) => {
      if (!alive) return
      setCounts({
        attendance: att.count || 0,
        interest: interest.count || 0,
        todos: todos.count || 0,
        blocks: blocks.count || 0,
        comments: comm.count || 0,
        phases: phases.count || 0,
      })
    })
    return () => { alive = false }
  }, [activity.id])

  if (!isCoordinator) return null

  const hasData = counts && Object.values(counts).some((n) => n > 0)

  async function setArchived(on) {
    setBusy(true)
    try {
      const { error } = await supabase.from('activities').update({ archived_at: on ? nowISO() : null, archived_by: on ? me?.id || null : null }).eq('id', activity.id)
      if (error) throw error
      onToast(on ? 'Event archived (attendance preserved).' : 'Event unarchived.')
      if (on) onDeleted?.(); else onChanged?.()
    } catch (e) { onToast('Could not archive: ' + (e.message || e)) } finally { setBusy(false) }
  }

  async function hardDelete() {
    if (!counts || hasData) return
    if (!window.confirm(`Permanently delete “${activity.name}”? It has no attendance, interest submissions, to-dos, teams, comments, or phases. This cannot be undone.`)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('activities').delete().eq('id', activity.id)
      if (error) throw error // RESTRICT FK also blocks if attendance somehow exists
      onToast('Event deleted.')
      onDeleted?.()
    } catch (e) { onToast('Could not delete: ' + (e.message || e)) } finally { setBusy(false) }
  }

  const blockedLabel = () => {
    if (!counts) return ''
    const parts = []
    if (counts.attendance) parts.push(`${counts.attendance} attendance record${counts.attendance === 1 ? '' : 's'}`)
    if (counts.interest) parts.push(`${counts.interest} interest submission${counts.interest === 1 ? '' : 's'}`)
    if (counts.todos) parts.push(`${counts.todos} to-do${counts.todos === 1 ? '' : 's'}`)
    if (counts.blocks) parts.push(`${counts.blocks} team${counts.blocks === 1 ? '' : 's'}`)
    if (counts.comments) parts.push(`${counts.comments} comment${counts.comments === 1 ? '' : 's'}`)
    if (counts.phases) parts.push(`${counts.phases} planning phase${counts.phases === 1 ? '' : 's'}`)
    return `Has ${parts.join(', ')} — archive instead`
  }

  return (
    <>
      {isPhone ? (
        <KebabMenu items={[
          { label: 'Edit', onClick: () => setEditing(true), disabled: busy },
          activity.archived_at
            ? { label: 'Unarchive', onClick: () => setArchived(false), disabled: busy }
            : { label: 'Archive', onClick: () => setArchived(true), disabled: busy },
          {
            label: 'Delete',
            onClick: hardDelete,
            disabled: busy || !counts || hasData,
            danger: !!counts && !hasData,
          },
        ]} />
      ) : (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-ghost" disabled={busy} style={{ fontSize: 12, padding: '7px 12px' }} onClick={() => setEditing(true)}>Edit</button>
          {activity.archived_at
            ? <button className="btn btn-ghost" disabled={busy} style={{ fontSize: 12, padding: '7px 12px' }} onClick={() => setArchived(false)}>Unarchive</button>
            : <button className="btn btn-ghost" disabled={busy} style={{ fontSize: 12, padding: '7px 12px' }} onClick={() => setArchived(true)}>Archive</button>}
          <button
            title={hasData ? blockedLabel() : 'Delete (no related records)'}
            disabled={busy || !counts || hasData}
            onClick={hardDelete}
            style={{ fontSize: 12, padding: '7px 12px', fontWeight: 600, borderRadius: 8, border: '1px solid #E7C9B8', background: '#fff', color: hasData || !counts ? 'var(--muted-2)' : 'var(--red)', cursor: (busy || !counts || hasData) ? 'default' : 'pointer' }}
          >Delete</button>
        </div>
      )}
      {editing && (
        <EditEventForm
          activity={activity}
          me={me}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); onChanged?.() }}
          onToast={onToast}
        />
      )}
    </>
  )
}

// Wrap the Attendance detail in the page Pad normally, or a plain div when embedded
// in the Event Hub tab (which supplies its own padding).
function AttWrap({ embedded, children }) {
  return embedded ? <div>{children}</div> : <Pad>{children}</Pad>
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
  const label = { display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 5, marginTop: 12 }
  return (
    <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 130, padding: 20 }} onClick={onClose}>
      <div className="card modal-sheet" style={{ width: 460, maxWidth: '100%', padding: 24, boxShadow: 'var(--shadow-lg)', maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 2px' }}>Edit event</h3>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>To change the type, use the Activity type selector on the event (it handles captured attendance).</div>
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
function PlannedVolunteers({ activityId, eventDate, isCoordinator, me, onToast }) {
  const [data, setData] = useState(undefined)
  const [futureAck, setFutureAck] = useState(false)
  const load = useCallback(async () => {
    const { data: blocks } = await supabase.from('activity_blocks').select('id, heading, attendance_mode').eq('activity_id', activityId).order('created_at')
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

  // Mark a GROUP of assignment rows in one shot. For per_day the group is a single
  // (person, day) row; for span / involved_only the group is ALL of a person's rows
  // for the block — so span records ONE mark for the whole block, not one per day.
  async function markGroup(group, status) {
    const next = group.status === status ? 'assigned' : status
    // Soft-warn when marking presence for a day that hasn't arrived yet. per_day uses the
    // day being marked; span / involved_only credit the whole block, so use the event day.
    // Clearing a mark (next === 'assigned') is always allowed without a warning.
    const refDate = group.day || eventDate
    if (next !== 'assigned' && refDate && refDate > new Date().toISOString().slice(0, 10) && !futureAck) {
      if (!window.confirm(`${fmtDay(refDate)} hasn’t arrived yet. You’re marking attendance before the activity day — continue?`)) return
      setFutureAck(true)
    }
    const { error } = await supabase.from('block_assignments').update({ status: next, marked_by: me?.id || null, marked_at: new Date().toISOString() }).in('id', group.rows.map((r) => r.id))
    if (error) return onToast('Could not mark: ' + error.message)
    onToast(`Marked ${next === 'assigned' ? 'cleared' : next.replace('_', '-')}.`)
    load()
  }

  if (data === undefined || data.blocks.length === 0) return null
  const STATUS = { assigned: { t: '—', c: 'var(--muted-2)' }, show: { t: 'showed', c: '#4E7C3F' }, no_show: { t: 'no-show', c: 'var(--red)' }, dropped: { t: 'dropped', c: 'var(--rust)' }, involved: { t: 'involved', c: 'var(--orange)' } }
  const MODE_TAG = { per_day: 'per-day', span: 'span', involved_only: 'involved only' }

  return (
    <div className="card" style={{ padding: 20, marginTop: 16 }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px' }}>Planned volunteers · attendance</h3>
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>How presence is marked follows each block’s attendance mode. Involved-only credits participation without a reliability data point.</div>
      {data.blocks.map((b) => {
        const rows = data.asg.filter((a) => a.block_id === b.id)
        const mode = b.attendance_mode || 'per_day'
        // per_day → one control per (person, day); span / involved_only → ONE control
        // per person (all their rows for the block marked together).
        const groups = mode === 'per_day'
          ? rows.map((a) => ({ key: a.id, personId: a.person_id, day: a.day_date, rows: [a], status: a.status }))
          : Object.values(rows.reduce((acc, a) => {
              const g = (acc[a.person_id] ||= { key: a.person_id, personId: a.person_id, day: null, rows: [], status: 'assigned' })
              g.rows.push(a)
              // representative status: any positive wins, else no_show, else assigned
              if (a.status === 'show' || a.status === 'involved') g.status = a.status
              else if (a.status === 'no_show' && g.status === 'assigned') g.status = 'no_show'
              return acc
            }, {}))
        return (
          <div key={b.id} style={{ marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{b.heading}</div>
              <span className="pill" style={{ background: '#F1EADD', color: '#8C7E6B', fontSize: 10 }}>{MODE_TAG[mode]}</span>
            </div>
            {groups.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>No one assigned.</div> : groups.map((g) => {
              const s = STATUS[g.status] || STATUS.assigned
              return (
                <div key={g.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #F4EEE2' }}>
                  <div style={{ fontSize: 14, fontWeight: 500, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.people[g.personId]?.full_name || 'Unknown'}</div>
                  {mode === 'per_day' && <span style={{ fontSize: 12, color: 'var(--muted)' }}>{fmtDay(g.day)}</span>}
                  {isCoordinator ? (
                    mode === 'involved_only' ? (
                      <button onClick={() => markGroup(g, 'involved')} title="Credit participation (no presence check, no reliability)" style={{ padding: '4px 9px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid #E7C9B8', background: g.status === 'involved' ? '#F6E8D8' : '#fff', color: 'var(--orange)', cursor: 'pointer' }}>Involved</button>
                    ) : (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => markGroup(g, 'show')} title={mode === 'span' ? 'Present for the whole block' : 'Showed'} style={{ padding: '4px 9px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid #CDE3C6', background: g.status === 'show' ? '#EAF2E5' : '#fff', color: '#4E7C3F', cursor: 'pointer' }}>{mode === 'span' ? 'Present' : 'Show'}</button>
                        <button onClick={() => markGroup(g, 'no_show')} title="No-show (reopens the slot)" style={{ padding: '4px 9px', fontSize: 12, fontWeight: 600, borderRadius: 6, border: '1px solid #E7C9B8', background: g.status === 'no_show' ? '#FBE6E0' : '#fff', color: 'var(--red)', cursor: 'pointer' }}>{mode === 'span' ? 'Absent' : 'No-show'}</button>
                      </div>
                    )
                  ) : (
                    <span style={{ fontSize: 12, fontWeight: 600, color: s.c, minWidth: 56, textAlign: 'right' }}>{s.t}</span>
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
