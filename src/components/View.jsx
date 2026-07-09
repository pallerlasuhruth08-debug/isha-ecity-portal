// Small shared primitives used across the ported views.
export function Pad({ children }) {
  return (
    <div className="main-pad" style={{ padding: '26px 32px 60px', overflowY: 'auto' }}>
      {children}
    </div>
  )
}

export function ErrorCard({ children }) {
  return (
    <div className="card" style={{ padding: 14, marginBottom: 16, borderColor: '#E7C9B8', background: '#FBEEE6', color: '#9C4A14', fontSize: 13 }}>
      {children}
    </div>
  )
}

export function Loading({ label = 'Loading…' }) {
  return <div style={{ padding: 28, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>{label}</div>
}

export function Empty({ label = 'Nothing here yet.' }) {
  return <div style={{ padding: 28, textAlign: 'center', color: 'var(--muted-2)', fontSize: 13 }}>{label}</div>
}

export function SectionTitle({ title, subtitle, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
      <div>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 3px' }}>{title}</h3>
        {subtitle && <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

export function Chip({ on, label, count, onClick }) {
  return (
    <button
      onClick={onClick}
      className="btn"
      style={{
        padding: '7px 13px',
        fontSize: 12.5,
        borderRadius: 20,
        background: on ? '#241B14' : '#fff',
        color: on ? '#F6ECDC' : 'var(--ink-soft)',
        border: on ? 'none' : '1px solid var(--border)',
      }}
    >
      {label}
      {count != null && <span style={{ opacity: 0.6, marginLeft: 5 }}>{count}</span>}
    </button>
  )
}

const CHECK = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
    <path d="M20 6 9 17l-5-5" />
  </svg>
)
const DASH = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round">
    <path d="M6 12h12" />
  </svg>
)

// state: 'all' | 'partial' | 'none' | boolean
export function Checkbox({ state, onClick, size = 19 }) {
  const on = state === true || state === 'all'
  const partial = state === 'partial'
  const filled = on || partial
  return (
    <div
      onClick={onClick}
      style={{
        width: size,
        height: size,
        borderRadius: 6,
        border: '1.5px solid ' + (filled ? '#C2691F' : '#D8CBB6'),
        background: filled ? '#C2691F' : '#fff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#fff',
        cursor: 'pointer',
        flexShrink: 0,
      }}
    >
      {on ? CHECK : partial ? DASH : null}
    </div>
  )
}

export function PageSizeSelect({ value, onChange, options = [25, 50, 100] }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--muted)' }}>
      Rows
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ padding: '5px 8px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer' }}
      >
        {options.map((o) => (
          <option key={o} value={o}>{o}</option>
        ))}
      </select>
    </label>
  )
}

// Pagination controls — rendered at both top and bottom of a table, driven by the
// SAME page/pageSize state (pass `position="top"` for the copy above the rows).
export function PagerBar({ page, pageCount, total, pageSize, onPage, onPageSize, position = 'bottom' }) {
  const from = total === 0 ? 0 : page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  const border = position === 'top' ? { borderBottom: '1px solid var(--border)' } : { borderTop: '1px solid var(--border)' }
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 20px', ...border, flexWrap: 'wrap' }}>
      <PageSizeSelect value={pageSize} onChange={onPageSize} />
      <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>
        {from}–{to} of {total} · page {page + 1} of {pageCount}
      </span>
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <button className="btn btn-ghost" disabled={page === 0} onClick={() => onPage(Math.max(0, page - 1))} style={{ opacity: page === 0 ? 0.5 : 1 }}>Prev</button>
        <button className="btn btn-ghost" disabled={page + 1 >= pageCount} onClick={() => onPage(Math.min(pageCount - 1, page + 1))} style={{ opacity: page + 1 >= pageCount ? 0.5 : 1 }}>Next</button>
      </div>
    </div>
  )
}

// Selection banner shared by campaign-capable tables. Two-stage select-all:
// `isFullySelected` (mode 'all' with zero exclusions) shows "All N selected"; any
// partial state (current-page-only, or an "all" selection with some rows excluded)
// shows "{count} selected" plus a "Select all {total}" prompt to promote to full.
export function SelectionBar({ isFullySelected, count, total, onSelectAll, onCreate, onAssign, onClear }) {
  if (count <= 0) return null
  return (
    <div className="card" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', marginBottom: 14, background: '#FBF1E6', borderColor: '#EBD9C2', flexWrap: 'wrap' }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#9C4A14' }}>
        {isFullySelected ? `All ${count} matching this filter selected` : `${count} selected`}
      </span>
      {!isFullySelected && onSelectAll && total > count && (
        <button className="btn btn-ghost" onClick={onSelectAll} style={{ fontSize: 12.5, padding: '6px 12px' }}>Select all {total} matching this filter?</button>
      )}
      <div style={{ flex: 1 }} />
      {onAssign && <button className="btn btn-ghost" onClick={onAssign}>Assign to nurturer</button>}
      {onCreate && <button className="btn btn-primary" onClick={onCreate}>Create campaign</button>}
      <button className="btn btn-ghost" onClick={onClear}>✕ Clear selection</button>
    </div>
  )
}
