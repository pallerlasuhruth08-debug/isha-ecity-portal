import { useState } from 'react'
import { Icon } from '../lib/icons'
import { REAL_ROLE_LABEL } from '../lib/roles'
import { initials } from '../lib/ui'
import { useBreakpoint } from '../lib/useBreakpoint'

// The user button shows the REAL signed-in profile (name + role) — never the
// cosmetic persona. The persona role-switcher and the placeholder search box
// have been removed; the menu is just identity + sign out.
export default function Topbar({ title, subtitle, me, email, onSignOut, onMenu }) {
  const [menu, setMenu] = useState(false)
  const { isPhone } = useBreakpoint()
  const name = me?.full_name?.trim() || me?.email || email || 'You'
  const roleLabel = REAL_ROLE_LABEL[me?.role] || me?.role || ''

  return (
    <header
      className="topbar"
      style={{ height: 70, flexShrink: 0, borderBottom: '1px solid var(--border)', background: 'var(--panel)', display: 'flex', alignItems: 'center', gap: 14, padding: '0 clamp(14px, 4vw, 32px)' }}
    >
      {onMenu && (
        <button className="topbar-burger" onClick={onMenu} aria-label="Open menu" style={{ flexShrink: 0, width: 44, height: 44, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', border: '1px solid var(--border)', borderRadius: 11, cursor: 'pointer', color: 'var(--ink)' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M3 6h18M3 12h18M3 18h18" /></svg>
        </button>
      )}
      <div style={{ minWidth: 0 }}>
        <h1 style={{ fontSize: 21, fontWeight: 600, margin: 0, lineHeight: 1.1, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</h1>
        {!isPhone && <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 1 }}>{subtitle}</div>}
      </div>

      <div style={{ position: 'relative', flexShrink: 0, marginLeft: 'auto' }}>
        <button
          onClick={() => setMenu((m) => !m)}
          style={{ display: 'flex', alignItems: 'center', gap: 10, background: '#fff', border: '1px solid var(--border)', borderRadius: 11, padding: isPhone ? '0 8px' : '0 11px', height: isPhone ? 44 : 42, cursor: 'pointer' }}
        >
          <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(145deg,#DE8038,#B85C1E)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>{initials(name)}</div>
          {!isPhone && (
            <div style={{ textAlign: 'left', lineHeight: 1.15 }}>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{name}</div>
              {roleLabel && <div style={{ fontSize: 10.5, color: '#9A8568', whiteSpace: 'nowrap' }}>{roleLabel}</div>}
            </div>
          )}
          {Icon.chevron(14)}
        </button>

        {menu && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={() => setMenu(false)} />
            <div style={{ position: 'absolute', top: 50, right: 0, width: 250, background: '#fff', border: '1px solid var(--border)', borderRadius: 15, boxShadow: 'var(--shadow-lg)', padding: 8, zIndex: 60 }}>
              <div style={{ padding: '8px 11px 10px' }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>{name}</div>
                {roleLabel && <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{roleLabel}</div>}
              </div>
              <div style={{ borderTop: '1px solid var(--border)', paddingTop: 6 }}>
                <div
                  className="rowhover"
                  onClick={() => { setMenu(false); onSignOut && onSignOut() }}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 11, cursor: 'pointer', color: '#B5532F', fontSize: 13, fontWeight: 600 }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><path d="m16 17 5-5-5-5M21 12H9" /></svg>
                  Sign out
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
