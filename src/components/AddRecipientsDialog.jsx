import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'

// Coordinator: add people to an existing campaign mid-flight. New journeys follow the
// campaign's distribution mode:
//   'equal' (Mode 1) -> round-robin across the current caller pool
//   anything else (manual/shared/single/none) -> land UNASSIGNED for manual placement.
export default function AddRecipientsDialog({ campaign, existingPersonIds, onClose, onAdded, onToast }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [sel, setSel] = useState({}) // person_id -> person
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)

  const mode = campaign.segment?.distribution || null
  const pool = campaign.callerPool || []
  const willDistribute = mode === 'equal' && pool.length > 0

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setResults([]); return }
    let alive = true
    setSearching(true)
    const t = setTimeout(async () => {
      const digits = term.replace(/\D/g, '')
      let query = supabase.from('people').select('id, full_name, phone').limit(25)
      query = digits.length >= 4 ? query.ilike('phone', `%${digits}%`) : query.ilike('full_name', `%${term}%`)
      const { data } = await query
      if (!alive) return
      setResults((data || []).filter((p) => !existingPersonIds.has(p.id)))
      setSearching(false)
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [q, existingPersonIds])

  const selCount = Object.keys(sel).length
  const toggle = (p) => setSel((s) => { const n = { ...s }; if (n[p.id]) delete n[p.id]; else n[p.id] = p; return n })

  async function add() {
    setBusy(true)
    try {
      const people = Object.values(sel)
      const rows = people.map((p) => ({
        person_id: p.id,
        campaign_id: campaign.id,
        type: 'campaign',
        center_id: campaign.center_id || 'unassigned',
        status: 'active',
      }))
      const { data: inserted, error } = await supabase.from('journeys').insert(rows).select('id')
      if (error) throw error

      // Distribution: only Mode 1 (equal) auto-assigns; else leave unassigned.
      if (willDistribute && inserted?.length) {
        const updates = inserted.map((j, i) => {
          const caller = pool[i % pool.length]
          return supabase
            .from('journeys')
            .update({ caller_source: caller.source, caller_id: caller.id, assigned_to: caller.profileId || null })
            .eq('id', j.id)
        })
        await Promise.all(updates)
      }
      onToast?.(
        `Added ${people.length} recipient${people.length !== 1 ? 's' : ''}` +
          (willDistribute ? ' — distributed equally across callers.' : ' — unassigned (place them manually).'),
      )
      onAdded?.()
      onClose?.()
    } catch (e) {
      onToast?.('Could not add: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 520, maxWidth: '100%', padding: 24, boxShadow: 'var(--shadow-lg)', maxHeight: '86vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 4px' }}>Add recipients</h3>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>
          {willDistribute
            ? `New recipients will be divided equally across ${pool.length} caller(s).`
            : mode === 'equal'
              ? 'No callers in the pool yet — new recipients land unassigned.'
              : 'This campaign isn’t on equal-distribution — new recipients land unassigned for manual placement.'}
        </div>

        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search people by name or phone…"
          style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: 12 }}
        />

        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, minHeight: 120 }}>
          {searching && <div style={{ padding: 16, fontSize: 13, color: 'var(--muted-2)' }}>Searching…</div>}
          {!searching && q.trim().length >= 2 && results.length === 0 && <div style={{ padding: 16, fontSize: 13, color: 'var(--muted-2)' }}>No matches not already in this campaign.</div>}
          {!searching && q.trim().length < 2 && <div style={{ padding: 16, fontSize: 13, color: 'var(--muted-2)' }}>Type at least 2 characters.</div>}
          {results.map((p) => (
            <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 14px', borderBottom: '1px solid #F4EEE2', cursor: 'pointer' }}>
              <input type="checkbox" checked={!!sel[p.id]} onChange={() => toggle(p)} />
              <span style={{ fontSize: 13.5, fontWeight: 600 }}>{p.full_name || '(no name)'}</span>
              <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{p.phone || 'no phone'}</span>
            </label>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
          <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{selCount} selected</span>
          <div style={{ display: 'flex', gap: 10 }}>
            <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary" disabled={busy || selCount === 0} onClick={add}>{busy ? 'Adding…' : `Add ${selCount || ''}`.trim()}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
