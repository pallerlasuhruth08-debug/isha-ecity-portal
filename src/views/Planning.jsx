import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pill } from '../lib/ui'
import { Pad, ErrorCard, Loading } from '../components/View'

// BOUNDARY (do not blur): Planning CONSUMES events read-only — it reads activities
// and edits ONLY their stage (event_stages). It does NOT create/delete events and
// must NOT own event creation. Event creation/management lives permanently on the
// EVENTS screen (see src/views/Events.jsx). "View-only" is about THIS consumer, not
// the Events screen — never let it strip the Create-event action there.
const STAGES = ['Thinking', 'Planning', 'Executing', 'Reminder', 'Done']
const STAGE_DOT = { Thinking: '#B7A88E', Planning: '#C28A2A', Executing: '#C2691F', Reminder: '#2F6E5E', Done: '#4E7C3F' }

function fmtDate(d) {
  if (!d) return 'TBD'
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function Planning({ onToast }) {
  const [acts, setActs] = useState(null)
  const [stages, setStages] = useState({})
  const [pending, setPending] = useState({})
  const [err, setErr] = useState(null)

  async function load() {
    try {
      const [a, s, t] = await Promise.all([
        supabase.from('activities').select('id, name, center_id, activity_date, activity_type').is('archived_at', null).order('activity_date', { ascending: false }).limit(200),
        supabase.from('event_stages').select('activity_id, stage'),
        supabase.from('event_todos').select('activity_id, done'),
      ])
      if (a.error) throw a.error
      if (s.error) throw s.error
      if (t.error) throw t.error
      setActs(a.data || [])
      setStages(Object.fromEntries((s.data || []).map((r) => [r.activity_id, r.stage])))
      const pend = {}
      for (const row of t.data || []) if (!row.done) pend[row.activity_id] = (pend[row.activity_id] || 0) + 1
      setPending(pend)
    } catch (e) {
      setErr(e.message || String(e))
    }
  }
  useEffect(() => {
    load()
  }, [])

  async function move(id, stage) {
    setStages((p) => ({ ...p, [id]: stage }))
    const { error } = await supabase.from('event_stages').upsert({ activity_id: id, stage, updated_at: new Date().toISOString() }, { onConflict: 'activity_id' })
    if (error) {
      onToast('Could not move: ' + error.message)
      load()
    } else onToast(`Moved to ${stage}.`)
  }

  const columns = useMemo(() => {
    const cols = Object.fromEntries(STAGES.map((s) => [s, []]))
    for (const a of acts || []) {
      const st = stages[a.id] || 'Planning'
      ;(cols[st] || cols.Planning).push(a)
    }
    return cols
  }, [acts, stages])

  const loading = !acts && !err

  return (
    <Pad>
      <p style={{ margin: '0 0 16px', fontSize: 13.5, color: 'var(--muted)' }}>
        Calendar &amp; the things that need to get done — every event moving through its lifecycle, from first thought to done.
      </p>
      {err && <ErrorCard>Couldn't load planning board: {err}</ErrorCard>}
      {loading && <Loading label="Loading planning board…" />}

      {!loading && (
        <div style={{ display: 'grid', gridTemplateColumns: `repeat(${STAGES.length}, minmax(200px, 1fr))`, gap: 12, overflowX: 'auto' }}>
          {STAGES.map((st) => (
            <div key={st} style={{ background: 'rgba(255,255,255,0.5)', border: '1px solid var(--border-soft)', borderRadius: 14, padding: 10, minHeight: 200 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, padding: '4px 6px 10px' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: STAGE_DOT[st] }} />
                <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--ink-soft)' }}>{st}</span>
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted-2)' }}>{columns[st].length}</span>
              </div>
              {columns[st].map((a) => (
                <div key={a.id} className="card" style={{ padding: 12, marginBottom: 8 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, marginBottom: 5 }}>{a.name}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', marginBottom: 8 }}>{fmtDate(a.activity_date)} · {a.center_id}</div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {pending[a.id] > 0 && <span className="pill" style={{ ...pill('#FBEAD9', '#C28A2A'), fontSize: 10.5, padding: '3px 8px' }}>{pending[a.id]} to-do</span>}
                    <select value={st} onChange={(e) => move(a.id, e.target.value)} style={{ marginLeft: 'auto', fontSize: 11, border: '1px solid var(--border)', borderRadius: 7, padding: '3px 5px', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', fontFamily: 'inherit' }}>
                      {STAGES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </Pad>
  )
}
