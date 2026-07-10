// Small shared primitives used across the ported views.
import { useEffect, useRef, useState } from 'react'

export function Pad({ children }) {
  return (
    <div className="main-pad" style={{ padding: '26px 32px 60px', overflowY: 'auto' }}>
      {children}
    </div>
  )
}

export function ErrorCard({ children }) {
  return (
    <div className="card" style={{ padding: 14, marginBottom: 16, borderColor: '#E7C9B8', background: '#FBEEE6', color: 'var(--rust)', fontSize: 14 }}>
      {children}
    </div>
  )
}

export function Loading({ label = 'Loading…' }) {
  return <div style={{ padding: 28, textAlign: 'center', color: 'var(--muted)', fontSize: 14 }}>{label}</div>
}

export function Empty({ label = 'Nothing here yet.' }) {
  return <div style={{ padding: 28, textAlign: 'center', color: 'var(--muted-2)', fontSize: 14 }}>{label}</div>
}

export function SectionTitle({ title, subtitle, right }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
      <div>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 3px' }}>{title}</h3>
        {subtitle && <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>{subtitle}</p>}
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
        fontSize: 12,
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
    <div onClick={onClick} className="tap-hit-44" style={{ cursor: 'pointer', flexShrink: 0 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: 6,
          border: '1.5px solid ' + (filled ? 'var(--orange)' : '#D8CBB6'),
          background: filled ? 'var(--orange)' : '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: '#fff',
          flexShrink: 0,
        }}
      >
        {on ? CHECK : partial ? DASH : null}
      </div>
    </div>
  )
}

// Floating pagination pill: page nav + rows-per-page, hidden until the user scrolls
// past the first viewport height of the (scrollable) page, then fades in bottom-center.
// Tapping a chevron changes page and scrolls back to top. While a selection is active
// (`selection.count > 0`), the pill is taken over by a select-all + actions bar instead —
// same position, always visible regardless of scroll (the two never compete for the same
// spot). This is the ONE place selection state + its actions (Create campaign, Assign, …)
// live — there's no separate top banner, so there's only one "selected" readout on screen.
export function PagerPill({ page, pageCount, onPage, pageSize, onPageSize, selection }) {
  const ref = useRef(null)
  const [visible, setVisible] = useState(false)
  const selecting = !!(selection && selection.count > 0)

  useEffect(() => {
    const scroller = ref.current?.closest('.main-pad') || window
    const getY = () => (scroller === window ? window.scrollY : scroller.scrollTop)
    const getH = () => (scroller === window ? window.innerHeight : scroller.clientHeight)
    const onScroll = () => setVisible(getY() > getH() * 0.8)
    scroller.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => scroller.removeEventListener('scroll', onScroll)
  }, [])

  if (!selecting && pageCount <= 1) return null

  function go(p) {
    onPage(p)
    ;(ref.current?.closest('.main-pad') || window).scrollTo({ top: 0, behavior: 'smooth' })
  }

  if (selecting) {
    const { count, total, isFullySelected, onSelectAll, onClear, actions = [] } = selection
    return (
      <div ref={ref} className="pager-pill pager-pill-select pager-pill-visible">
        {/* Label + clear are ONE atomic flex item, so wrapping always keeps them
            together on row 1 — only the (bulkier) actions group drops to row 2. */}
        <div className="pager-pill-select-top">
          <span className="pager-pill-label">
            {isFullySelected ? `All ${count} selected` : `${count} selected`}
            {!isFullySelected && onSelectAll && total > count && (
              <button className="pager-pill-link" onClick={onSelectAll}>· Select all {total}</button>
            )}
          </span>
          <button className="pager-pill-clear" onClick={onClear} aria-label="Clear selection">✕</button>
        </div>
        {actions.length > 0 && (
          <div className="pager-pill-actions">
            {actions.map((a) => (
              <button key={a.label} className={'pager-pill-btn' + (a.primary ? ' pager-pill-btn-primary' : '')} disabled={a.disabled} onClick={a.onClick}>{a.label}</button>
            ))}
          </div>
        )}
      </div>
    )
  }

  return (
    <div ref={ref} className={'pager-pill' + (visible ? ' pager-pill-visible' : '')}>
      <button className="pager-pill-chevron" disabled={page === 0} onClick={() => go(Math.max(0, page - 1))} aria-label="Previous page">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M15 6l-6 6 6 6" /></svg>
      </button>
      <span className="pager-pill-label">Page {page + 1} of {pageCount}</span>
      <button className="pager-pill-chevron" disabled={page + 1 >= pageCount} onClick={() => go(Math.min(pageCount - 1, page + 1))} aria-label="Next page">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 6l6 6-6 6" /></svg>
      </button>
      {onPageSize && (
        <select className="pager-pill-rows" value={pageSize} onChange={(e) => onPageSize(Number(e.target.value))} aria-label="Rows per page">
          {[25, 50, 100].map((o) => <option key={o} value={o}>{o} / page</option>)}
        </select>
      )}
    </div>
  )
}
