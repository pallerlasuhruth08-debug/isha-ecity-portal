import { Icon } from '../lib/icons'
import { ROLES, TAB_LABELS } from '../lib/roles'
import { initials } from '../lib/ui'

const NAV = [
  { key: 'dashboard', icon: 'dashboard' },
  { key: 'volunteers', icon: 'volunteers' },
  { key: 'planning', icon: 'planning' },
  { key: 'events', icon: 'events' },
  { key: 'nurturing', icon: 'nurturing' },
  { key: 'meditators', icon: 'meditators' },
  { key: 'advance', icon: 'advance' },
  { key: 'interest', icon: 'interest' },
  { key: 'campaigns', icon: 'campaigns' },
]

export default function Sidebar({ role, view, tabs, onNavigate }) {
  const roleDef = ROLES[role]
  return (
    <aside
      className="app-sidebar scrollarea"
      style={{
        width: 252,
        flexShrink: 0,
        background: 'var(--sb-bg)',
        display: 'flex',
        flexDirection: 'column',
        padding: '20px 16px',
        overflowY: 'auto',
      }}
    >
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
            ECT Center
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
          onClick={() => onNavigate(n.key)}
        >
          {Icon[n.icon](18)}
          <span className="sidebar-label">{TAB_LABELS[n.key]}</span>
        </button>
      ))}

      <div style={{ marginTop: 'auto', paddingTop: 18 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 11,
            padding: 10,
            borderRadius: 13,
            background: 'rgba(255,255,255,0.05)',
          }}
        >
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: '50%',
              background: 'linear-gradient(145deg,#3D6E60,#244A40)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 13,
              fontWeight: 600,
              color: '#EAF3EF',
              flexShrink: 0,
            }}
          >
            {initials(roleDef.who)}
          </div>
          <div className="sidebar-foot-text" style={{ minWidth: 0 }}>
            <div
              style={{
                fontSize: 13,
                fontWeight: 600,
                color: '#F0E6D6',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {roleDef.who}
            </div>
            <div style={{ fontSize: 11, color: '#9A8568' }}>{roleDef.label}</div>
          </div>
        </div>
      </div>
    </aside>
  )
}
