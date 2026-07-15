import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pill } from '../lib/ui'
import { Loading, Empty } from './View'

// Pick-a-team modal for bulk "Assign to team" actions (Volunteer Interests and the
// Teams tab's Unassigned Volunteers list both use this) — lists this event's teams
// with a live fill count; clicking one assigns the caller's current selection.
export default function AssignToTeamModal({ eventId, busy, onClose, onPick }) {
  const [teams, setTeams] = useState(null)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const { data: bl } = await supabase.from('activity_blocks').select('id, heading, volunteers_needed, locked_at').eq('activity_id', eventId).is('archived_at', null).order('created_at')
      const blocks = bl || []
      const ids = blocks.map((b) => b.id)
      const filledByBlock = {}
      if (ids.length) {
        const { data: asg } = await supabase.from('block_assignments').select('block_id, status').in('block_id', ids)
        for (const a of asg || []) {
          if (!['assigned', 'show', 'involved'].includes(a.status)) continue
          filledByBlock[a.block_id] = (filledByBlock[a.block_id] || 0) + 1
        }
      }
      if (alive) setTeams(blocks.map((b) => ({ ...b, filled: filledByBlock[b.id] || 0 })))
    })()
    return () => { alive = false }
  }, [eventId])

  return (
    <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 130, padding: 20 }} onClick={onClose}>
      <div className="card modal-sheet" style={{ width: 420, maxWidth: '100%', maxHeight: '80vh', overflowY: 'auto', padding: 22, boxShadow: 'var(--shadow-lg)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Assign to team</h3>
          <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={onClose}>✕ Close</button>
        </div>
        {!teams ? <Loading label="Loading teams…" /> : teams.length === 0 ? <Empty label="No teams yet — create one in the Teams tab first." /> : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {teams.map((t) => {
              const full = t.filled >= (t.volunteers_needed || 0)
              const isLocked = !!t.locked_at
              return (
                <button key={t.id} disabled={busy || isLocked} onClick={() => onPick(t)} className={isLocked ? undefined : 'rowhover tap44'}
                  title={isLocked ? 'Locked — unlock this team to assign into it' : undefined}
                  style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 9, border: '1px solid var(--border)', background: isLocked ? 'var(--panel)' : '#fff', cursor: isLocked ? 'not-allowed' : (busy ? 'default' : 'pointer'), textAlign: 'left', opacity: busy || isLocked ? 0.6 : 1 }}>
                  <span style={{ fontSize: 14, fontWeight: 600 }}>{isLocked && '🔒 '}{t.heading}</span>
                  <span className="pill" style={full ? pill('#EAF2E5', '#4E7C3F') : pill('#FBEAD9', '#C2691F')}>{t.filled}/{t.volunteers_needed || 0}{full ? ' · full' : ''}</span>
                </button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
