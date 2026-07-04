import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { initials } from '../lib/ui'
import { Pad, ErrorCard, Loading, Empty } from '../components/View'

const last10 = (p) => String(p || '').replace(/\D/g, '').slice(-10)
const fmtWhen = (iso) => {
  if (!iso) return ''
  try { return new Date(iso).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) } catch { return iso }
}

// The unresolved walk-in queue: attendance rows captured with no person yet. A human
// (coordinator) matches each to an existing person or promotes it to a provisional
// person — the SAME attendance row is re-linked (person_id set), no re-entry.
export default function Unresolved({ me, isCoordinator = false, onToast }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [resolveFor, setResolveFor] = useState(null) // entry being resolved

  const load = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('attendance')
        .select('id, activity_id, captured_name, captured_phone, captured_email, captured_phone2, captured_email2, time_in, capture_source, activity:activities!attendance_activity_id_fkey(name, activity_date, center_id)')
        .is('person_id', null)
        .order('time_in', { ascending: false })
        .limit(500)
      if (error) throw error
      setRows(data || [])
    } catch (e) {
      setErr(e.message || String(e))
    }
  }, [])
  useEffect(() => { load() }, [load])

  const loading = !rows && !err
  if (loading) return <Pad><Loading label="Loading unresolved walk-ins…" /></Pad>
  if (err) return <Pad><ErrorCard>{err}</ErrorCard></Pad>

  if (!isCoordinator) {
    return (
      <Pad>
        <div className="card" style={{ padding: 22, fontSize: 13.5, color: 'var(--muted)' }}>
          The unresolved walk-in queue is worked by coordinators. You don’t have coordinator access on this account.
        </div>
      </Pad>
    )
  }

  return (
    <Pad>
      <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', maxWidth: 620 }}>
        Walk-ins captured at events that couldn’t be matched on the spot. Match each to an existing person, or promote it to a provisional person — the attendance re-links automatically, nothing is re-entered.
      </p>

      {rows.length === 0 && <Empty label="Nothing unresolved — the queue is clear." />}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map((r) => (
          <div key={r.id} className="card" style={{ padding: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 15, fontWeight: 600 }}>{r.captured_name || '(no name captured)'}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 3 }}>
                {[r.captured_phone, r.captured_email].filter(Boolean).join(' · ') || 'no contact captured'}
                {(r.captured_phone2 || r.captured_email2) && <span style={{ color: 'var(--muted-2)' }}> · alt {[r.captured_phone2, r.captured_email2].filter(Boolean).join(' / ')}</span>}
              </div>
              <div style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 5 }}>
                {r.activity?.name || 'event'} · captured {fmtWhen(r.time_in)}
              </div>
            </div>
            <button className="btn btn-primary" style={{ padding: '8px 14px', fontSize: 13 }} onClick={() => setResolveFor(r)}>Resolve</button>
          </div>
        ))}
      </div>

      {resolveFor && (
        <ResolveDialog
          entry={resolveFor}
          me={me}
          onClose={() => setResolveFor(null)}
          onResolved={() => { setResolveFor(null); load() }}
          onToast={onToast}
        />
      )}
    </Pad>
  )
}

function ResolveDialog({ entry, me, onClose, onResolved, onToast }) {
  const [q, setQ] = useState(entry.captured_phone || entry.captured_email || entry.captured_name || '')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [busy, setBusy] = useState(false)
  const [mode, setMode] = useState('match') // 'match' | 'promote'

  const runSearch = useCallback(async (term) => {
    const t = (term ?? '').trim()
    if (t.length < 2) { setResults([]); return }
    setSearching(true)
    const digits = t.replace(/\D/g, '')
    let query = supabase.from('people').select('id, full_name, phone, email, is_volunteer, is_meditator').limit(12)
    query = digits.length >= 4 ? query.or(`phone.eq.${digits.slice(-10)},phone.ilike.%${digits}%`) : query.ilike('full_name', `%${t}%`)
    const { data } = await query
    setResults(data || [])
    setSearching(false)
  }, [])
  useEffect(() => { runSearch(q); /* eslint-disable-next-line */ }, [])

  // Re-link the SAME attendance row to a person. If that person already has attendance
  // for this event, that's a duplicate -> remove the unresolved row instead (don't inflate).
  async function linkTo(personId, personName) {
    setBusy(true)
    try {
      const { data: dup } = await supabase.from('attendance').select('id').eq('activity_id', entry.activity_id).eq('person_id', personId).maybeSingle()
      if (dup) {
        const { error: delErr } = await supabase.from('attendance').delete().eq('id', entry.id)
        if (delErr) throw delErr
        onToast?.(`${personName} was already present — removed the duplicate walk-in.`)
        onResolved?.()
        return
      }
      const { error } = await supabase.from('attendance').update({ person_id: personId }).eq('id', entry.id)
      if (error) throw error
      onToast?.(`Attendance linked to ${personName}.`)
      onResolved?.()
    } catch (e) {
      onToast?.('Could not link: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  async function promote() {
    setBusy(true)
    try {
      const { data: person, error: e1 } = await supabase
        .from('people')
        .insert({
          full_name: entry.captured_name || '(walk-in)',
          phone: last10(entry.captured_phone) || null,
          email: entry.captured_email || null,
          center_id: entry.activity?.center_id || 'unassigned',
          is_volunteer: true,
          source: 'event_walkin',
        })
        .select('id, full_name')
        .single()
      if (e1) throw e1
      const { error: e2 } = await supabase.from('attendance').update({ person_id: person.id }).eq('id', entry.id)
      if (e2) throw e2
      onToast?.(`Created provisional person ${person.full_name} and linked the attendance.`)
      onResolved?.()
    } catch (e) {
      onToast?.('Could not promote: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const inputStyle = { width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 12px', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box' }
  const tab = (k, label) => (
    <button onClick={() => setMode(k)} className="btn" style={{ padding: '7px 13px', fontSize: 12.5, background: mode === k ? '#241B14' : '#fff', color: mode === k ? '#F6ECDC' : 'var(--ink-soft)', border: mode === k ? 'none' : '1px solid var(--border)' }}>{label}</button>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 130, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 480, maxWidth: '100%', padding: 24, boxShadow: 'var(--shadow-lg)', maxHeight: '88vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 4px' }}>Resolve walk-in</h3>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>{entry.captured_name || '(no name)'} · {[entry.captured_phone, entry.captured_email].filter(Boolean).join(' · ') || 'no contact'}</div>
        <div style={{ fontSize: 12, color: 'var(--muted-2)', marginBottom: 16 }}>{entry.activity?.name}</div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          {tab('match', 'Match to existing')}
          {tab('promote', 'Promote to provisional')}
        </div>

        {mode === 'match' ? (
          <>
            <input value={q} onChange={(e) => { setQ(e.target.value); runSearch(e.target.value) }} placeholder="Search by name or phone…" style={{ ...inputStyle, marginBottom: 12 }} />
            {searching && <div style={{ fontSize: 13, color: 'var(--muted-2)', padding: '6px 0' }}>Searching…</div>}
            {!searching && q.trim().length >= 2 && results.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted-2)', padding: '6px 0' }}>No matches. Try the other tab to create a provisional person.</div>}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {results.map((p) => (
                <div key={p.id} className="rowhover" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#C2691F', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 600, flexShrink: 0 }}>{initials(p.full_name || '?')}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.full_name || '(no name)'}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.phone || 'no phone'}{p.is_volunteer ? ' · volunteer' : ''}{p.is_meditator ? ' · meditator' : ''}</div>
                  </div>
                  <button className="btn btn-primary" disabled={busy} onClick={() => linkTo(p.id, p.full_name)} style={{ padding: '7px 12px', fontSize: 12.5 }}>Link</button>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.55, marginBottom: 16 }}>
              Create a new <strong>provisional</strong> person from the captured details and link this attendance to it. Provenance is marked <code>event_walkin</code>; verify &amp; enrich later.
            </div>
            <div className="card" style={{ padding: 14, background: 'var(--panel)', fontSize: 13, marginBottom: 16 }}>
              <div><strong>{entry.captured_name || '(no name)'}</strong></div>
              <div style={{ color: 'var(--muted)', marginTop: 3 }}>{[last10(entry.captured_phone), entry.captured_email].filter(Boolean).join(' · ') || 'no contact captured'}</div>
            </div>
            <button className="btn btn-primary" disabled={busy} onClick={promote} style={{ width: '100%', padding: '12px', fontSize: 14 }}>{busy ? 'Creating…' : 'Create provisional person & link'}</button>
          </div>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 18 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
