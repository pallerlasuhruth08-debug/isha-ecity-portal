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
