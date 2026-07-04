// The ONE shared side panel. Pinned to the right, full-height, always in view,
// scrolls internally. Backdrop click closes. Content is passed as children, so
// every screen (person profiles, interest submissions, nurturer circles) uses
// the same container and behaviour.
export default function SidePanel({ onClose, width = 560, children }) {
  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.35)', display: 'flex', justifyContent: 'flex-end', zIndex: 110 }}
      onClick={onClose}
    >
      <div
        className="scrollarea"
        style={{ width, maxWidth: '100%', height: '100%', background: 'var(--bg)', overflowY: 'auto', boxShadow: 'var(--shadow-lg)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}

// Sticky panel header with a close affordance — used inside SidePanel.
export function PanelHeader({ onClose, children }) {
  return (
    <div style={{ padding: '20px 26px', borderBottom: '1px solid var(--border)', background: 'var(--panel)', position: 'sticky', top: 0, zIndex: 2 }}>
      <div onClick={onClose} style={{ fontSize: 13, fontWeight: 600, color: 'var(--orange)', cursor: 'pointer', marginBottom: 12 }}>✕ Close</div>
      {children}
    </div>
  )
}
