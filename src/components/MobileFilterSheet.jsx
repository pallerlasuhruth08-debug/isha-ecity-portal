import { useState } from 'react'
import { useBreakpoint } from '../lib/useBreakpoint'

// Below the phone breakpoint, the page's filter controls collapse behind a single
// "Filters (N)" button that opens a bottom-sheet (default mobile view = search +
// results only). On desktop/tablet the children render inline, unchanged.
export default function MobileFilterSheet({ count = 0, children }) {
  const { isPhone } = useBreakpoint()
  const [open, setOpen] = useState(false)
  if (!isPhone) return children

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="btn btn-ghost"
        style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, padding: '10px 14px', minHeight: 44 }}
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 6h16M7 12h10M10 18h4" /></svg>
        Filters
        {count > 0 && <span style={{ background: '#C2691F', color: '#fff', fontSize: 11, fontWeight: 700, borderRadius: 999, minWidth: 18, height: 18, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', padding: '0 5px' }}>{count}</span>}
      </button>

      {open && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,12,6,0.45)', zIndex: 130, display: 'flex', alignItems: 'flex-end' }} onClick={() => setOpen(false)}>
          <div onClick={(e) => e.stopPropagation()} className="scrollarea" style={{ background: 'var(--bg)', width: '100%', maxHeight: '82vh', overflowY: 'auto', borderRadius: '18px 18px 0 0', padding: '16px 16px 22px', boxShadow: '0 -8px 40px rgba(0,0,0,0.25)' }}>
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 14 }}>
              <div style={{ fontSize: 16, fontWeight: 600 }}>Filters{count > 0 ? ` · ${count}` : ''}</div>
              <div onClick={() => setOpen(false)} style={{ marginLeft: 'auto', fontSize: 13, fontWeight: 600, color: 'var(--orange)', cursor: 'pointer' }}>✕ Close</div>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>{children}</div>
            <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', padding: '13px', fontSize: 15, marginTop: 16 }} onClick={() => setOpen(false)}>Show results</button>
          </div>
        </div>
      )}
    </>
  )
}
