import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { LOG_OUTCOMES, DEFAULT_OUTCOME, pillForOutcome, fmtWhen } from '../lib/calllog'

// Append-only log dialog, shared by caller + coordinator. Every save is a NEW
// call_logs row (never an update), stamped with logged_by = the actor. The history
// list shows each prior entry WITH its actor, so a coordinator's log is visibly
// attributed and never silently credited to the assigned caller.
export default function CallLogDialog({ journey, logs = [], actorNames = {}, myId, onClose, onSaved, onToast }) {
  const [outcome, setOutcome] = useState(DEFAULT_OUTCOME)
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    try {
      const { error } = await supabase.from('call_logs').insert({
        journey_id: journey.id,
        person_id: journey.person_id || null,
        reachability: outcome,
        remarks: note || null,
        logged_by: myId,
        // logged_at defaults to now()
      })
      if (error) throw error
      onToast?.(`Call with ${journey.person?.full_name || 'contact'} logged — ${outcome}.`)
      onSaved?.()
      onClose?.()
    } catch (e) {
      onToast?.('Could not log call: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const actorOf = (id) => (id ? actorNames[id] || 'Unknown' : '—')

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 120, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 440, maxWidth: '100%', padding: 24, boxShadow: 'var(--shadow-lg)', maxHeight: '86vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 4px' }}>Log call</h3>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>{journey.person?.full_name} · {journey.person?.phone || 'no phone on record'}</div>

        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#5C5142', marginBottom: 14 }}>
          Outcome
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} style={{ width: '100%', padding: '11px 12px', border: '1px solid var(--border)', borderRadius: 10, fontSize: 14, fontFamily: 'inherit', marginTop: 6, background: '#fff', color: 'var(--ink)', boxSizing: 'border-box' }}>
            {LOG_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </label>

        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#5C5142', marginBottom: 16 }}>
          Note (optional)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="What was said, next step, callback time…" style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', resize: 'vertical', marginTop: 6, boxSizing: 'border-box', lineHeight: 1.5 }} />
        </label>

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginBottom: logs.length ? 20 : 0 }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save log'}</button>
        </div>

        {logs.length > 0 && (
          <div style={{ borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <div style={{ fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, marginBottom: 10 }}>Call history</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {logs.map((l) => (
                <div key={l.id} style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                  <span className="pill" style={{ ...pillForOutcome(l.reachability), flexShrink: 0 }}>{l.reachability}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 11, color: 'var(--muted-2)' }}>{fmtWhen(l.logged_at)} · by {actorOf(l.logged_by)}</div>
                    {l.remarks && <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 2 }}>{l.remarks}</div>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
