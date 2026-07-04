import { telHref, smsHref, waHref, hasDialable } from '../lib/phone'

// One-way deep-link buttons: Call (tel:), Message (sms: with optional prefilled
// body), WhatsApp (wa.me with optional prefilled text). A tap never changes status.
// onArm (Call only) arms the return-prompt in the caller workspace.
// No dialable phone -> all three render disabled ("no phone on record").
export default function ReachButtons({ phone, smsText, waText, onArm }) {
  const base = {
    padding: '6px 10px',
    fontSize: 12,
    fontWeight: 600,
    borderRadius: 8,
    border: '1px solid var(--border)',
    textDecoration: 'none',
    whiteSpace: 'nowrap',
  }
  if (!hasDialable(phone)) {
    return (
      <div style={{ display: 'flex', gap: 6 }} title="no phone on record">
        {['Call', 'Message', 'WhatsApp'].map((l) => (
          <span key={l} style={{ ...base, color: 'var(--muted-2)', background: '#F7F1E7', cursor: 'not-allowed', userSelect: 'none' }}>{l}</span>
        ))}
      </div>
    )
  }
  const link = { ...base, color: 'var(--ink-soft)', background: '#fff' }
  return (
    <div style={{ display: 'flex', gap: 6 }}>
      <a href={telHref(phone)} onClick={onArm} style={link}>Call</a>
      <a href={smsHref(phone, smsText)} style={link}>Message</a>
      <a href={waHref(phone, waText)} target="_blank" rel="noopener noreferrer" style={link}>WhatsApp</a>
    </div>
  )
}
