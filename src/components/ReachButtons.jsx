import { telHref, smsHref, waHref, hasDialable } from '../lib/phone'
import { useBreakpoint } from '../lib/useBreakpoint'

// One-way deep-link buttons: Call (tel:), Message (sms: with optional prefilled
// body), WhatsApp (wa.me with optional prefilled text). A tap never changes status.
// onArm (Call only) arms the return-prompt in the caller workspace.
// No dialable phone -> buttons render disabled ("no phone on record").
// messaging=true (messaging campaigns) drops the Call button — outreach is message-only.
// These are the core action of the calling workflow (not overflow-menu candidates),
// so on mobile they stay inline but grow to a real 44px tap target.
// compact=true: fixed 36px/14px sizing, each button flex:1 (equal width) inside
// the caller's own flex row — used by the campaign call-list card.
export default function ReachButtons({ phone, smsText, waText, onArm, messaging = false, compact = false }) {
  const { isPhone } = useBreakpoint()
  const base = compact
    ? { fontSize: 14, fontWeight: 600, borderRadius: 8, border: '1px solid var(--border)', textDecoration: 'none', whiteSpace: 'nowrap', height: 36, flex: 1, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }
    : {
        padding: isPhone ? '10px 12px' : '6px 10px',
        fontSize: 12,
        fontWeight: 600,
        borderRadius: 8,
        border: '1px solid var(--border)',
        textDecoration: 'none',
        whiteSpace: 'nowrap',
        minHeight: isPhone ? 44 : undefined,
        display: 'inline-flex',
        alignItems: 'center',
      }
  const labels = messaging ? ['Message', 'WhatsApp'] : ['Call', 'Message', 'WhatsApp']
  // display:contents when compact — so these render as direct flex items of the
  // caller's own row (equal-width alongside Log/···) instead of a nested group.
  const wrapStyle = compact ? { display: 'contents' } : { display: 'flex', gap: 6 }
  if (!hasDialable(phone)) {
    return (
      <div style={wrapStyle} title="no phone on record">
        {labels.map((l) => (
          <span key={l} style={{ ...base, color: 'var(--muted-2)', background: '#F7F1E7', cursor: 'not-allowed', userSelect: 'none' }}>{l}</span>
        ))}
      </div>
    )
  }
  const link = { ...base, color: 'var(--ink-soft)', background: '#fff' }
  return (
    <div style={wrapStyle}>
      {!messaging && <a href={telHref(phone)} onClick={onArm} style={link}>Call</a>}
      <a href={smsHref(phone, smsText)} style={link}>Message</a>
      <a href={waHref(phone, waText)} target="_blank" rel="noopener noreferrer" style={link}>WhatsApp</a>
    </div>
  )
}
