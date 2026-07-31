import { pill } from './ui'

// Design-defined vocabulary (Volunteer Care Portal.dc.html). The actor picks an
// OUTCOME; the row STATUS is derived from the latest log. Shared by CallerWorkspace
// and Campaigns so caller work and coordinator oversight always agree.
export const LOG_OUTCOMES = ['Enrolled', 'Interested', 'Call back later', 'No answer', 'Not now']
export const DEFAULT_OUTCOME = 'Interested'

export const OUTCOME_TO_STATUS = {
  Enrolled: 'Enrolled',
  Interested: 'Replied',
  'Call back later': 'Call back',
  'No answer': 'Attempted',
  'Not now': 'Not now',
}

export const STATUS_PILL = {
  'To call': pill('var(--neutral-bg)', 'var(--neutral-fg)'),
  Attempted: pill('var(--neutral-bg)', 'var(--neutral-fg)'),
  'Call back': pill('var(--pill-orange-bg)', 'var(--pill-orange-fg)'),
  Replied: pill('var(--info-bg)', 'var(--info-fg)'),
  Enrolled: pill('var(--success-bg)', 'var(--success-fg)'),
  'Not now': pill('var(--danger-bg)', 'var(--danger-fg)'),
}

export const STATUS_ORDER = { 'To call': 0, 'Call back': 1, Attempted: 2, Replied: 3, Enrolled: 4, 'Not now': 5 }

// logs must be newest-first.
export function statusOf(logs) {
  if (!logs || !logs.length) return 'To call'
  const latest = logs[0]
  return OUTCOME_TO_STATUS[latest.reachability] || latest.reachability || 'To call'
}
export const pillFor = (status) => STATUS_PILL[status] || STATUS_PILL['To call']
export const pillForOutcome = (outcome) => STATUS_PILL[OUTCOME_TO_STATUS[outcome]] || STATUS_PILL['To call']

export const fmtWhen = (iso) => {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })
  } catch {
    return iso
  }
}

// ── The other two vocabularies that write to this same column ────────────────
//
// `call_logs.reachability` is written from four places, and until now each one
// declared its own words inline:
//
//   campaign calling   Enrolled · Interested · Call back later · No answer · Not now
//   nurturing          Reached · No answer · Call back · Doing well · Needs support
//   person profile     answered · will_call_back · not_reachable   (snake_case!)
//   interest inbox     always "answered", with no way to say otherwise
//
// The first two are genuinely different conversations — a campaign call asks
// "did they enrol?", a nurturing call asks "how are they?" — so they stay
// separate. What was wrong is that they were separate *and undeclared*, so a
// person's profile rendered a mix of "Interested", "Doing well" and a raw
// lowercase "answered" in the same history list, and any outcome outside
// STATUS_PILL fell through to unstyled text.
//
// Now: both lists live here, and `labelForOutcome` / `pillForAnyOutcome`
// humanise ANY value ever written to the column, including the legacy
// snake_case rows that already exist in the database.

export const NURTURE_OUTCOMES = ['Reached', 'No answer', 'Call back', 'Doing well', 'Needs support']
export const DEFAULT_NURTURE_OUTCOME = 'Reached'

// Historical values still present in call_logs, mapped to the words used today.
const LEGACY_OUTCOME = {
  answered: 'Reached',
  will_call_back: 'Call back',
  not_reachable: 'No answer',
}

const OUTCOME_PILL = {
  Enrolled: STATUS_PILL.Enrolled,
  Interested: STATUS_PILL.Replied,
  'Call back later': STATUS_PILL['Call back'],
  'Call back': STATUS_PILL['Call back'],
  'No answer': STATUS_PILL.Attempted,
  'Not now': STATUS_PILL['Not now'],
  Reached: STATUS_PILL.Replied,
  'Doing well': STATUS_PILL.Enrolled,
  'Needs support': STATUS_PILL['Call back'],
}

/** Any value ever written to reachability → the words a coordinator should read. */
export function labelForOutcome(v) {
  if (!v) return '—'
  return LEGACY_OUTCOME[v] || v
}

/** Any value ever written to reachability → a styled pill, never bare text. */
export function pillForAnyOutcome(v) {
  return OUTCOME_PILL[labelForOutcome(v)] || STATUS_PILL['To call']
}
