import { pill } from './ui'

// Messaging-campaign recipient state — parallel to calllog.js's call-outcome
// vocabulary, but for journeys.message_status (no call ever happens). Colors match
// the equivalent concepts elsewhere (EventInterestPanel's Interested/Contacted/
// Approved pills) so "grey → amber → green" reads the same across the app.
export const MESSAGE_STATUS = [
  { v: 'to_message', label: 'To message', pill: pill('var(--neutral-bg)', 'var(--neutral-fg)') },
  { v: 'sent', label: 'Sent', pill: pill('var(--pill-yellow-bg)', 'var(--pill-yellow-fg)') },
  { v: 'no_whatsapp', label: 'No WhatsApp', pill: pill('var(--pill-warm-bg)', 'var(--pill-orange-fg)') },
  { v: 'responded', label: 'Responded', pill: pill('var(--success-bg)', 'var(--success-fg)') },
]
export const MESSAGE_STATUS_MAP = Object.fromEntries(MESSAGE_STATUS.map((s) => [s.v, s]))
export const pillForMessage = (status) => MESSAGE_STATUS_MAP[status]?.pill || MESSAGE_STATUS_MAP.to_message.pill
export const labelForMessage = (status) => MESSAGE_STATUS_MAP[status]?.label || 'To message'
