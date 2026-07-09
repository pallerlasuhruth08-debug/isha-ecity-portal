import { useEffect, useRef, useState } from 'react'

// Shared 3-dot action menu. Collapses row actions that would otherwise crowd or
// cover content on narrow screens (Teams rows, to-do rows, attendance sessions).
// items: [{ label, onClick, danger?, disabled? }] for actions, or { label, view: true }
// for a plain informational line (e.g. a team's phase/date span).
export default function KebabMenu({ items, buttonStyle, className = '' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  return (
    <div ref={ref} className={className} style={{ position: 'relative', flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
      <button className="tap44" title="Actions" onClick={() => setOpen((o) => !o)}
        style={{ fontSize: 16, lineHeight: 1, padding: '5px 10px', borderRadius: 7, border: '1px solid var(--border)', background: open ? '#EDE4D6' : '#fff', cursor: 'pointer', ...buttonStyle }}>⋯</button>
      {open && (
        <div className="card" style={{ position: 'absolute', top: 36, right: 0, zIndex: 40, boxShadow: 'var(--shadow-lg)', padding: 6, minWidth: 200 }}>
          {items.map((it, i) => it.view ? (
            <div key={i} style={{ padding: '7px 10px', fontSize: 11.5, color: 'var(--muted-2)' }}>{it.label}</div>
          ) : (
            <div key={i} className="rowhover" style={{ padding: '9px 10px', borderRadius: 8, cursor: it.disabled ? 'default' : 'pointer', fontSize: 12.5, fontWeight: 600, color: it.danger ? '#B5532F' : 'var(--ink)', opacity: it.disabled ? 0.5 : 1 }}
              onClick={() => { if (it.disabled) return; setOpen(false); it.onClick() }}>{it.label}</div>
          ))}
        </div>
      )}
    </div>
  )
}
