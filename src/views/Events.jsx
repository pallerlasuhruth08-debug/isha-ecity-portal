import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { pill, initials, avatarFor } from '../lib/ui'
import { Pad, ErrorCard, Loading, Empty } from '../components/View'
import WalkinCapture from '../components/WalkinCapture'
import { ensureParticipation } from '../lib/volunteers'
import { fetchActivityTypes } from '../lib/activityTypes'
import { fmtDay, groupPhases } from '../lib/planning'
import { ensureSeriesWindow } from '../lib/series'
import EventList from '../components/EventList'

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
      <p style={{ margin: '0 0 14px', fontSize: 13.5, color: 'var(--muted)' }}>Mark show / no-show for planned volunteers and capture walk-ins on the day.</p>
      {err && <ErrorCard>Couldn't load events: {err}</ErrorCard>}
      {loading ? <Loading label="Loading events…" /> : (
        <EventList events={acts} phasesByEvent={phasesByEvent} onOpen={setOpenId} />
      )}
    </Pad>
  )
}

export function Detail({ activity, onBack, me, isCoordinator, types = [], onActivityChanged, onToast, embedded = false }) {
  const [attendees, setAttendees] = useState(null)
  const [blocks, setBlocks] = useState([]) // this event's blocks — attendance inherits the block's type
  const [err, setErr] = useState(null)
  const [q, setQ] = useState('')
  const [debouncedQ, setDebouncedQ] = useState('')
  const [results, setResults] = useState([])
  const [markBlockId, setMarkBlockId] = useState('') // which block the walk-in attended (its type is inherited)
  const [busy, setBusy] = useState(false)
  const [capturing, setCapturing] = useState(false)
  const [creating, setCreating] = useState(false) // Create Attendance (date + centre + type) form
  const [typeChange, setTypeChange] = useState(null) // { newId } — keep-vs-propagate prompt
  const [busyAction, setBusyAction] = useState(false)
  const searchSeq = useRef(0)

  async function load() {
    try {
      const [att, bl] = await Promise.all([
        supabase.from('attendance')
          .select('id, person_id, time_in, activity_type_id, block_id, person:people!attendance_person_id_fkey(full_name)')
          .eq('activity_id', activity.id).order('time_in', { ascending: false }),
        supabase.from('activity_blocks').select('id, heading, activity_type_id').eq('activity_id', activity.id).order('created_at'),
      ])
      if (att.error) throw att.error
      setAttendees(att.data || [])
      setBlocks(bl.data || [])
    } catch (e) {
      setErr(e.message || String(e))
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity.id])

  // Debounce the mark-present search (~300ms) + cancel stale responses.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300)
    return () => clearTimeout(t)
  }, [q])
  useEffect(() => {
    if (debouncedQ.length < 2) { setResults([]); return }
    const seq = ++searchSeq.current
    supabase.from('people').select('id, full_name, phone').ilike('full_name', `%${debouncedQ}%`).limit(8)
      .then(({ data }) => { if (seq === searchSeq.current) setResults(data || []) })
  }, [debouncedQ])

  // The attendee's activity type is INHERITED from the chosen block (or the event
  // type when no blocks). It is never picked independently.
  const markBlock = blocks.find((b) => b.id === markBlockId) || null
  const markTypeId = markBlock ? (markBlock.activity_type_id || null) : (activity.activity_type_id || null)

  async function addAttendee(p) {
    setBusy(true)
    try {
      const typeId = markTypeId
      const { error } = await supabase.from('attendance').insert({ activity_id: activity.id, person_id: p.id, activity_type_id: typeId, block_id: markBlockId || null })
      if (error) throw error
      const kind = types.find((t) => t.id === typeId)?.kind || 'volunteer'
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

      <div className="card" style={{ padding: 24, marginBottom: 20 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px' }}>{activity.name}{activity.archived_at && <span className="pill" style={{ ...pill('#F1EADD', '#8C7E6B'), marginLeft: 10, verticalAlign: 'middle' }}>archived</span>}</h2>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{fmtDate(activity.activity_date)} · {activity.center_id}</div>
          </div>
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
      </div>

      {err && <ErrorCard>{err}</ErrorCard>}

      <div>
        {/* attendance (show/no-show + walk-ins only — no to-dos here) */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <h3 style={{ fontSize: 16, fontWeight: 600, margin: 0 }}>Attendance</h3>
            <span className="pill" style={pill('#EAF2E5', '#4E7C3F')}>{attCount} present</span>
          </div>

          {isCoordinator && (
            <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
              <button className="btn btn-primary" style={{ flex: 1, minWidth: 150, padding: '11px', fontSize: 14 }} onClick={() => setCreating(true)}>
                ＋ Create attendance
              </button>
              <button className="btn btn-ghost" style={{ flex: 1, minWidth: 150, padding: '11px', fontSize: 14 }} onClick={() => setCapturing(true)}>
                + Capture walk-in
              </button>
            </div>
          )}
          {unresolvedCount > 0 && (
            <div style={{ fontSize: 12.5, color: '#9C4A14', background: '#FBF1E4', border: '1px solid #E7C9B8', borderRadius: 9, padding: '8px 11px', marginBottom: 12 }}>
              {unresolvedCount} unresolved walk-in{unresolvedCount > 1 ? 's' : ''} — resolve in the <strong>Unresolved</strong> queue.
            </div>
          )}

          {/* The attendee's activity type is INHERITED from the block they attended
              (setup block → setup, etc.) — never picked independently. */}
          {blocks.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Attending</span>
              <select value={markBlockId} onChange={(e) => setMarkBlockId(e.target.value)} style={{ fontSize: 12.5, padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 8, background: '#fff', color: 'var(--ink)', cursor: 'pointer' }}>
                <option value="">— event (no block) —</option>
                {blocks.map((b) => <option key={b.id} value={b.id}>{b.heading}{b.activity_type_id ? ` · ${typeLabel(b.activity_type_id)}` : ''}</option>)}
              </select>
              <span style={{ fontSize: 11, color: 'var(--muted-2)' }}>type: <TypeBadge typeId={markTypeId} types={types} /></span>
            </div>
          )}
          <div style={{ position: 'relative', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 12px' }}>
              {Icon.search(15)}
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a person to mark present…" style={{ border: 'none', outline: 'none', fontSize: 13, fontFamily: 'inherit', background: 'transparent', width: '100%' }} />
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
                <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <TypeBadge typeId={r.activity_type_id} types={types} />
                  <span className="pill" style={pill('#EAF2E5', '#4E7C3F')}>Present</span>
                </div>
              </div>
            ))
          )}
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

      {creating && (
        <CreateAttendanceForm
          activity={activity}
          types={types}
          me={me}
          onClose={() => setCreating(false)}
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

    </AttWrap>
  )
}

// Create Attendance — capture presence on a specific DATE (within the event span)
// at a CENTRE (location only, never reassigns the person's owning centre), tagged
// with a SHARED activity_type. Add multiple people under one context; run again
// for another date. The activity_type_id flows to each volunteer's history +
// drives the Volunteers activity-type filter (same-activity targeting).
function CreateAttendanceForm({ activity, types = [], me, onClose, onChanged, onToast }) {
  const spanStart = activity.start_date || activity.activity_date
  const spanEnd = activity.end_date || activity.start_date || activity.activity_date
  const today = new Date().toISOString().slice(0, 10)
  const [kind, setKind] = useState('volunteer') // volunteer | meditator (= participant)
  const [date, setDate] = useState(today >= spanStart && today <= spanEnd ? today : spanStart)
  const [centre, setCentre] = useState(activity.center_id || '')
  const [centres, setCentres] = useState([])
  const [localTypes, setLocalTypes] = useState([])
  const [typeId, setTypeId] = useState('')
  const [newType, setNewType] = useState('')
  const [addingType, setAddingType] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [added, setAdded] = useState([])
  const [busy, setBusy] = useState(false)
  const seq = useRef(0)

  useEffect(() => {
    supabase.from('centers').select('id, name, active').order('name')
      .then(({ data }) => setCentres((data || []).filter((c) => c.active && !['all', 'unassigned'].includes(c.id))))
  }, [])

  const allTypes = [...types, ...localTypes]
  const typeOpts = allTypes.filter((t) => (t.kind || 'volunteer') === kind && t.active !== false)
  useEffect(() => { if (typeId && !typeOpts.some((t) => t.id === typeId)) setTypeId('') }, [kind]) // eslint-disable-line

  useEffect(() => {
    const h = setTimeout(async () => {
      const term = q.trim()
      if (term.length < 2) { setResults([]); return }
      const s = ++seq.current
      const { data } = await supabase.from('people').select('id, full_name, phone').ilike('full_name', `%${term}%`).limit(8)
      if (s === seq.current) setResults(data || [])
    }, 300)
    return () => clearTimeout(h)
  }, [q])

  const dateOk = date >= spanStart && date <= spanEnd

  async function createType() {
    const label = newType.trim()
    if (!label) return
    setBusy(true)
    try {
      const { data, error } = await supabase.from('activity_types').insert({ label, kind }).select('id, label, kind, active').single()
      if (error) throw error
      setLocalTypes((l) => [...l, data])
      setTypeId(data.id); setNewType(''); setAddingType(false)
      onToast(`Activity type "${label}" added — reusable everywhere.`)
    } catch (e) { onToast('Could not add type: ' + (e.message || e)) } finally { setBusy(false) }
  }

  async function add(p) {
    if (!typeId) return onToast('Pick an activity type first.')
    if (!dateOk) return onToast(`Pick a date within ${fmtDay(spanStart)}–${fmtDay(spanEnd)}.`)
    setBusy(true)
    try {
      const { error } = await supabase.from('attendance').insert({
        activity_id: activity.id, person_id: p.id, activity_type_id: typeId,
        attended_on: date, center_id: centre || activity.center_id || null,
      })
      if (error) throw error
      await ensureParticipation(p.id, kind, { source: 'event_attendance' })
      setAdded((a) => [{ id: p.id, name: p.full_name }, ...a.filter((x) => x.id !== p.id)])
      setQ(''); setResults([])
      onToast(`${p.full_name} — present on ${fmtDay(date)}.`)
      onChanged()
    } catch (e) { onToast('Could not add: ' + (e.message || e)) } finally { setBusy(false) }
  }

  const lbl = { fontSize: 12, fontWeight: 600, color: '#5C5142', display: 'block', marginBottom: 5 }
  const fld = { fontSize: 13, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 9, background: '#fff', color: 'var(--ink)', width: '100%' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 130, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 520, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 22, boxShadow: 'var(--shadow-lg)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Create attendance</h3>
          <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={onClose}>✕ Close</button>
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 16 }}>{activity.name} · {fmtDay(spanStart)}{spanEnd !== spanStart ? `–${fmtDay(spanEnd)}` : ''}</div>

        {/* Volunteer / Participant */}
        <div style={{ marginBottom: 14 }}>
          <span style={lbl}>They attended as</span>
          <div style={{ display: 'flex', gap: 8 }}>
            {[['volunteer', 'Volunteer'], ['meditator', 'Participant']].map(([k, label]) => (
              <button key={k} onClick={() => setKind(k)} style={{ flex: 1, padding: '9px', fontSize: 13, fontWeight: 600, borderRadius: 9, cursor: 'pointer',
                border: kind === k ? '1px solid #C2691F' : '1px solid var(--border)', background: kind === k ? '#F6E8D8' : '#fff', color: kind === k ? '#C2691F' : 'var(--muted)' }}>{label}</button>
            ))}
          </div>
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 150 }}>
            <span style={lbl}>Date</span>
            <input type="date" value={date} min={spanStart} max={spanEnd} onChange={(e) => setDate(e.target.value)} style={{ ...fld, borderColor: dateOk ? 'var(--border)' : '#E7A08A' }} />
            {!dateOk && <div style={{ fontSize: 11, color: '#B5532F', marginTop: 3 }}>Must be within the event span.</div>}
          </div>
          <div style={{ flex: 1, minWidth: 150 }}>
            <span style={lbl}>Centre <span style={{ fontWeight: 400, color: 'var(--muted-2)' }}>· where it happened</span></span>
            <select value={centre} onChange={(e) => setCentre(e.target.value)} style={fld}>
              {!centres.some((c) => c.id === centre) && centre && <option value={centre}>{centre}</option>}
              {centres.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
            </select>
          </div>
        </div>

        {/* Activity type from the shared vocabulary + inline create */}
        <div style={{ marginBottom: 16 }}>
          <span style={lbl}>Activity type <span style={{ fontWeight: 400, color: 'var(--muted-2)' }}>· shared list</span></span>
          {addingType ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <input autoFocus value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="New activity type (e.g. Kitchen)"
                onKeyDown={(e) => e.key === 'Enter' && createType()} style={fld} />
              <button className="btn btn-primary" disabled={busy || !newType.trim()} onClick={createType} style={{ fontSize: 12.5, padding: '8px 12px' }}>Add</button>
              <button className="btn btn-ghost" onClick={() => { setAddingType(false); setNewType('') }} style={{ fontSize: 12.5, padding: '8px 10px' }}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={typeId} onChange={(e) => setTypeId(e.target.value)} style={fld}>
                <option value="">— pick {kind === 'meditator' ? 'participant' : 'volunteer'} activity —</option>
                {typeOpts.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <button className="btn btn-ghost" onClick={() => setAddingType(true)} style={{ fontSize: 12.5, padding: '8px 12px', whiteSpace: 'nowrap' }}>＋ New type</button>
            </div>
          )}
        </div>

        {/* Person search — adds each under the context above */}
        <div style={{ position: 'relative', marginBottom: 10 }}>
          <span style={lbl}>Mark people present</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, background: '#fff', border: '1px solid var(--border)', borderRadius: 9, padding: '8px 12px' }}>
            {Icon.search(15)}
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a person…" style={{ border: 'none', outline: 'none', fontSize: 13, background: 'transparent', width: '100%' }} />
          </div>
          {results.length > 0 && (
            <div className="card" style={{ position: 'absolute', top: 66, left: 0, right: 0, zIndex: 20, boxShadow: 'var(--shadow-lg)', padding: 6 }}>
              {results.map((p) => (
                <div key={p.id} className="rowhover" style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '8px 10px', borderRadius: 8, cursor: busy ? 'default' : 'pointer' }} onClick={() => !busy && add(p)}>
                  <div style={{ width: 26, height: 26, borderRadius: '50%', background: avatarFor(0), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{initials(p.full_name)}</div>
                  <div style={{ fontSize: 13, fontWeight: 500 }}>{p.full_name}</div>
                  <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--orange)', fontWeight: 600 }}>{busy ? '…' : '+ present'}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {added.length > 0 && (
          <div style={{ marginTop: 6 }}>
            <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginBottom: 6 }}>Added on {fmtDay(date)} · {added.length}</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {added.map((a) => <span key={a.id} className="pill" style={pill('#EAF2E5', '#4E7C3F')}>{a.name}</span>)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Event-level Edit / Archive / Delete — belongs to the EVENT, not the attendance
// sheet. Rendered in the Event Hub header. Self-contained: it fetches its own
// attendance count for the delete gate (attendance-bearing events archive, never
// hard-delete) and owns the edit form.
export function EventActions({ activity, me, isCoordinator, onToast, onChanged, onDeleted }) {
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState(false)
  const [attCount, setAttCount] = useState(null)
  const nowISO = () => new Date().toISOString()

  useEffect(() => {
    let alive = true
    supabase.from('attendance').select('id', { count: 'exact', head: true }).eq('activity_id', activity.id)
      .then(({ count }) => { if (alive) setAttCount(count || 0) })
    return () => { alive = false }
  }, [activity.id])

  if (!isCoordinator) return null

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
    if ((attCount || 0) > 0) { onToast(`This event has ${attCount} attendance record(s) — archive instead of delete.`); return }
    if (!window.confirm(`Permanently delete “${activity.name}”? It has no attendance. This cannot be undone.`)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('activities').delete().eq('id', activity.id)
      if (error) throw error // RESTRICT FK also blocks if attendance somehow exists
      onToast('Event deleted.')
      onDeleted?.()
    } catch (e) { onToast('Could not delete: ' + (e.message || e)) } finally { setBusy(false) }
  }

  return (
    <>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" disabled={busy} style={{ fontSize: 12.5, padding: '7px 12px' }} onClick={() => setEditing(true)}>Edit</button>
        {activity.archived_at
          ? <button className="btn btn-ghost" disabled={busy} style={{ fontSize: 12.5, padding: '7px 12px' }} onClick={() => setArchived(false)}>Unarchive</button>
          : <button className="btn btn-ghost" disabled={busy} style={{ fontSize: 12.5, padding: '7px 12px' }} onClick={() => setArchived(true)}>Archive</button>}
        <button
          title={(attCount || 0) > 0 ? `Has ${attCount} attendance record(s) — archive instead` : 'Delete (no attendance)'}
          disabled={busy}
          onClick={hardDelete}
          style={{ fontSize: 12.5, padding: '7px 12px', fontWeight: 600, borderRadius: 8, border: '1px solid #E7C9B8', background: '#fff', color: (attCount || 0) > 0 ? 'var(--muted-2)' : '#B5532F', cursor: busy ? 'default' : 'pointer' }}
        >Delete</button>
      </div>
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
    const { error } = await supabase.from('block_assignments').update({ status: next, marked_by: me?.id || null, marked_at: new Date().toISOString() }).in('id', group.rows.map((r) => r.id))
    if (error) return onToast('Could not mark: ' + error.message)
    onToast(`Marked ${next === 'assigned' ? 'cleared' : next.replace('_', '-')}.`)
    load()
  }

  if (data === undefined || data.blocks.length === 0) return null
  const STATUS = { assigned: { t: '—', c: 'var(--muted-2)' }, show: { t: 'showed', c: '#4E7C3F' }, no_show: { t: 'no-show', c: '#B5532F' }, dropped: { t: 'dropped', c: '#9C4A14' }, involved: { t: 'involved', c: '#C2691F' } }
  const MODE_TAG = { per_day: 'per-day', span: 'span', involved_only: 'involved only' }

  return (
    <div className="card" style={{ padding: 20, marginTop: 16 }}>
      <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 4px' }}>Planned volunteers · attendance</h3>
      <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>How presence is marked follows each block’s attendance mode. Involved-only credits participation without a reliability data point.</div>
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
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{b.heading}</div>
              <span className="pill" style={{ background: '#F1EADD', color: '#8C7E6B', fontSize: 10 }}>{MODE_TAG[mode]}</span>
            </div>
            {groups.length === 0 ? <div style={{ fontSize: 12, color: 'var(--muted-2)' }}>No one assigned.</div> : groups.map((g) => {
              const s = STATUS[g.status] || STATUS.assigned
              return (
                <div key={g.key} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid #F4EEE2' }}>
                  <div style={{ fontSize: 12.5, fontWeight: 500, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{data.people[g.personId]?.full_name || 'Unknown'}</div>
                  {mode === 'per_day' && <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{fmtDay(g.day)}</span>}
                  {isCoordinator ? (
                    mode === 'involved_only' ? (
                      <button onClick={() => markGroup(g, 'involved')} title="Credit participation (no presence check, no reliability)" style={{ padding: '4px 9px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid #E7C9B8', background: g.status === 'involved' ? '#F6E8D8' : '#fff', color: '#C2691F', cursor: 'pointer' }}>Involved</button>
                    ) : (
                      <div style={{ display: 'flex', gap: 4 }}>
                        <button onClick={() => markGroup(g, 'show')} title={mode === 'span' ? 'Present for the whole block' : 'Showed'} style={{ padding: '4px 9px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid #CDE3C6', background: g.status === 'show' ? '#EAF2E5' : '#fff', color: '#4E7C3F', cursor: 'pointer' }}>{mode === 'span' ? 'Present' : 'Show'}</button>
                        <button onClick={() => markGroup(g, 'no_show')} title="No-show (reopens the slot)" style={{ padding: '4px 9px', fontSize: 11, fontWeight: 600, borderRadius: 6, border: '1px solid #E7C9B8', background: g.status === 'no_show' ? '#FBE6E0' : '#fff', color: '#B5532F', cursor: 'pointer' }}>{mode === 'span' ? 'Absent' : 'No-show'}</button>
                      </div>
                    )
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
