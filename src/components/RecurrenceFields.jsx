import { monthlyOptions } from '../lib/planning'

// Shared "Repeats" controls for the create-event form.
// Google-Calendar-style: freq + interval, ending by count OR until-date, and —
// for monthly — a choice between "on day N" and "on the Nth weekday", both
// derived from the chosen start date.
// value = { freq, interval, endMode:'count'|'until'|'never', count, until, monthlyMode }
const box = { padding: '9px 10px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: 'var(--ink)', outline: 'none' }
const UNIT = { daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)' }

export default function RecurrenceFields({ value, onChange, startDate }) {
  const r = value || {}
  const freq = r.freq || 'none'
  const endMode = r.endMode || 'count'
  const monthlyMode = r.monthlyMode || 'date'
  const set = (patch) => onChange({ freq, interval: r.interval || 1, endMode, count: r.count ?? 8, until: r.until ?? '', monthlyMode, ...patch })

  const monthChoices = freq === 'monthly' ? monthlyOptions(startDate) : []

  return (
    <div>
      <select value={freq} onChange={(e) => set({ freq: e.target.value })} style={{ ...box, cursor: 'pointer', width: '100%', boxSizing: 'border-box' }}>
        <option value="none">Does not repeat</option>
        <option value="daily">Daily</option>
        <option value="weekly">Weekly{startDate ? ` (every ${WEEKDAY_LONG[weekdayIdx(startDate)]})` : ''}</option>
        <option value="monthly">Monthly</option>
      </select>

      {freq === 'monthly' && startDate && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 8 }}>
          {monthChoices.map((c) => (
            <label key={c.mode} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)', cursor: 'pointer' }}>
              <input type="radio" name="monthlyMode" checked={monthlyMode === c.mode} onChange={() => set({ monthlyMode: c.mode })} />
              {c.label}
            </label>
          ))}
        </div>
      )}

      {freq !== 'none' && (
        <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 12.5, color: 'var(--ink-soft)' }}>
          <span>every</span>
          <input type="number" min={1} value={r.interval || 1} onChange={(e) => set({ interval: Math.max(1, Number(e.target.value) || 1) })} style={{ ...box, width: 60 }} />
          <span>{UNIT[freq]}</span>
          <select value={endMode} onChange={(e) => set({ endMode: e.target.value })} style={{ ...box, cursor: 'pointer' }}>
            <option value="count">for</option>
            <option value="until">until</option>
            <option value="never">open-ended</option>
          </select>
          {endMode === 'count' && (
            <>
              <input type="number" min={1} max={200} value={r.count ?? 8} onChange={(e) => set({ count: Math.max(1, Math.min(200, Number(e.target.value) || 1)) })} style={{ ...box, width: 64 }} />
              <span>times</span>
            </>
          )}
          {endMode === 'until' && <input type="date" value={r.until || ''} onChange={(e) => set({ until: e.target.value })} style={box} />}
          {endMode === 'never' && <span style={{ color: 'var(--muted-2)' }}>(no end)</span>}
        </div>
      )}
    </div>
  )
}

const WEEKDAY_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
function weekdayIdx(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

// Normalise the UI value into a rule. endMode 'never' = open-ended (no count/until).
// For monthly-weekday, carry the weekday anchor derived from the start date.
export function toRule(value, startDate) {
  const r = value || {}
  if (!r.freq || r.freq === 'none') return { freq: 'none' }
  const endMode = r.endMode || 'count'
  const rule = {
    freq: r.freq,
    interval: r.interval || 1,
    count: endMode === 'count' ? (r.count || 1) : null,
    until: endMode === 'until' ? (r.until || null) : null,
  }
  if (r.freq === 'monthly') {
    const mode = r.monthlyMode || 'date'
    rule.monthly_mode = mode
    if (mode === 'weekday' && startDate) {
      const opt = monthlyOptions(startDate).find((o) => o.mode === 'weekday')
      if (opt) { rule.month_week = opt.week; rule.month_weekday = opt.weekday }
    }
  }
  return rule
}
