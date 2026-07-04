import { useState } from 'react'
import { Icon } from '../lib/icons'
import { ROLES, ROLE_ORDER } from '../lib/roles'
import { initials } from '../lib/ui'

export default function Topbar({ role, title, subtitle, onPickRole, user, onSignOut }) {
  const [menu, setMenu] = useState(false)
  const roleDef = ROLES[role]

  return (
    <header
      style={{
        height: 70,
        flexShrink: 0,
        borderBottom: '1px solid var(--border)',
        background: 'var(--panel)',
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        padding: '0 32px',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <h1
          style={{
            fontSize: 21,
            fontWeight: 600,
            margin: 0,
            lineHeight: 1.1,
            color: 'var(--ink)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {title}
        </h1>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginTop: 1 }}>{subtitle}</div>
      </div>

      <div
        className="topbar-search"
        style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: 9,
          background: '#fff',
          border: '1px solid var(--border)',
          borderRadius: 11,
          padding: '9px 13px',
          width: 240,
        }}
      >
        {Icon.search(16)}
        <span style={{ fontSize: 13, color: 'var(--muted-2)' }}>Search volunteers…</span>
      </div>

      <div style={{ position: 'relative', flexShrink: 0 }}>
        <button
          onClick={() => setMenu((m) => !m)}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: '#fff',
            border: '1px solid var(--border)',
            borderRadius: 11,
            padding: '0 11px',
            height: 42,
            cursor: 'pointer',
          }}
        >
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: '50%',
              background: 'linear-gradient(145deg,#DE8038,#B85C1E)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 700,
              color: '#fff',
              flexShrink: 0,
            }}
          >
            {initials(roleDef.who)}
          </div>
          <div style={{ textAlign: 'left', lineHeight: 1.15 }}>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
              {roleDef.label}
            </div>
            <div style={{ fontSize: 10.5, color: '#9A8568', whiteSpace: 'nowrap' }}>{roleDef.scope}</div>
          </div>
          {Icon.chevron(14)}
        </button>

        {menu && (
          <>
            <div style={{ position: 'fixed', inset: 0, zIndex: 50 }} onClick={() => setMenu(false)} />
            <div
              style={{
                position: 'absolute',
                top: 50,
                right: 0,
                width: 292,
                background: '#fff',
                border: '1px solid var(--border)',
                borderRadius: 15,
                boxShadow: 'var(--shadow-lg)',
                padding: 8,
                zIndex: 60,
              }}
            >
              <div
                style={{
                  fontSize: 10.5,
                  letterSpacing: '.1em',
                  textTransform: 'uppercase',
                  color: 'var(--muted-2)',
                  fontWeight: 700,
                  padding: '8px 11px 6px',
                }}
              >
                Switch role · view access
              </div>
              {ROLE_ORDER.map((rk) => {
                const r = ROLES[rk]
                const cur = rk === role
                return (
                  <div
                    key={rk}
                    className="rowhover"
                    onClick={() => {
                      onPickRole(rk)
                      setMenu(false)
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 11,
                      padding: '9px 11px',
                      borderRadius: 11,
                      cursor: 'pointer',
                    }}
                  >
                    <div
                      style={{
                        width: 34,
                        height: 34,
                        borderRadius: '50%',
                        background: cur ? 'linear-gradient(145deg,#DE8038,#B85C1E)' : '#EFE6D6',
                        color: cur ? '#fff' : '#7A6A52',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 12,
                        fontWeight: 700,
                        flexShrink: 0,
                      }}
                    >
                      {initials(r.who)}
                    </div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{r.label}</div>
                      <div style={{ fontSize: 11, color: 'var(--muted)' }}>{r.scope}</div>
                    </div>
                    {cur && (
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#C2691F" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </div>
                )
              })}
              <div style={{ borderTop: '1px solid var(--border)', margin: '6px 4px 0', paddingTop: 6 }}>
                {user && (
                  <div style={{ fontSize: 11.5, color: 'var(--muted)', padding: '4px 11px' }}>
                    Signed in as <strong style={{ color: 'var(--ink-soft)' }}>{user}</strong>
                  </div>
                )}
                <div
                  className="rowhover"
                  onClick={() => {
                    setMenu(false)
                    onSignOut && onSignOut()
                  }}
                  style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 11px', borderRadius: 11, cursor: 'pointer', color: '#B5532F', fontSize: 13, fontWeight: 600 }}
                >
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <path d="m16 17 5-5-5-5M21 12H9" />
                  </svg>
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
