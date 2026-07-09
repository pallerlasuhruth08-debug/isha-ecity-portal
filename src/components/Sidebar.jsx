import { Icon } from '../lib/icons'
import { TAB_LABELS } from '../lib/roles'

// Exact sidebar order. This array drives the visible order (tabs only filters
// visibility). 'events' (standalone Attendance) is gone — attendance lives per-event
// in the Event Hub now.
const NAV = [
  { key: 'dashboard', icon: 'dashboard' },
  { key: 'hub', icon: 'hub' },
  { key: 'volunteers', icon: 'volunteers' },
  { key: 'meditators', icon: 'meditators' },
  { key: 'campaigns', icon: 'campaigns' },
  { key: 'interest', icon: 'interest' },
  { key: 'nurturing', icon: 'nurturing' },
  { key: 'advance', icon: 'advance' },
  { key: 'unresolved', icon: 'unresolved' },
  { key: 'admin', icon: 'admin' },
]

// variant 'rail' (default): the pinned in-flow sidebar (desktop full width,
// tablet icon rail via the .app-sidebar media rule).
// variant 'drawer': off-canvas overlay used below the phone breakpoint —
// slides in from the left, backdrop closes, navigating closes it.
export default function Sidebar({ me, view, tabs, onNavigate, variant = 'rail', open = false, onClose }) {
  const isDrawer = variant === 'drawer'

  const asideStyle = isDrawer
    ? {
        position: 'fixed',
        top: 0,
        left: 0,
        bottom: 0,
        width: 256,
        maxWidth: '82%',
        background: 'var(--sb-bg)',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 16px',
        overflowY: 'auto',
        zIndex: 131,
        transform: open ? 'translateX(0)' : 'translateX(-100%)',
        transition: 'transform 0.24s ease',
        boxShadow: open ? '0 0 40px rgba(0,0,0,0.4)' : 'none',
      }
    : {
        width: 252,
        flexShrink: 0,
        background: 'var(--sb-bg)',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 16px',
        overflowY: 'auto',
      }

  const go = (key) => {
    onNavigate(key)
    if (isDrawer && onClose) onClose()
  }

  const aside = (
    <aside className={(isDrawer ? 'app-drawer' : 'app-sidebar') + ' scrollarea'} style={asideStyle}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '6px 6px 22px' }}>
        <div
          style={{
            width: 40,
            height: 40,
            borderRadius: 12,
            background: 'linear-gradient(150deg,#E79248,#B0541A)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
            boxShadow: '0 4px 12px rgba(176,84,26,0.35)',
            color: '#FBEFDF',
          }}
        >
          {Icon.leaf(22)}
        </div>
        <div className="sidebar-brand-text">
          <div
            style={{
              fontFamily: "'Newsreader',serif",
              fontSize: 18,
              fontWeight: 600,
              color: '#F5EBDB',
              lineHeight: 1.05,
            }}
          >
            Electronic City
          </div>
          <div
            style={{
              fontSize: 11,
              color: '#A28C71',
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              marginTop: 2,
            }}
          >
            Volunteer Care
          </div>
        </div>
      </div>

      <div
        className="sidebar-section-h"
        style={{
          fontSize: 10.5,
          letterSpacing: '.12em',
          textTransform: 'uppercase',
          color: '#7C6A52',
          padding: '4px 8px 8px',
          fontWeight: 600,
        }}
      >
        Coordinate
      </div>

      {NAV.filter((n) => tabs.includes(n.key)).map((n) => (
        <button
          key={n.key}
          className={'navitem' + (view === n.key ? ' active' : '')}
          onClick={() => go(n.key)}
        >
          {Icon[n.icon](18)}
          <span className="sidebar-label">{TAB_LABELS[n.key]}</span>
        </button>
      ))}

    </aside>
  )

  if (!isDrawer) return aside

  return (
    <>
      <div
        onClick={onClose}
        style={{
          position: 'fixed',
          inset: 0,
          background: 'rgba(20,12,6,0.5)',
          zIndex: 130,
          opacity: open ? 1 : 0,
          pointerEvents: open ? 'auto' : 'none',
          transition: 'opacity 0.24s ease',
        }}
      />
      {aside}
    </>
  )
}
