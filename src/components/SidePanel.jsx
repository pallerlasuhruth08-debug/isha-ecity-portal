import { useBreakpoint } from '../lib/useBreakpoint'

// The ONE shared side panel. On desktop/tablet it is pinned to the right,
// full-height, scrolls internally, backdrop click closes. Below the phone
// breakpoint it becomes a FULL-SCREEN overlay sliding over the list (no
// backdrop gap, no rounded inset) with a back control in the header — the
// list underneath is fully covered. Content is passed as children, so every
// screen (person profiles, interest submissions, nurturer circles) uses the
// same container and behaviour.
export default function SidePanel({ onClose, width = 560, children }) {
  const { isPhone } = useBreakpoint()
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: isPhone ? 'var(--bg)' : 'rgba(40,25,15,0.35)',
        display: 'flex',
        justifyContent: 'flex-end',
        zIndex: 110,
      }}
      onClick={isPhone ? undefined : onClose}
    >
      <div
        className="scrollarea"
        style={{
          width: isPhone ? '100%' : width,
          maxWidth: '100%',
          height: '100%',
          background: 'var(--bg)',
          overflowY: 'auto',
          boxShadow: isPhone ? 'none' : 'var(--shadow-lg)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

// Sticky panel header with a close affordance — used inside SidePanel. Below
// the phone breakpoint the affordance reads as a back arrow (returns to the
// list) with a larger tap target; on desktop it stays the "✕ Close" link.
export function PanelHeader({ onClose, children }) {
  const { isPhone } = useBreakpoint()
  return (
    <div style={{ padding: isPhone ? '14px 18px' : '20px 26px', borderBottom: '1px solid var(--border)', background: 'var(--panel)', position: 'sticky', top: 0, zIndex: 2 }}>
      <div
        onClick={onClose}
        style={{ fontSize: isPhone ? 14 : 13, fontWeight: 600, color: 'var(--orange)', cursor: 'pointer', marginBottom: 12, display: 'inline-flex', alignItems: 'center', gap: 6, minHeight: isPhone ? 44 : undefined }}
      >
        {isPhone ? '‹ Back' : '✕ Close'}
      </div>
      {children}
    </div>
  )
}
