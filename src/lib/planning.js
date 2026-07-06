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

// Coarse date-derived status — only a FALLBACK now, for events that have no
// phases (e.g. old past events not backfilled). The lifecycle is the phase model.
export function deriveStage(startDate, endDate, t = todayISO()) {
  const s = startDate || endDate
  const e = endDate || startDate
  if (!s) return 'Upcoming'
  if (e < t) return 'Done'
  if (s <= t && t <= e) return 'Day-of'
  return 'Upcoming'
}

// ── Phase model (replaces the old 3-stage event_stages) ───────────────────────
export const PHASE_ORDER = ['pre_far', 'pre_near', 'day_of', 'post']
export const PHASE_SHORT = { pre_far: 'Pre-far', pre_near: 'Pre-near', day_of: 'Day-of', post: 'Post' }
export const PHASE_TONE = {
  pre_far: { bg: '#FBEAD9', fg: '#C28A2A' },
  pre_near: { bg: '#F6E8D8', fg: '#C2691F' },
  day_of: { bg: '#EAF2E5', fg: '#4E7C3F' },
  post: { bg: '#E9F0EF', fg: '#2F6E5E' },
  Done: { bg: '#F1EADD', fg: '#8C7E6B' },
  Upcoming: { bg: '#FBEAD9', fg: '#C28A2A' },
}
export const phaseTone = (kind) => PHASE_TONE[kind] || PHASE_TONE.Upcoming

// Group flat event_phases rows into { activity_id: phases[] } for the list/grid.
export function groupPhases(rows) {
  const map = {}
  for (const r of rows || []) (map[r.activity_id] ||= []).push(r)
  return map
}

// ── Attendance mode (a property of the BLOCK; event/phase only seed a default) ──
export const ATTENDANCE_MODES = ['per_day', 'span', 'involved_only']
export const MODE_LABEL = { per_day: 'Per-day', span: 'Span (once)', involved_only: 'Involved only' }
export const MODE_HINT = {
  per_day: 'Daily show / no-show — feeds reliability',
  span: 'One presence mark for the whole block — feeds reliability',
  involved_only: 'Participation credit only — no presence, no reliability',
}
// Inherited default at block creation: phase default → event default → per_day.
// (Resolved ONCE here; the block’s own value governs from then on.)
export function inheritedMode(phase, event) {
  return phase?.default_attendance_mode || event?.default_attendance_mode || 'per_day'
}
// Read-only summary for a phase/event level: "defaults to X · N overridden".
export function modeSummary(defaultMode, blocks) {
  const dm = defaultMode || 'per_day'
  const overridden = (blocks || []).filter((b) => (b.attendance_mode || 'per_day') !== dm).length
  return `defaults to ${MODE_LABEL[dm]}${overridden ? ` · ${overridden} block${overridden > 1 ? 's' : ''} overridden` : ''}`
}

// ── Stage-2 in-app flags (computed on load; status indicators, not alerts) ────
export const FLAG_META = {
  overdue: { label: 'Overdue', bg: '#FBE0DA', fg: '#B5391F' },
  at_risk: { label: 'At risk', bg: '#FBEAD9', fg: '#C2691F' },
}
const NEAR_DAYS = 2 // "near finish_by" window for AT-RISK

// A phase's flag, or null. OVERDUE = past start_by and never started.
// AT-RISK = started, still incomplete, and finish_by is near or past.
export function phaseFlag(p, t = todayISO()) {
  if (!p || p.completed_at) return null
  if (!p.started_at) return p.start_by && p.start_by < t ? 'overdue' : null
  if (p.finish_by && addDaysISO(t, NEAR_DAYS) >= p.finish_by) return 'at_risk'
  return null
}

// Total unfilled slots across a phase's blocks over its window days
// (needed − filled, floored at 0 per block-day). Shortfall + a flag = urgent.
export function phaseShortfall(days, blocks, assignments) {
  let short = 0
  for (const b of blocks || []) {
    const need = Number(b.volunteers_needed) || 0
    const bAsg = (assignments || []).filter((a) => a.block_id === b.id)
    for (const d of days || []) short += Math.max(0, need - fillCount(bAsg, d))
  }
  return short
}

// Every flagged phase across a set of events, worst (overdue) first — powers the
// global Planning "needs attention" panel.
export function flaggedPhases(events, phasesByEvent, t = todayISO()) {
  const out = []
  for (const e of events || []) {
    for (const p of phasesByEvent[e.id] || []) {
      const flag = phaseFlag(p, t)
      if (flag) out.push({ event: e, phase: p, flag })
    }
  }
  return out.sort((a, b) => (a.flag === 'overdue' ? 0 : 1) - (b.flag === 'overdue' ? 0 : 1))
}

// The event's headline phase for the coarse pill: the window we're inside, else
// "Upcoming" (before the first) / "Done" (after the last). Falls back to the
// date-derived stage when the event has no phases at all.
export function currentPhase(ev, phases, t = todayISO()) {
  const list = (phases || []).slice().sort((a, b) => a.sort_order - b.sort_order)
  if (!list.length) return { label: deriveStage(ev?.start_date, ev?.end_date, t), kind: 'Upcoming' }
  const last = list[list.length - 1]
  if (last.finish_by && t > last.finish_by) return { label: 'Done', kind: 'Done' }
  const inWin = list.find((p) => (!p.start_by || p.start_by <= t) && (!p.finish_by || t <= p.finish_by))
  if (inWin) return { label: PHASE_SHORT[inWin.kind] || inWin.label, kind: inWin.kind }
  const next = list.find((p) => p.start_by && p.start_by > t)
  if (next) return { label: 'Upcoming', kind: 'Upcoming' }
  return { label: PHASE_SHORT[list[0].kind] || list[0].label, kind: list[0].kind }
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

// Add N freq-units to a YYYY-MM-DD (string math, UTC). Monthly clamps to the
// month's last day (e.g. the 31st in Feb → Feb 28/29) rather than overflowing.
function addInterval(iso, freq, n) {
  const [y, m, d] = iso.split('-').map(Number)
  if (freq === 'daily') return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
  if (freq === 'weekly') return new Date(Date.UTC(y, m - 1, d + 7 * n)).toISOString().slice(0, 10)
  if (freq === 'monthly') {
    const dim = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate() // days in target month
    return new Date(Date.UTC(y, m - 1 + n, Math.min(d, dim))).toISOString().slice(0, 10)
  }
  return iso
}

const WEEKDAY_NAME = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ORDINAL = { 1: 'first', 2: 'second', 3: 'third', 4: 'fourth', [-1]: 'last' }

// Weekday of a YYYY-MM-DD, 0=Sun..6=Sat (UTC, no tz drift).
export function weekdayOfISO(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

// Which occurrence-of-its-weekday a date is within its month: 1..4, or -1 when it
// is the LAST such weekday of the month (no fifth of that weekday follows).
export function weekOfMonthISO(iso) {
  const [y, m, d] = iso.split('-').map(Number)
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate()
  return d + 7 > dim ? -1 : Math.floor((d - 1) / 7) + 1
}

// The date of the Nth `weekday` in a month. week: 1..4 or -1 (last). Returns an
// ISO date, or null when that occurrence doesn't exist (e.g. a 5th Sunday).
export function nthWeekdayOfMonth(year, monthIdx, weekday, week) {
  if (week === -1) {
    const last = new Date(Date.UTC(year, monthIdx + 1, 0))
    const day = last.getUTCDate() - ((last.getUTCDay() - weekday + 7) % 7)
    return new Date(Date.UTC(year, monthIdx, day)).toISOString().slice(0, 10)
  }
  const firstDow = new Date(Date.UTC(year, monthIdx, 1)).getUTCDay()
  const day = 1 + ((weekday - firstDow + 7) % 7) + (week - 1) * 7
  const dim = new Date(Date.UTC(year, monthIdx + 1, 0)).getUTCDate()
  if (day > dim) return null
  return new Date(Date.UTC(year, monthIdx, day)).toISOString().slice(0, 10)
}

// The two monthly choices offered for a chosen start date, Google-Calendar style:
// (a) same date each month, (b) same weekday-of-month. Values feed toRule().
export function monthlyOptions(startISO) {
  if (!startISO) return []
  const [, , d] = startISO.split('-').map(Number)
  const wd = weekdayOfISO(startISO)
  const wk = weekOfMonthISO(startISO)
  return [
    { mode: 'date', label: `Monthly on day ${d}` },
    { mode: 'weekday', week: wk, weekday: wd, label: `Monthly on the ${ORDINAL[wk]} ${WEEKDAY_NAME[wd]}` },
  ]
}

// Add N calendar days to a YYYY-MM-DD.
export function addDaysISO(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10)
}

// Monthly weekday-of-month stepper (e.g. "first Sunday" / "last Saturday").
// Walks whole months by interval, snapping to the Nth weekday; months missing
// that occurrence (a rare 5th weekday) are skipped without consuming a count.
function stepMonthlyWeekday(startISO, rule, { count, capISO, maxN }) {
  const step = Math.max(1, Number(rule.interval) || 1)
  const wd = rule.month_weekday
  const wk = rule.month_week ?? weekOfMonthISO(startISO)
  const [sy, sm] = startISO.split('-').map(Number)
  const out = []
  for (let k = 0; k < 620 && out.length < maxN; k++) {
    const anchor = new Date(Date.UTC(sy, sm - 1 + step * k, 1))
    const d = nthWeekdayOfMonth(anchor.getUTCFullYear(), anchor.getUTCMonth(), wd, wk)
    if (d && capISO && d > capISO) break
    if (d && d >= startISO) {
      out.push(d)
      if (count && out.length >= count) break
    }
    if (!count && !capISO) break // degenerate: open-ended with no cap → just first
  }
  return out
}

// Monthly-by-date stepper. Anchors every occurrence to the ORIGINAL start day so
// day 29–31 series don't drift (Jan 31 → Feb 28 → Mar 31, not → Mar 28); each
// month clamps to its own length.
function stepMonthlyDate(startISO, step, { count, capISO, maxN }) {
  const [sy, sm, sd] = startISO.split('-').map(Number)
  const out = []
  for (let k = 0; out.length < maxN; k++) {
    const targetM = sm - 1 + step * k
    const dim = new Date(Date.UTC(sy, targetM + 1, 0)).getUTCDate()
    const d = new Date(Date.UTC(sy, targetM, Math.min(sd, dim))).toISOString().slice(0, 10)
    if (capISO && d > capISO) break
    out.push(d)
    if (count && out.length >= count) break
    if (!count && !capISO) break
  }
  return out
}

// Daily / weekly stepper (weekly naturally lands on the start-date weekday).
function stepInterval(startISO, freq, step, { count, capISO, maxN }) {
  const out = []
  let d = startISO
  while (out.length < maxN) {
    out.push(d)
    if (count && out.length >= count) break
    d = addInterval(d, freq, step)
    if (capISO && d > capISO) break
    if (!count && !capISO) break // guard: no end condition → single
  }
  return out
}

// Core occurrence generator, honouring monthly_mode ('date' vs 'weekday').
function occurrences(startISO, rule, opts = {}) {
  const freq = rule.freq
  if (!startISO || !freq || freq === 'none') return startISO ? [startISO] : []
  const step = Math.max(1, Number(rule.interval) || 1)
  const o = { count: opts.count ?? null, capISO: opts.capISO ?? null, maxN: opts.maxN ?? 500 }
  if (freq === 'monthly' && rule.monthly_mode === 'weekday' && rule.month_weekday != null) {
    return stepMonthlyWeekday(startISO, rule, o)
  }
  if (freq === 'monthly') return stepMonthlyDate(startISO, step, o)
  return stepInterval(startISO, freq, step, o)
}

// Occurrence START dates from a recurrence rule (Google-Calendar-style: freq +
// interval, ending by count OR until-date). maxN caps runaway generation.
// rule: { freq, interval, count?, until?, monthly_mode?, month_week?, month_weekday? }
export function generateOccurrences(startISO, rule = {}, maxN = 60) {
  return occurrences(startISO, rule, { count: rule.count ?? null, capISO: rule.until ?? null, maxN })
}

// Series end_date implied by a rule: explicit until, or the Nth date for a count,
// or null for open-ended.
export function seriesEndDate(startISO, rule) {
  if (rule.until) return rule.until
  if (rule.count) {
    const list = occurrences(startISO, rule, { count: rule.count, maxN: rule.count })
    return list[list.length - 1] || startISO
  }
  return null
}

// All occurrence start-dates of a SERIES from its start_date up to `toISO`,
// bounded by the series end_date (null = open-ended). Used to materialize the
// rolling window and to project future occurrences.
export function seriesDatesUpTo(series, toISO) {
  if (!series?.start_date) return []
  const cap = series.end_date && series.end_date < toISO ? series.end_date : toISO
  return occurrences(series.start_date, series, { capISO: cap, maxN: 500 })
}

// Human summary of a rule, for the create form + badges.
export function recurrenceLabel(rule) {
  if (!rule || rule.freq === 'none' || !rule.freq) return ''
  const every = Number(rule.interval) > 1 ? `every ${rule.interval} ` : ''
  const unit = { daily: 'day', weekly: 'week', monthly: 'month' }[rule.freq] || rule.freq
  const plural = Number(rule.interval) > 1 ? 's' : ''
  const onThe = rule.freq === 'monthly' && rule.monthly_mode === 'weekday' && rule.month_weekday != null
    ? ` on the ${ORDINAL[rule.month_week ?? 1]} ${WEEKDAY_NAME[rule.month_weekday]}`
    : ''
  const end = rule.count ? ` · ${rule.count}×` : rule.until ? ` · until ${rule.until}` : ''
  return `Repeats ${every}${unit}${plural}${onThe}${end}`
}

// Date-range label for an event.
export function rangeLabel(start, end) {
  if (!start) return 'TBD'
  if (!end || end === start) return fmtDay(start)
  return `${fmtDay(start)} – ${fmtDay(end)}`
}
