import { pill } from './ui'

// Messaging-campaign recipient state — parallel to calllog.js's call-outcome
// vocabulary, but for journeys.message_status (no call ever happens). Colors match
// the equivalent concepts elsewhere (EventInterestPanel's Interested/Contacted/
// Approved pills) so "grey → amber → green" reads the same across the app.
export const MESSAGE_STATUS = [
  { v: 'to_message', label: 'To message', pill: pill('#F1EADD', '#8C7E6B') },
  { v: 'sent', label: 'Sent', pill: pill('#FCF4CB', '#8A6D1B') },
  { v: 'responded', label: 'Responded', pill: pill('#EAF2E5', '#4E7C3F') },
]
export const MESSAGE_STATUS_MAP = Object.fromEntries(MESSAGE_STATUS.map((s) => [s.v, s]))
export const pillForMessage = (status) => MESSAGE_STATUS_MAP[status]?.pill || MESSAGE_STATUS_MAP.to_message.pill
export const labelForMessage = (status) => MESSAGE_STATUS_MAP[status]?.label || 'To message'
