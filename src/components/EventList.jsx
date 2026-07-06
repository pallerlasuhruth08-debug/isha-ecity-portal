import { useMemo, useState } from 'react'
import { pill } from '../lib/ui'
import { eventDays, currentPhase, phaseTone, rangeLabel, todayISO } from '../lib/planning'

// Shared event-list UI used by BOTH the Attendance and Planning pages. Identical
// layout; the PAGE supplies onOpen (its own detail) — the two never share a detail.
// Default tab = upcoming only; past events live behind the "All" tab.
// phasesByEvent: activity_id -> event_phases[] (drives the current-phase pill).
export default function EventList({ events, phasesByEvent = {}, onOpen, right = null }) {
  const [tab, setTab] = useState('upcoming')
  const t = todayISO()

  const upcoming = useMemo(() => {
    const sorted = events.filter((e) => (e.end_date || e.start_date || e.activity_date || '9999') >= t)
      .sort((a, b) => (a.start_date || a.activity_date || '').localeCompare(b.start_date || b.activity_date || ''))
    // A recurring series contributes only its NEXT occurrence to Upcoming (keeps
    // the window uncluttered); the "All" tab shows every occurrence.
    const seenSeries = new Set()
    return sorted.filter((e) => {
      if (!e.series_id) return true
      if (seenSeries.has(e.series_id)) return false
      seenSeries.add(e.series_id)
      return true
    })
  }, [events, t])
  const all = useMemo(
    () => [...events].sort((a, b) => (b.start_date || b.activity_date || '').localeCompare(a.start_date || a.activity_date || '')),
    [events],
  )
  const shown = tab === 'upcoming' ? upcoming : all

  const TabBtn = ({ k, label, n }) => (
    <button onClick={() => setTab(k)} className="btn" style={{ padding: '7px 14px', fontSize: 12.5, borderRadius: 20, background: tab === k ? '#241B14' : '#fff', color: tab === k ? '#F6ECDC' : 'var(--ink-soft)', border: tab === k ? 'none' : '1px solid var(--border)' }}>
      {label} <span style={{ opacity: 0.6 }}>{n}</span>
    </button>
  )

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        <TabBtn k="upcoming" label="Upcoming" n={upcoming.length} />
        <TabBtn k="all" label="All events" n={all.length} />
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, flexWrap: 'wrap' }}>{right}</div>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        {shown.length === 0 ? (
          <div style={{ padding: 26, textAlign: 'center', fontSize: 13, color: 'var(--muted-2)' }}>
            {tab === 'upcoming' ? 'No upcoming events.' : 'No events yet.'}
          </div>
        ) : shown.map((e) => {
          const ph = currentPhase(e, phasesByEvent[e.id])
          const tone = phaseTone(ph.kind)
          const past = (e.end_date || e.start_date || e.activity_date || '') < t
          return (
            <div key={e.id} className="rowhover" onClick={() => onOpen(e.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderBottom: '1px solid #F1E9DB', cursor: 'pointer' }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {e.name}
                  {e.series_id && <span title="Recurring event" style={{ marginLeft: 8, fontSize: 12, color: 'var(--muted-2)' }}>↻</span>}
                  {e.archived_at && <span className="pill" style={{ ...pill('#F1EADD', '#8C7E6B'), marginLeft: 8, fontSize: 10 }}>archived</span>}
                </div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{rangeLabel(e.start_date || e.activity_date, e.end_date)} · {e.center_id}</div>
              </div>
              <span className="pill" style={{ background: tone.bg, color: tone.fg, opacity: past ? 0.65 : 1 }}>{ph.label}</span>
              <span style={{ fontSize: 12, color: 'var(--orange)', fontWeight: 600, whiteSpace: 'nowrap' }}>Open →</span>
            </div>
          )
        })}
      </div>
    </>
  )
}

// Bare month grid (no overlay) — reused by the page-level calendar panel AND the
// utility drawer's Calendar tab. Clicking an event calls onOpen; clicking a day
// (when onCreateDay is provided) calls onCreateDay(dayISO).
export function MonthGrid({ events, phasesByEvent = {}, onOpen, onCreateDay, compact = false, headerRight = null }) {
  const now = new Date()
  const [ym, setYm] = useState({ y: now.getFullYear(), m: now.getMonth() })
  const first = new Date(ym.y, ym.m, 1)
  const startWeekday = first.getDay()
  const daysInMonth = new Date(ym.y, ym.m + 1, 0).getDate()
  const monthLabel = first.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
  const t = todayISO()

  const byDay = useMemo(() => {
    const map = {}
    for (const e of events) for (const d of eventDays(e.start_date || e.activity_date, e.end_date)) (map[d] ||= []).push(e)
    return map
  }, [events])

  const cells = []
  for (let i = 0; i < startWeekday; i++) cells.push(null)
  for (let d = 1; d <= daysInMonth; d++) cells.push(`${ym.y}-${String(ym.m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`)
  while (cells.length % 7 !== 0) cells.push(null)
  const shift = (delta) => setYm(({ y, m }) => { const nm = m + delta; return { y: y + Math.floor(nm / 12), m: ((nm % 12) + 12) % 12 } })
  const cap = compact ? 2 : 3

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
        <button className="btn btn-ghost" style={{ padding: '6px 10px' }} onClick={() => shift(-1)}>‹</button>
        <div style={{ fontSize: compact ? 14 : 16, fontWeight: 600, minWidth: 120, textAlign: 'center' }}>{monthLabel}</div>
        <button className="btn btn-ghost" style={{ padding: '6px 10px' }} onClick={() => shift(1)}>›</button>
        <button className="btn btn-ghost" style={{ padding: '6px 10px', fontSize: 12 }} onClick={() => setYm({ y: now.getFullYear(), m: now.getMonth() })}>Today</button>
        {headerRight}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: 'var(--border)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((w) => (
          <div key={w} style={{ background: 'var(--panel)', padding: '6px', fontSize: 9.5, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted-2)', textAlign: 'center' }}>{w}</div>
        ))}
        {cells.map((d, i) => (
          <div key={i} onClick={() => d && onCreateDay && onCreateDay(d)} style={{ background: d === t ? '#FBF1E6' : '#fff', minHeight: compact ? 58 : 84, padding: 4, cursor: d && onCreateDay ? 'pointer' : 'default', display: 'flex', flexDirection: 'column', gap: 2 }}>
            {d && <div style={{ fontSize: 10, fontWeight: d === t ? 700 : 500, color: d === t ? 'var(--orange)' : 'var(--muted-2)' }}>{Number(d.slice(-2))}</div>}
            {(byDay[d] || []).slice(0, cap).map((e) => {
              const tone = phaseTone(currentPhase(e, phasesByEvent[e.id]).kind)
              return (
                <div key={e.id} onClick={(ev) => { ev.stopPropagation(); onOpen && onOpen(e.id) }} title={e.name} style={{ fontSize: 9.5, fontWeight: 600, background: tone.bg, color: tone.fg, borderRadius: 4, padding: '1px 4px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', cursor: 'pointer' }}>{e.name}</div>
              )
            })}
            {(byDay[d] || []).length > cap && <div style={{ fontSize: 9, color: 'var(--muted-2)' }}>+{byDay[d].length - cap}</div>}
          </div>
        ))}
      </div>
    </>
  )
}

// Full-screen calendar panel over a page's list (page-level create-from-day).
export function EventCalendarPanel({ events, phasesByEvent = {}, onOpen, onCreateDay, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: 20, zIndex: 120, overflowY: 'auto' }} onClick={onClose}>
      <div className="card" style={{ maxWidth: 760, width: '100%', marginTop: 30, padding: 20 }} onClick={(e) => e.stopPropagation()}>
        <MonthGrid events={events} phasesByEvent={phasesByEvent} onOpen={onOpen} onCreateDay={onCreateDay}
          headerRight={<div onClick={onClose} style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600, color: 'var(--orange)', cursor: 'pointer' }}>✕ Close</div>} />
        {onCreateDay && <div style={{ marginTop: 10, fontSize: 11.5, color: 'var(--muted-2)' }}>Click a day to create an event · click an event to open it.</div>}
      </div>
    </div>
  )
}
