import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { pill, initials, avatarFor } from '../lib/ui'
import { Pad, ErrorCard, Loading, Empty } from '../components/View'
import WalkinCapture from '../components/WalkinCapture'
import { ensureParticipation } from '../lib/volunteers'
import { fetchActivityTypes } from '../lib/activityTypes'

const STAGES = ['Thinking', 'Planning', 'Executing', 'Reminder', 'Done']
const STAGE_PILL = {
  Thinking: pill('#F1EADD', '#8C7E6B'),
  Planning: pill('#FBEAD9', '#C28A2A'),
  Executing: pill('#F6E8D8', '#C2691F'),
  Reminder: pill('#E9F0EF', '#2F6E5E'),
  Done: pill('#EAF2E5', '#4E7C3F'),
}
const STAGE_DOT = { Thinking: '#B7A88E', Planning: '#C28A2A', Executing: '#C2691F', Reminder: '#2F6E5E', Done: '#4E7C3F' }

function fmtDate(d) {
  if (!d) return 'TBD'
  return new Date(d).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
}

export default function Events({ me, isCoordinator = false, onToast }) {
  const [acts, setActs] = useState(null)
  const [stages, setStages] = useState({})
  const [types, setTypes] = useState([])
  const [err, setErr] = useState(null)
  const [openId, setOpenId] = useState(null)

  async function load() {
    try {
      const [a, s, t] = await Promise.all([
        supabase.from('activities').select('id, name, center_id, activity_date, activity_type, activity_type_id, is_open, description').order('activity_date', { ascending: false }).limit(200),
        supabase.from('event_stages').select('activity_id, stage'),
        fetchActivityTypes().catch(() => []),
      ])
      if (a.error) throw a.error
      if (s.error) throw s.error
      setActs(a.data || [])
      setStages(Object.fromEntries((s.data || []).map((r) => [r.activity_id, r.stage])))
      setTypes(t || [])
    } catch (e) {
      setErr(e.message || String(e))
    }
  }
  useEffect(() => {
    load()
  }, [])

  async function setStage(activityId, stage) {
    setStages((p) => ({ ...p, [activityId]: stage }))
    const { error } = await supabase.from('event_stages').upsert({ activity_id: activityId, stage, updated_at: new Date().toISOString() }, { onConflict: 'activity_id' })
    if (error) {
      onToast('Could not save stage: ' + error.message)
      load()
    }
  }

  const loading = !acts && !err
  const open = openId ? (acts || []).find((a) => a.id === openId) : null

  if (open) return <Detail activity={open} stage={stages[open.id] || 'Planning'} onStage={(st) => setStage(open.id, st)} onBack={() => setOpenId(null)} me={me} isCoordinator={isCoordinator} types={types} onActivityChanged={load} onToast={onToast} />

  return (
    <Pad>
      <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--muted)', maxWidth: 520 }}>
        Offline &amp; online events — take attendance, add walk-ins on the day, and track each event's stage &amp; to-dos.
      </p>
      {err && <ErrorCard>Couldn't load events: {err}</ErrorCard>}
      {loading && <Loading label="Loading events…" />}
      {!loading && (acts || []).length === 0 && <Empty label="No events yet." />}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 16 }}>
        {(acts || []).map((a) => {
          const st = stages[a.id] || 'Planning'
          return (
            <div key={a.id} className="rowhover card" style={{ padding: 20, cursor: 'pointer' }} onClick={() => setOpenId(a.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1.25 }}>{a.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{fmtDate(a.activity_date)} · {a.center_id}</div>
                </div>
                <span className="pill" style={STAGE_PILL[st]}>{st}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 12, borderTop: '1px solid #F2EBDD', color: 'var(--orange)', fontSize: 13, fontWeight: 600 }}>
                <span style={{ color: a.is_open ? '#4E7C3F' : '#8C7E6B', fontSize: 12 }}>{a.is_open ? '● open' : '○ closed'}</span>
                <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 5 }}>
                  Open
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6" /></svg>
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </Pad>
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

  return (
    <Pad>
      <div onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: 'var(--orange)', cursor: 'pointer', marginBottom: 16 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
        All events
      </div>

      <div className="card" style={{ padding: 24, marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px' }}>{activity.name}</h2>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>{fmtDate(activity.activity_date)} · {activity.center_id}</div>

        {/* activity type — the shared vocabulary; attendees inherit this id */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#5C5142' }}>Activity type</span>
          <select
            value={activity.activity_type_id || ''}
            disabled={!isCoordinator}
            onChange={async (e) => {
              const id = e.target.value || null
              const { error } = await supabase.from('activities').update({ activity_type_id: id }).eq('id', activity.id)
              if (error) return onToast('Could not set type: ' + error.message)
              onToast('Event type updated.')
              onActivityChanged?.()
            }}
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

      {capturing && (
        <WalkinCapture
          activity={activity}
          me={me}
          onClose={() => setCapturing(false)}
          onChanged={load}
          onToast={onToast}
        />
      )}
    </Pad>
  )
}
