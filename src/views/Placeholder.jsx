import { Icon } from '../lib/icons'

// Faithful shell for views still being wired to Supabase. Keeps the app fully
// navigable while each view is ported one at a time.
export default function Placeholder({ view, title, note }) {
  return (
    <div className="main-pad" style={{ padding: '26px 32px 60px', overflowY: 'auto' }}>
      <div
        className="card"
        style={{
          padding: '48px 40px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          textAlign: 'center',
          gap: 14,
          maxWidth: 560,
          margin: '40px auto 0',
        }}
      >
        <div
          style={{
            width: 56,
            height: 56,
            borderRadius: 16,
            background: '#F3E3D2',
            color: '#9C4A14',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {(Icon[view] || Icon.dashboard)(26)}
        </div>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0 }}>{title}</h2>
        <div style={{ fontSize: 13.5, color: 'var(--muted)', lineHeight: 1.55 }}>
          {note ||
            'This view is designed and next in line to be wired to live Supabase data. The layout, interactions and role scoping from the design are being ported here.'}
        </div>
        <span
          className="pill"
          style={{ background: '#F1EADD', color: '#8C7E6B', marginTop: 4 }}
        >
          WIRING IN PROGRESS
        </span>
      </div>
    </div>
  )
}
