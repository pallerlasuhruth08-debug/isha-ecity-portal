// Two different facts, told apart.
//
// ── What was wrong ──────────────────────────────────────────────────────────
// The Volunteers list sorted 1,286 people by `last_activity_at` and printed it
// under every row as "Today" / "3 days ago". That column is the SYNC STAMP: 917
// of the 941 non-null values land in a single July import run, 23 more in one
// run this morning. Nobody has spoken to those 23 people today. The most-used
// list in a nurturing app was reporting importer activity as human contact.
//
// The Activity FILTER on the same screen used a different column again —
// `last_active_date` — so the filter and the number printed on the row were not
// the same fact. And `last_active_date` is not contact either: it is the
// upstream Ishangam transaction date. One volunteer has `last_active_date`
// 29 Jul 2026 and a last recorded attendance of 9 May 2025, fourteen months
// apart. PersonProfile already called it "Last Transaction Date" — that name was
// the honest one, and the list screens were the ones renaming it.
//
// Worse, `lt(last_active_date, 90 days ago)` is how "Quiet · 90+ days" was
// built, and SQL `<` drops NULLs. 1,154 of 1,286 volunteers have no value in
// that column at all, so the re-engagement list silently excluded everyone we
// have never engaged with. It returned 50 people and looked finished.
//
// ── What this file defines ──────────────────────────────────────────────────
// ISHA ACTIVITY  — `last_active_date`. Something happened with Isha somewhere:
//                  a registration, a booking, a programme. Real, useful, and
//                  NOT evidence that our centre has been in touch.
// OUR CONTACT    — the only facts this centre owns: a recorded attendance
//                  (`attendance.time_in`) or a logged call (`call_logs.logged_at`).
//                  183 of 1,286 volunteers have either. That number is the
//                  actual state of the relationship, and it belongs on the row.
//
// Both are offered, both are named for what they are, and neither is allowed to
// wear the other's label.

const DAY = 86400000

export const daysAgoISO = (d, today = new Date()) =>
  new Date(today.getTime() - d * DAY).toISOString().slice(0, 10)

export function daysSince(date, today = new Date()) {
  if (!date) return null
  const t = new Date(date).getTime()
  if (Number.isNaN(t)) return null
  return Math.floor((today.getTime() - t) / DAY)
}

// Rounded to whole months past 60 days — "Quiet 14 months" is the decision, not
// "Quiet 421 days", and a coordinator should not have to do the division.
function ago(days) {
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  if (days < 30) return `${days} days ago`
  if (days < 60) return 'last month'
  const months = Math.round(days / 30)
  if (months < 24) return `${months} months ago`
  return `${Math.floor(months / 12)}+ years ago`
}

export const NEVER = 'never'
export const RECENT = 'recent'
export const FADING = 'fading'
export const QUIET = 'quiet'

/**
 * OUR CONTACT for one person, from the facts this centre owns.
 * @param metAt    latest attendance.time_in, or null
 * @param calledAt latest call_logs.logged_at, or null
 * @returns { bucket, days, at, how, label, tone }
 */
export function contactState({ metAt = null, calledAt = null } = {}, today = new Date()) {
  const m = metAt ? new Date(metAt).getTime() : null
  const c = calledAt ? new Date(calledAt).getTime() : null
  const at = m == null && c == null ? null : new Date(Math.max(m ?? -Infinity, c ?? -Infinity))
  if (!at) {
    // Not "—". A person nobody here has ever met or called is the single most
    // actionable row on the screen, so it says so in words.
    return { bucket: NEVER, days: null, at: null, how: null, label: 'Never contacted', tone: 'warn' }
  }
  // A call and a visit on the same day: the visit is the stronger fact, so ties
  // go to "Met".
  const how = m != null && m >= (c ?? -Infinity) ? 'Met' : 'Called'
  const days = daysSince(at, today)
  const bucket = days <= 30 ? RECENT : days <= 90 ? FADING : QUIET
  return { bucket, days, at, how, label: `${how} ${ago(days)}`, tone: bucket === QUIET ? 'warn' : 'ok' }
}

/** ISHA ACTIVITY for one person, from the upstream transaction date. */
export function ishaActivityLabel(lastActiveDate, today = new Date()) {
  const days = daysSince(lastActiveDate, today)
  if (days == null) return 'No Isha activity on record'
  return `Isha activity ${ago(days)}`
}

// The Isha-activity filter. "Quiet" and "None on record" are deliberately
// SEPARATE options: one is "we knew them and they went quiet" (50 people), the
// other is "the column is empty" (1,154 people). Folding the second into the
// first is what made the old list look complete at 50; hiding it is what made
// those 1,154 unreachable. Both are now one click away, and each gets the
// conversation it deserves.
export const ISHA_ACTIVITY_OPTIONS = [
  { v: '30', label: 'Isha activity · last 30 days' },
  { v: '90', label: 'Isha activity · last 90 days' },
  { v: 'quiet', label: 'Isha activity · 90+ days ago' },
  { v: 'none', label: 'No Isha activity on record' },
]

/** Applies an ISHA_ACTIVITY_OPTIONS value to a PostgREST query. */
export function applyIshaActivity(q, value, column = 'last_active_date', today = new Date()) {
  if (value === '30') return q.gte(column, daysAgoISO(30, today))
  if (value === '90') return q.gte(column, daysAgoISO(90, today))
  if (value === 'quiet') return q.lt(column, daysAgoISO(90, today))
  if (value === 'none') return q.is(column, null)
  return q
}

export const CONTACT_OPTIONS = [
  { v: 'met', label: 'We have met or called them' },
  { v: 'never', label: 'Never contacted by us' },
]
