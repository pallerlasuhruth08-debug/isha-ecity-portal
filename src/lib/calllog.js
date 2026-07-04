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
  'To call': pill('#F1EADD', '#8C7E6B'),
  Attempted: pill('#EFE6D6', '#8A7B63'),
  'Call back': pill('#F6E8D8', '#C2691F'),
  Replied: pill('#E9F0EF', '#2F6E5E'),
  Enrolled: pill('#EAF2E5', '#4E7C3F'),
  'Not now': pill('#FBE6E0', '#B5532F'),
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
