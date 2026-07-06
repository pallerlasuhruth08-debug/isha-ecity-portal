import { useEffect, useState } from 'react'
import { Icon } from '../lib/icons'
import { REAL_ROLE_LABEL } from '../lib/roles'
import { initials } from '../lib/ui'
import { useBreakpoint } from '../lib/useBreakpoint'
import { pushBlockedReason, currentSubscription, enablePush, disablePush } from '../lib/push'

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
                <NotifyMenuItem />
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

// Push toggle in the user menu. iOS (not installed) shows an install hint instead
// of a button, since Apple only delivers web push to a home-screen-installed PWA.
function NotifyMenuItem() {
  const [state, setState] = useState('loading') // loading | on | off | busy | ios-install | unsupported | denied
  const [msg, setMsg] = useState('')

  useEffect(() => {
    let alive = true
    ;(async () => {
      const reason = pushBlockedReason()
      if (reason) { if (alive) setState(reason === 'ios-install' ? 'ios-install' : reason) ; return }
      const sub = await currentSubscription()
      if (alive) setState(sub ? 'on' : 'off')
    })()
    return () => { alive = false }
  }, [])

  async function toggle() {
    setState('busy'); setMsg('')
    try {
      if (await currentSubscription()) { await disablePush(); setState('off') }
      else { await enablePush(); setState('on') }
    } catch (e) {
      setMsg(e.message || String(e))
      setState(pushBlockedReason() || 'off')
    }
  }

  const bell = <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>

  if (state === 'ios-install') {
    return <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 11px', fontSize: 12, color: 'var(--muted)' }}>{bell}<span>Add to Home Screen to get alerts on iPhone.</span></div>
  }
  if (state === 'unsupported') {
    return <div style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', fontSize: 12, color: 'var(--muted-2)' }}>{bell}<span>Notifications not supported here.</span></div>
  }
  if (state === 'denied') {
    return <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 11px', fontSize: 12, color: 'var(--muted)' }}>{bell}<span>Notifications blocked — enable them in browser settings.</span></div>
  }
  const label = state === 'on' ? 'Notifications on' : state === 'busy' ? 'Working…' : state === 'loading' ? 'Notifications' : 'Enable notifications'
  return (
    <div>
      <div className="rowhover" onClick={state === 'busy' || state === 'loading' ? undefined : toggle}
        style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 11, cursor: state === 'busy' ? 'default' : 'pointer', color: 'var(--ink)', fontSize: 13, fontWeight: 600 }}>
        {bell}
        <span>{label}</span>
        {state === 'on' && <span style={{ marginLeft: 'auto', width: 8, height: 8, borderRadius: '50%', background: '#4E7C3F' }} />}
      </div>
      {msg && <div style={{ fontSize: 11, color: '#B5532F', padding: '0 11px 6px' }}>{msg}</div>}
    </div>
  )
}
