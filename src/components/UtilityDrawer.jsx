import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Loading, Empty } from './View'
import { MonthGrid } from './EventList'
import { fmtDay } from '../lib/planning'

// Utility drawer — SEPARATE from the left nav. Slides in from the RIGHT edge over
// the current page (page state preserved). Tabs: Calendar (quick glance) + Notes.
// Available on every screen. Toggle via the edge button (App) or edge-swipe (mobile).
export default function UtilityDrawer({ open, onClose, me, onOpenEvent }) {
  const [tab, setTab] = useState('calendar')
  return (
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, background: 'rgba(20,12,6,0.4)', zIndex: 140, opacity: open ? 1 : 0, pointerEvents: open ? 'auto' : 'none', transition: 'opacity 0.22s ease' }} />
      <aside className="scrollarea" style={{ position: 'fixed', top: 0, right: 0, bottom: 0, width: 380, maxWidth: '90%', background: 'var(--bg)', zIndex: 141, boxShadow: open ? '-8px 0 40px rgba(0,0,0,0.2)' : 'none', transform: open ? 'translateX(0)' : 'translateX(100%)', transition: 'transform 0.24s ease', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 16px', borderBottom: '1px solid var(--border)', background: 'var(--panel)' }}>
          {['calendar', 'notes'].map((k) => (
            <button key={k} onClick={() => setTab(k)} className="btn" style={{ padding: '7px 14px', fontSize: 12.5, borderRadius: 20, textTransform: 'capitalize', background: tab === k ? '#241B14' : '#fff', color: tab === k ? '#F6ECDC' : 'var(--ink-soft)', border: tab === k ? 'none' : '1px solid var(--border)' }}>{k}</button>
          ))}
          <div onClick={onClose} style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600, color: 'var(--orange)', cursor: 'pointer' }}>✕</div>
        </div>
        <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: 16 }} className="scrollarea">
          {open && tab === 'calendar' && <CalendarTab onOpenEvent={onOpenEvent} />}
          {open && tab === 'notes' && <NotesTab me={me} />}
        </div>
      </aside>
    </>
  )
}

function CalendarTab({ onOpenEvent }) {
  const [events, setEvents] = useState(null)
  const [stageRows, setStageRows] = useState({})
  useEffect(() => {
    let alive = true
    ;(async () => {
      const [a, s] = await Promise.all([
        supabase.from('activities').select('id, name, center_id, activity_date, start_date, end_date').is('archived_at', null),
        supabase.from('event_stages').select('activity_id, stage, manual'),
      ])
      if (!alive) return
      setEvents(a.data || [])
      setStageRows(Object.fromEntries((s.data || []).map((r) => [r.activity_id, r])))
    })()
    return () => { alive = false }
  }, [])
  if (!events) return <Loading label="Loading calendar…" />
  return (
    <>
      <MonthGrid events={events} stageRows={stageRows} compact onOpen={(id) => onOpenEvent && onOpenEvent(id)} />
      <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--muted-2)' }}>Click an event to open it on the Attendance page. Create events from Attendance or Planning.</div>
    </>
  )
}

// Notes — per-note visibility (private | shared), enforced by RLS. Autosave.
function NotesTab({ me }) {
  const [notes, setNotes] = useState(null)
  const [authors, setAuthors] = useState({})
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    const { data } = await supabase.from('notes').select('id, body, visibility, author_id, updated_at').order('updated_at', { ascending: false })
    const rows = data || []
    setNotes(rows)
    const others = [...new Set(rows.filter((n) => n.author_id !== me?.id).map((n) => n.author_id))]
    if (others.length) {
      const { data: p } = await supabase.from('profiles').select('id, full_name, email').in('id', others)
      setAuthors(Object.fromEntries((p || []).map((x) => [x.id, x.full_name || x.email])))
    }
  }, [me?.id])
  useEffect(() => { load() }, [load])

  async function newNote() {
    setBusy(true)
    // author_id defaults to auth.uid() server-side; visibility defaults to private.
    const { data, error } = await supabase.from('notes').insert({ body: '' }).select('id, body, visibility, author_id, updated_at').single()
    setBusy(false)
    if (error) return
    setNotes((prev) => [data, ...(prev || [])])
  }

  if (!notes) return <Loading label="Loading notes…" />
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button className="btn btn-primary" disabled={busy} onClick={newNote} style={{ padding: '10px', fontSize: 13, justifyContent: 'center' }}>＋ New note</button>
      {notes.length === 0 && <Empty label="No notes yet — jot down what's on your mind." />}
      {notes.map((n) => (
        <NoteCard key={n.id} note={n} mine={n.author_id === me?.id} authorName={authors[n.author_id]} onDeleted={() => setNotes((p) => p.filter((x) => x.id !== n.id))} />
      ))}
    </div>
  )
}

function NoteCard({ note, mine, authorName, onDeleted }) {
  const [body, setBody] = useState(note.body || '')
  const [vis, setVis] = useState(note.visibility)
  const [saved, setSaved] = useState(true)
  const timer = useRef(null)

  const save = useCallback(async (patch) => {
    const { error } = await supabase.from('notes').update({ ...patch, updated_at: new Date().toISOString() }).eq('id', note.id)
    if (!error) setSaved(true)
  }, [note.id])

  function onBody(v) {
    setBody(v); setSaved(false)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => save({ body: v }), 700)
  }
  function onVis(v) { setVis(v); setSaved(false); save({ visibility: v }) }
  async function del() {
    if (!window.confirm('Delete this note?')) return
    const { error } = await supabase.from('notes').delete().eq('id', note.id)
    if (!error) onDeleted()
  }

  return (
    <div className="card" style={{ padding: 12 }}>
      {mine ? (
        <textarea value={body} onChange={(e) => onBody(e.target.value)} placeholder="What's on your mind…" rows={3}
          style={{ width: '100%', border: 'none', outline: 'none', resize: 'vertical', fontSize: 13.5, fontFamily: 'inherit', background: 'transparent', color: 'var(--ink)', boxSizing: 'border-box' }} />
      ) : (
        <div style={{ fontSize: 13.5, whiteSpace: 'pre-wrap', color: 'var(--ink)' }}>{body || <span style={{ color: 'var(--muted-2)' }}>(empty)</span>}</div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
        {mine ? (
          <select value={vis} onChange={(e) => onVis(e.target.value)} style={{ fontSize: 11.5, padding: '4px 7px', border: '1px solid var(--border)', borderRadius: 7, background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer' }}>
            <option value="private">🔒 Private</option>
            <option value="shared">👥 Shared</option>
          </select>
        ) : (
          <span className="pill" style={{ background: '#EAF2E5', color: '#4E7C3F', fontSize: 10 }}>shared · {authorName || 'someone'}</span>
        )}
        <span style={{ fontSize: 10.5, color: 'var(--muted-2)' }}>{mine ? (saved ? 'saved' : 'saving…') : fmtDay((note.updated_at || '').slice(0, 10))}</span>
        {mine && <button onClick={del} title="Delete" style={{ marginLeft: 'auto', fontSize: 11, fontWeight: 600, color: '#B5532F', background: 'none', border: 'none', cursor: 'pointer' }}>Delete</button>}
      </div>
    </div>
  )
}
