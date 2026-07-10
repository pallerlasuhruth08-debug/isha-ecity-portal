export default function KpiCard({ icon, tint, ink, value, label, badge, badgeStyle, loading }) {
  return (
    <div className="card" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div
          style={{
            width: 38,
            height: 38,
            borderRadius: 11,
            background: tint,
            color: ink,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {icon}
        </div>
        {badge != null && (
          <span className="pill" style={badgeStyle}>
            {badge}
          </span>
        )}
      </div>
      <div>
        <div style={{ fontFamily: "'Newsreader',serif", fontSize: 30, fontWeight: 600, lineHeight: 1, color: 'var(--ink)' }}>
          {loading ? '—' : value}
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6 }}>{label}</div>
      </div>
    </div>
  )
}
