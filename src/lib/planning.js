// Helpers for the volunteer-planning workflow (Planning page only).

// Inclusive list of YYYY-MM-DD day strings between start and end (string math,
// so no timezone drift).
export function eventDays(start, end) {
  if (!start) return []
  const e = end || start
  const out = []
  let d = start
  let guard = 0
  while (d <= e && guard < 366) {
    out.push(d)
    const [y, m, dd] = d.split('-').map(Number)
    d = new Date(Date.UTC(y, m - 1, dd + 1)).toISOString().slice(0, 10)
    guard++
  }
  return out
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10)
}

// Auto stage from the event's date span (used unless a manual override exists).
export function deriveStage(startDate, endDate, t = todayISO()) {
  const s = startDate || endDate
  const e = endDate || startDate
  if (!s) return 'Planning'
  if (e < t) return 'Done'
  if (s <= t && t <= e) return 'Ongoing'
  return 'Planning'
}

// effective stage = manual override if set, else date-derived.
export function effectiveStage(ev, stageRow) {
  if (stageRow && stageRow.manual && stageRow.stage) return stageRow.stage
  return deriveStage(ev.start_date, ev.end_date)
}

export const STAGES = ['Planning', 'Ongoing', 'Done']
export const STAGE_TONE = {
  Planning: { bg: '#FBEAD9', fg: '#C28A2A' },
  Ongoing: { bg: '#F6E8D8', fg: '#C2691F' },
  Done: { bg: '#EAF2E5', fg: '#4E7C3F' },
}

// fill for a (block, day): people still expected or present (assigned|show).
// no_show / dropped VACATE the slot (excluded here) but are kept for reliability.
export function fillCount(assignments, day) {
  return assignments.filter((a) => a.day_date === day && (a.status === 'assigned' || a.status === 'show')).length
}

export const fmtDay = (d) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : 'TBD'

export const fmtDayShort = (d) =>
  d ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''

// Add N freq-units to a YYYY-MM-DD (string math, UTC).
function addInterval(iso, freq, n) {
  const [y, m, d] = iso.split('-').map(Number)
  if (freq === 'daily') return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
  if (freq === 'weekly') return new Date(Date.UTC(y, m - 1, d + 7 * n)).toISOString().slice(0, 10)
  if (freq === 'monthly') return new Date(Date.UTC(y, m - 1 + n, d)).toISOString().slice(0, 10)
  return iso
}

// Add N calendar days to a YYYY-MM-DD.
export function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

// Occurrence START dates from a recurrence rule (Google-Calendar-style: freq +
// interval, ending by count OR until-date). maxN caps runaway generation.
// { freq:'none'|'daily'|'weekly'|'monthly', interval, count?, until? }
export function generateOccurrences(startISO, rule = {}, maxN = 60) {
  const { freq = 'none', interval = 1, count = null, until = null } = rule
  if (!freq || freq === 'none') return [startISO]
  const step = Math.max(1, Number(interval) || 1)
  const out = []
  let d = startISO
  while (out.length < maxN) {
    out.push(d)
    if (count && out.length >= Number(count)) break
    d = addInterval(d, freq, step)
    if (until && d > until) break
    if (!count && !until) break // guard: no end condition → single
  }
  return out
}

// Human summary of a rule, for the create form + badges.
export function recurrenceLabel(rule) {
  if (!rule || rule.freq === 'none' || !rule.freq) return ''
  const every = Number(rule.interval) > 1 ? `every ${rule.interval} ` : ''
  const unit = { daily: 'day', weekly: 'week', monthly: 'month' }[rule.freq] || rule.freq
  const end = rule.count ? ` · ${rule.count}×` : rule.until ? ` · until ${rule.until}` : ''
  return `Repeats ${every}${unit}${Number(rule.interval) > 1 ? 's' : ''}${end}`
}

// Date-range label for an event.
export function rangeLabel(start, end) {
  if (!start) return 'TBD'
  if (!end || end === start) return fmtDay(start)
  return `${fmtDay(start)} – ${fmtDay(end)}`
}
