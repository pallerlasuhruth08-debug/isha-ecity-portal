import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

// Coordinator: add a caller to the campaign's pool (campaigns.segment.callers).
// Callers come from two sources — the nurturing team (nurturers, may have a login) or
// volunteers (people, assignment-only). Adding to the pool makes them available in the
// reassign dropdown and in the round-robin for FUTURE added recipients; it does NOT
// reshuffle existing assignments (that would move work mid-campaign).
export default function AddCallerDialog({ campaign, existingKeys, onClose, onAdded, onToast }) {
  const [tab, setTab] = useState('nurturing') // 'nurturing' | 'volunteers'
  const [q, setQ] = useState('')
  const [nurturers, setNurturers] = useState([])
  const [volResults, setVolResults] = useState([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    supabase.from('nurturers').select('id, full_name, phone').order('full_name').then(({ data }) => { if (alive) setNurturers(data || []) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    if (tab !== 'volunteers') return
    const term = q.trim()
    if (term.length < 2) { setVolResults([]); return }
    let alive = true
    const t = setTimeout(async () => {
      const digits = term.replace(/\D/g, '')
      let query = supabase.from('people').select('id, full_name, phone').eq('is_volunteer', true).limit(25)
      query = digits.length >= 4 ? query.ilike('phone', `%${digits}%`) : query.ilike('full_name', `%${term}%`)
      const { data } = await query
      if (alive) setVolResults(data || [])
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [q, tab])

  const nurShown = nurturers.filter((n) => !q.trim() || (n.full_name || '').toLowerCase().includes(q.trim().toLowerCase()) || (n.phone || '').includes(q.trim()))

  async function addCaller(source, id, name) {
    const key = `${source}:${id}`
    if (existingKeys.has(key)) { onToast?.(`${name} is already a caller here.`); return }
    setBusy(true)
    try {
      const seg = campaign.segment || {}
      const callers = Array.isArray(seg.callers) ? seg.callers.slice() : []
      callers.push({ source, id })
      const nextSeg = { ...seg, callers, distribution: seg.distribution || 'manual' }
      const { error } = await supabase.from('campaigns').update({ segment: nextSeg }).eq('id', campaign.id)
      if (error) throw error
      onToast?.(`${name} added as a caller. Assign recipients to them from the call list.`)
      onAdded?.()
      onClose?.()
    } catch (e) {
      onToast?.('Could not add caller: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const tabBtn = (k, label) => (
    <button onClick={() => setTab(k)} className="btn" style={{ padding: '7px 13px', fontSize: 12.5, background: tab === k ? '#241B14' : '#fff', color: tab === k ? '#F6ECDC' : 'var(--ink-soft)', border: tab === k ? 'none' : '1px solid var(--border)' }}>{label}</button>
  )
  const rowStyle = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, padding: '9px 14px', borderBottom: '1px solid #F4EEE2' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 520, maxWidth: '100%', padding: 24, boxShadow: 'var(--shadow-lg)', maxHeight: '86vh', display: 'flex', flexDirection: 'column' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 4px' }}>Add a caller</h3>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 14 }}>They join the pool for reassignment and future distribution. Existing assignments aren’t reshuffled.</div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {tabBtn('nurturing', 'Nurturing team')}
          {tabBtn('volunteers', 'Volunteers')}
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={tab === 'nurturing' ? 'Filter the team…' : 'Search volunteers by name or phone…'} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: 12 }} />

        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 10, minHeight: 140 }}>
          {tab === 'nurturing' && nurShown.map((n) => {
            const isIn = existingKeys.has(`nurturing_team:${n.id}`)
            return (
              <div key={n.id} style={rowStyle}>
                <div><span style={{ fontSize: 13.5, fontWeight: 600 }}>{n.full_name}</span> <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{n.phone || ''}</span></div>
                <button disabled={busy || isIn} className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 11px' }} onClick={() => addCaller('nurturing_team', n.id, n.full_name)}>{isIn ? 'Added' : 'Add'}</button>
              </div>
            )
          })}
          {tab === 'volunteers' && q.trim().length < 2 && <div style={{ padding: 16, fontSize: 13, color: 'var(--muted-2)' }}>Type at least 2 characters.</div>}
          {tab === 'volunteers' && volResults.map((p) => {
            const isIn = existingKeys.has(`volunteer:${p.id}`)
            return (
              <div key={p.id} style={rowStyle}>
                <div><span style={{ fontSize: 13.5, fontWeight: 600 }}>{p.full_name || '(no name)'}</span> <span style={{ fontSize: 12.5, color: 'var(--muted)' }}>{p.phone || 'no phone'}</span></div>
                <button disabled={busy || isIn} className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 11px' }} onClick={() => addCaller('volunteer', p.id, p.full_name)}>{isIn ? 'Added' : 'Add'}</button>
              </div>
            )
          })}
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose}>Done</button>
        </div>
      </div>
    </div>
  )
}
