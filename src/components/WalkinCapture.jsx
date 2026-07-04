import { useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { initials } from '../lib/ui'
import { ensureVolunteer } from '../lib/volunteers'

const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10)

// Mobile-first walk-in attendance capture for ONE pre-selected event. Fast repeated
// entry: capture a volunteer, resolve, then the form resets for the next arrival.
// Resolution chain: search the app by phone/email -> matches (mark present) OR
// no match -> prompt manual Ishangam search -> save UNRESOLVED (no person created).
export default function WalkinCapture({ activity, me, onClose, onToast, onChanged }) {
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [showSecondary, setShowSecondary] = useState(false)
  const [phone2, setPhone2] = useState('')
  const [email2, setEmail2] = useState('')

  const [searched, setSearched] = useState(false)
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const [recent, setRecent] = useState([]) // {name, kind} captured this session
  const phoneRef = useRef(null)

  const p10 = last10(phone)
  const p10b = last10(phone2)
  const em = email.trim()
  const emb = email2.trim()
  const canSearch = !!(p10 || p10b || em || emb)
  // An unresolved entry with no identifying detail is unresolvable — require a name
  // plus at least one contact field so a human can match it later.
  const canSaveUnresolved = !!(name.trim() && (p10 || em))

  function resetForm() {
    setPhone(''); setEmail(''); setName(''); setPhone2(''); setEmail2(''); setShowSecondary(false)
    setSearched(false); setResults([])
    phoneRef.current?.focus()
  }

  async function runSearch() {
    if (!canSearch) return
    setBusy(true)
    try {
      const ors = []
      if (p10) ors.push(`phone.eq.${p10}`)
      if (p10b) ors.push(`phone.eq.${p10b}`)
      if (em) ors.push(`email.ilike.${em}`)
      if (emb) ors.push(`email.ilike.${emb}`)
      const { data, error } = await supabase
        .from('people')
        .select('id, full_name, phone, email, is_volunteer, is_meditator')
        .or(ors.join(','))
        .limit(10)
      if (error) throw error
      setResults(data || [])
      setSearched(true)
    } catch (e) {
      onToast?.('Search failed: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const capturedFields = () => ({
    captured_name: name.trim() || null,
    captured_phone: p10 || null,
    captured_email: em || null,
    captured_phone2: p10b || null,
    captured_email2: emb || null,
    captured_by: me?.id || null,
    capture_source: 'walk_in',
  })

  async function markPresent(person) {
    setBusy(true)
    try {
      // Duplicate same-day (same event, same person) -> warn + skip, don't inflate.
      const { data: dup } = await supabase.from('attendance').select('id').eq('activity_id', activity.id).eq('person_id', person.id).maybeSingle()
      if (dup) {
        onToast?.(`${person.full_name} is already marked present for this event.`)
        resetForm()
        return
      }
      const { error } = await supabase.from('attendance').insert({ activity_id: activity.id, person_id: person.id, ...capturedFields() })
      if (error) throw error
      // Auto-promote: resolved event attendance confirms volunteer status.
      await ensureVolunteer(person.id, { source: 'event_attendance' })
      onToast?.(`${person.full_name} marked present — confirmed as volunteer.`)
      setRecent((r) => [{ name: person.full_name, kind: 'matched' }, ...r].slice(0, 6))
      onChanged?.()
      resetForm()
    } catch (e) {
      onToast?.('Could not mark present: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function saveUnresolved() {
    if (!canSaveUnresolved) {
      onToast?.('Add a name and at least one phone or email so this can be resolved later.')
      return
    }
    setBusy(true)
    try {
      // Duplicate unresolved for this event (same phone or email) -> warn + skip.
      const ors = []
      if (p10) ors.push(`captured_phone.eq.${p10}`)
      if (em) ors.push(`captured_email.ilike.${em}`)
      if (ors.length) {
        const { data: dup } = await supabase
          .from('attendance')
          .select('id')
          .eq('activity_id', activity.id)
          .is('person_id', null)
          .or(ors.join(','))
          .limit(1)
        if (dup && dup.length) {
          onToast?.('Already captured for this event — waiting in the unresolved queue.')
          resetForm()
          return
        }
      }
      const { error } = await supabase.from('attendance').insert({ activity_id: activity.id, person_id: null, ...capturedFields() })
      if (error) throw error
      onToast?.('Saved as unresolved — ask the volunteer to wait / search Ishangam manually.')
      setRecent((r) => [{ name: name.trim() || p10 || em || 'walk-in', kind: 'unresolved' }, ...r].slice(0, 6))
      onChanged?.()
      resetForm()
    } catch (e) {
      onToast?.('Could not save: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const inputStyle = { width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '12px 13px', fontSize: 15, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
  const label = { display: 'block', fontSize: 12, fontWeight: 600, color: '#5C5142', marginBottom: 5 }

  const hasMin = useMemo(() => !!(p10 || em), [p10, em])

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.45)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 130, padding: '0', overflowY: 'auto' }} onClick={onClose}>
      <div className="card" style={{ width: 460, maxWidth: '100%', minHeight: '100%', borderRadius: 0, padding: '20px 20px 40px', boxShadow: 'var(--shadow-lg)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ fontSize: 19, fontWeight: 600, margin: 0 }}>Walk-in capture</h2>
          <button className="btn btn-ghost" style={{ padding: '6px 12px', fontSize: 13 }} onClick={onClose}>Done</button>
        </div>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 18 }}>{activity.name}</div>

        {/* fields */}
        <label style={label}>Phone (primary)</label>
        <input ref={phoneRef} value={phone} onChange={(e) => { setPhone(e.target.value); setSearched(false) }} onKeyDown={(e) => e.key === 'Enter' && runSearch()} type="tel" inputMode="tel" placeholder="10-digit mobile" style={{ ...inputStyle, marginBottom: 12 }} autoFocus />
        <label style={label}>Email</label>
        <input value={email} onChange={(e) => { setEmail(e.target.value); setSearched(false) }} onKeyDown={(e) => e.key === 'Enter' && runSearch()} type="email" inputMode="email" placeholder="name@email.com" style={{ ...inputStyle, marginBottom: 12 }} />
        <label style={label}>Name</label>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" style={{ ...inputStyle, marginBottom: 12 }} />

        {!showSecondary ? (
          <button onClick={() => setShowSecondary(true)} className="btn btn-ghost" style={{ fontSize: 12.5, padding: '6px 0', color: 'var(--orange)' }}>+ Add secondary phone / email</button>
        ) : (
          <>
            <label style={label}>Secondary phone</label>
            <input value={phone2} onChange={(e) => { setPhone2(e.target.value); setSearched(false) }} type="tel" inputMode="tel" placeholder="optional" style={{ ...inputStyle, marginBottom: 12 }} />
            <label style={label}>Secondary email</label>
            <input value={email2} onChange={(e) => { setEmail2(e.target.value); setSearched(false) }} type="email" placeholder="optional" style={{ ...inputStyle, marginBottom: 12 }} />
          </>
        )}

        <button className="btn btn-primary" disabled={!canSearch || busy} onClick={runSearch} style={{ width: '100%', padding: '13px', fontSize: 15, marginTop: 8 }}>
          {busy ? 'Searching…' : 'Search app'}
        </button>
        {!hasMin && <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 6, textAlign: 'center' }}>Enter at least a phone or an email to search.</div>}

        {/* resolution */}
        {searched && results.length > 0 && (
          <div style={{ marginTop: 18 }}>
            <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, marginBottom: 8 }}>{results.length} match{results.length > 1 ? 'es' : ''} in the app</div>
            {results.map((p) => (
              <div key={p.id} className="rowhover" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '11px 12px', border: '1px solid var(--border)', borderRadius: 10, marginBottom: 8 }}>
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#C2691F', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(p.full_name || '?')}</div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>{p.full_name || '(no name)'}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.phone || 'no phone'}{p.is_volunteer ? ' · volunteer' : ''}{p.is_meditator ? ' · meditator' : ''}</div>
                </div>
                <button className="btn btn-primary" disabled={busy} onClick={() => markPresent(p)} style={{ padding: '8px 12px', fontSize: 13 }}>Present</button>
              </div>
            ))}
            <button onClick={saveUnresolved} disabled={busy || !canSaveUnresolved} title={canSaveUnresolved ? '' : 'Needs a name + one contact'} className="btn btn-ghost" style={{ fontSize: 12.5, padding: '8px 0', color: 'var(--muted)', opacity: canSaveUnresolved ? 1 : 0.5 }}>None of these — save as unresolved</button>
          </div>
        )}

        {searched && results.length === 0 && (
          <div style={{ marginTop: 18, padding: 16, border: '1px solid #E7C9B8', background: '#FBF1E4', borderRadius: 12 }}>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#9C4A14', marginBottom: 6 }}>No match in the app</div>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5, marginBottom: 14 }}>
              Ask the volunteer to wait and <strong>search Ishangam manually</strong> in its own screen. If you still can’t find them, save the details — they’ll wait in the unresolved queue for a human to match or promote.
            </div>
            <button className="btn btn-primary" disabled={busy || !canSaveUnresolved} onClick={saveUnresolved} style={{ width: '100%', padding: '12px', fontSize: 14, opacity: canSaveUnresolved ? 1 : 0.6 }}>Save as unresolved</button>
            {!canSaveUnresolved && <div style={{ fontSize: 11.5, color: '#9C4A14', marginTop: 8, textAlign: 'center' }}>Enter a name and at least one phone/email to save.</div>}
          </div>
        )}

        {recent.length > 0 && (
          <div style={{ marginTop: 22, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, marginBottom: 8 }}>Captured this session ({recent.length})</div>
            {recent.map((r, i) => (
              <div key={i} style={{ fontSize: 13, color: 'var(--ink-soft)', padding: '4px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: r.kind === 'matched' ? '#4E7C3F' : '#C28A2A' }} />
                {r.name} <span style={{ color: 'var(--muted-2)', fontSize: 11.5 }}>· {r.kind === 'matched' ? 'present' : 'unresolved'}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
