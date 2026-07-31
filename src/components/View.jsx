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
    <div className="card" style={{ padding: 'var(--space-3)', marginBottom: 'var(--space-4)', borderColor: 'var(--danger-border)', background: 'var(--danger-bg)', color: 'var(--danger-fg)', fontSize: 'var(--fs-body)' }}>
      {children}
    </div>
  )
}

export function Loading({ label = 'Loading…' }) {
  return <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-body)' }}>{label}</div>
}

export function Empty({ label = 'Nothing here yet.', action = null }) {
  return (
    <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-body)' }}>
      <div>{label}</div>
      {action && <div style={{ marginTop: 'var(--space-3)' }}>{action}</div>}
    </div>
  )
}

export function SectionTitle({ title, subtitle, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
      <div>
        <h3 style={{ fontSize: 'var(--fs-h2)', fontWeight: 600, margin: '0 0 3px' }}>{title}</h3>
        {subtitle && <p style={{ margin: 0, fontSize: 'var(--fs-body)', color: 'var(--muted)' }}>{subtitle}</p>}
      </div>
      {right}
    </div>
  )
}

export function Chip({ on, label, count, onClick }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={!!on}
      className="btn"
      style={{
        padding: '7px 13px',
        fontSize: 'var(--fs-caption)',
        borderRadius: 'var(--radius-pill)',
        background: on ? 'var(--sb-bg)' : '#fff',
        color: on ? 'var(--sb-ink)' : 'var(--ink-soft)',
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
export function Checkbox({ state, onClick, size = 19, label = 'Select' }) {
  const on = state === true || state === 'all'
  const partial = state === 'partial'
  const filled = on || partial
  // A real checkbox: <button role="checkbox"> gives keyboard (Space/Enter fire
  // onClick natively), focus-visible, and aria-checked for assistive tech.
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={on ? 'true' : partial ? 'mixed' : 'false'}
      aria-label={label}
      onClick={onClick}
      className="tap-hit-44"
      style={{ cursor: 'pointer', flexShrink: 0, padding: 0, border: 'none', background: 'none', display: 'inline-flex', borderRadius: 6 }}
    >
      <span
        style={{
          width: size,
          height: size,
          borderRadius: 6,
          border: '1.5px solid ' + (filled ? 'var(--orange)' : 'var(--border-strong)'),
          background: filled ? 'var(--orange)' : '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          flexShrink: 0,
        }}
      >
        {on ? CHECK : partial ? DASH : null}
      </span>
    </button>
  )
}

// PagerPill (scroll-gated floating pill) removed — every list now uses the sticky <Pager>.


export function Pager({ page, pageCount, total, onPage, pageSize, onPageSize, noun = 'rows', selection = null, bottomOffset = 12 }) {
  const from = total === 0 ? 0 : page * pageSize + 1
  const to = Math.min(total, (page + 1) * pageSize)
  // Shared sticky-bottom bar geometry — pagination and selection are two modes of
  // the SAME bar, so a selection never spawns a separate floating popover.
  // bottomOffset lifts the bar above a page's own fixed bottom CTA (e.g. Meditators phone).
  const barBase = { position: 'sticky', bottom: bottomOffset, zIndex: 20, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', padding: '11px 14px', borderRadius: 12, margin: '12px 0 0', boxShadow: '0 6px 20px rgba(0,0,0,.12)' }
  // Selection mode: same bar, accent fill, page nav hidden ("select all N matching"
  // removes the need to paginate mid-selection).
  if (selection && selection.count > 0) {
    const { count, total: selTotal, isFullySelected, onSelectAll, onClear, actions = [] } = selection
    return (
      <nav aria-label="Selection actions" style={{ ...barBase, background: 'linear-gradient(150deg, var(--orange-2), var(--orange-3))', border: '1px solid var(--orange-3)', color: '#fff' }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
          {isFullySelected ? `All ${count} selected` : `${count} selected`}
          {!isFullySelected && onSelectAll && selTotal > count && (
            <button onClick={onSelectAll} style={{ background: 'none', border: 'none', color: '#fff', fontWeight: 700, textDecoration: 'underline', cursor: 'pointer', fontSize: 13, fontFamily: 'inherit', marginLeft: 8 }}>Select all {selTotal}</button>
          )}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {actions.map((a) => (
            <button key={a.label} onClick={a.onClick} disabled={a.disabled}
              style={{ border: a.primary ? '1px solid #fff' : '1px solid rgba(255,255,255,.55)', background: a.primary ? '#fff' : 'transparent', color: a.primary ? 'var(--orange-3)' : '#fff', fontSize: 12.5, fontWeight: 600, padding: '7px 13px', borderRadius: 999, cursor: a.disabled ? 'default' : 'pointer', fontFamily: 'inherit', opacity: a.disabled ? 0.6 : 1, whiteSpace: 'nowrap' }}>{a.label}</button>
          ))}
          <button onClick={onClear} aria-label="Clear selection" style={{ width: 28, height: 28, borderRadius: '50%', border: 'none', background: 'rgba(255,255,255,.25)', color: '#fff', cursor: 'pointer', flexShrink: 0, fontSize: 13 }}>✕</button>
        </div>
      </nav>
    )
  }
  const selStyle = { padding: '7px 10px', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--panel-2)', color: 'var(--ink-soft)', fontSize: 12.5, fontWeight: 600, fontFamily: 'inherit', cursor: 'pointer' }
  const win = (() => { const c = page + 1, keep = new Set([1, pageCount, c, c - 1, c + 1]); const a = [...keep].filter((p) => p >= 1 && p <= pageCount).sort((x, y) => x - y); const out = []; let prev = 0; for (const p of a) { if (p - prev > 1) out.push('…'); out.push(p); prev = p } return out })()
  const pbtn = (label, opt = {}) => (
    <button key={opt.key || label} onClick={opt.onClick} disabled={opt.disabled} aria-label={opt.ariaLabel} aria-current={opt.current ? 'page' : undefined}
      style={{ minWidth: 30, height: 30, padding: '0 8px', borderRadius: 8, fontSize: 13, fontWeight: 600, fontFamily: 'inherit', cursor: opt.disabled ? 'default' : 'pointer', border: opt.current ? 'none' : '1px solid var(--border)', background: opt.current ? 'var(--sb-bg)' : 'var(--panel-2)', color: opt.current ? '#f6ecdc' : 'var(--ink-soft)', opacity: opt.disabled ? 0.4 : 1 }}>{label}</button>
  )
  return (
    <nav aria-label="Pagination" style={{ ...barBase, background: 'var(--panel-2)', border: '1px solid var(--border)' }}>
      <span style={{ fontSize: 13, color: 'var(--muted)', fontWeight: 600 }}>Showing {from}–{to} of <b style={{ color: 'var(--ink)' }}>{total}</b> {noun}</span>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <select value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Rows per page" style={selStyle}>
          {[25, 50, 100].map((sz) => <option key={sz} value={sz}>{sz} / page</option>)}
        </select>
        {pageCount > 1 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {pbtn('‹', { ariaLabel: 'Previous page', disabled: page === 0, onClick: () => onPage(page - 1) })}
            <span className="desktop-only" style={{ gap: 4 }}>
              {win.map((p, i) => p === '…' ? <span key={'e' + i} style={{ color: 'var(--muted-2)', padding: '0 2px' }}>…</span> : pbtn(String(p), { key: p, current: p === page + 1, onClick: () => onPage(p - 1) }))}
            </span>
            <select className="mobile-only" value={page} onChange={(e) => onPage(Number(e.target.value))} aria-label="Go to page" style={selStyle}>
              {Array.from({ length: pageCount }, (_, i) => <option key={i} value={i}>Page {i + 1}</option>)}
            </select>
            {pbtn('›', { ariaLabel: 'Next page', disabled: page + 1 >= pageCount, onClick: () => onPage(page + 1) })}
          </div>
        )}
      </div>
    </nav>
  )
}
// Active-filter chips: each active filter shown as a removable pill above the list.
// Not sticky — the live count in the sticky Pager is the mid-scroll filter feedback,
// so the chips stay in flow and the bottom bar stays a single calm row.
export function ActiveFilters({ items = [], onClear }) {
  if (!items.length) return null
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10, alignItems: 'center' }}>
      {items.map((it) => (
        <button key={it.key} onClick={it.onRemove} aria-label={`Remove filter ${it.label} ${it.value}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 999, padding: '5px 10px', cursor: 'pointer', fontFamily: 'inherit', maxWidth: 260 }}>
          <span style={{ color: 'var(--muted)' }}>{it.label}:</span>
          <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{it.value}</span>
          <span aria-hidden style={{ color: 'var(--muted-2)', fontWeight: 700, marginLeft: 1 }}>✕</span>
        </button>
      ))}
      {items.length > 1 && onClear && (
        <button onClick={onClear} style={{ background: 'none', border: 'none', color: 'var(--orange)', fontSize: 12, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: '5px 6px' }}>Clear all</button>
      )}
    </div>
  )
}
// SelectionBar was folded into <Pager selection={…} /> — selection is now a mode of
// the sticky pager bar, not a separate floating popover.
