// Shared "Repeats" controls for the create-event forms (Attendance + Planning).
// Google-Calendar-style: freq + interval, ending by count OR until-date.
// value = { freq, interval, endMode:'count'|'until', count, until }; onChange(next).
const box = { padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: 'var(--ink)', outline: 'none' }
const UNIT = { daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)' }

export default function RecurrenceFields({ value, onChange }) {
  const r = value || {}
  const freq = r.freq || 'none'
  const endMode = r.endMode || 'count'
  const set = (patch) => onChange({ freq, interval: r.interval || 1, endMode, count: r.count ?? 8, until: r.until ?? '', ...patch })

  return (
    <div>
      <select value={freq} onChange={(e) => set({ freq: e.target.value })} style={{ ...box, cursor: 'pointer', width: '100%', boxSizing: 'border-box' }}>
        <option value="none">Does not repeat</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly</option>
        <option value="monthly">Monthly</option>
      </select>
      {freq !== 'none' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5, color: 'var(--ink-soft)' }}>
          <span>every</span>
          <input type="number" min={1} value={r.interval || 1} onChange={(e) => set({ interval: Math.max(1, Number(e.target.value) || 1) })} style={{ ...box, width: 60 }} />
          <span>{UNIT[freq]}</span>
          <select value={endMode} onChange={(e) => set({ endMode: e.target.value })} style={{ ...box, cursor: 'pointer' }}>
            <option value="count">for</option>
            <option value="until">until</option>
          </select>
          {endMode === 'count' ? (
            <>
              <input type="number" min={1} max={60} value={r.count ?? 8} onChange={(e) => set({ count: Math.max(1, Math.min(60, Number(e.target.value) || 1)) })} style={{ ...box, width: 60 }} />
              <span>times</span>
            </>
          ) : (
            <input type="date" value={r.until || ''} onChange={(e) => set({ until: e.target.value })} style={box} />
          )}
        </div>
      )}
    </div>
  )
}

// Normalise the UI value into a generateOccurrences() rule.
export function toRule(value) {
  const r = value || {}
  if (!r.freq || r.freq === 'none') return { freq: 'none' }
  return {
    freq: r.freq,
    interval: r.interval || 1,
    count: (r.endMode || 'count') === 'count' ? (r.count || 1) : null,
    until: (r.endMode || 'count') === 'until' ? (r.until || null) : null,
  }
}
