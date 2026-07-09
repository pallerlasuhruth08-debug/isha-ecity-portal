import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pill } from '../lib/ui'
import { fmtDay } from '../lib/planning'

// Create a team = create an ACTIVITY BLOCK on this event (one source of truth).
// Shared by the Teams tab and the Planning to-do launchers. onCreated(blockId) fires
// with the new block id so a caller can link it back (e.g. check off a to-do).
export default function CreateTeamForm({ ev, types = [], firstDay, me, onClose, onCreated, onToast }) {
  const [localTypes, setLocalTypes] = useState([])
  const [typeId, setTypeId] = useState('')
  const [name, setName] = useState('')
  const [nameEdited, setNameEdited] = useState(false)
  const [needed, setNeeded] = useState(4)
  const [phaseId, setPhaseId] = useState('')
  const [phases, setPhases] = useState([])
  const [leadQ, setLeadQ] = useState('')
  const [leadResults, setLeadResults] = useState([])
  const [lead, setLead] = useState(null) // { id, full_name }
  const [addingType, setAddingType] = useState(false)
  const [newType, setNewType] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    supabase.from('event_phases').select('id, label, kind, start_by, finish_by').eq('activity_id', ev.id).order('sort_order')
      .then(({ data }) => setPhases(data || []))
  }, [ev.id])
  useEffect(() => {
    if (leadQ.trim().length < 2) { setLeadResults([]); return }
    const h = setTimeout(async () => {
      const { data } = await supabase.from('people').select('id, full_name').ilike('full_name', `%${leadQ.trim()}%`).limit(6)
      setLeadResults(data || [])
    }, 300)
    return () => clearTimeout(h)
  }, [leadQ])

  const allTypes = [...types, ...localTypes].filter((t) => (t.kind || 'volunteer') === 'volunteer' && t.active !== false)
  const autoName = allTypes.find((t) => t.id === typeId)?.label || 'Team'
  const effName = nameEdited && name.trim() ? name.trim() : autoName

  async function createType() {
    const label = newType.trim()
    if (!label) return
    setBusy(true)
    try {
      const { data, error } = await supabase.from('activity_types').insert({ label, kind: 'volunteer' }).select('id, label, kind, active').single()
      if (error) throw error
      setLocalTypes((l) => [...l, data]); setTypeId(data.id); setNewType(''); setAddingType(false)
      onToast(`Activity type "${label}" added.`)
    } catch (e) { onToast('Could not add type: ' + (e.message || e)) } finally { setBusy(false) }
  }

  async function create() {
    if (!typeId) return onToast('Pick an activity type.')
    setBusy(true)
    try {
      const { data: blk, error } = await supabase.from('activity_blocks').insert({
        activity_id: ev.id, heading: effName, activity_type_id: typeId, volunteers_needed: Number(needed) || 0,
        phase_id: phaseId || null, recruiting_method: 'manual', attendance_mode: 'per_day', created_by: me?.id || null,
      }).select('id').single()
      if (error) throw error
      if (lead) {
        await supabase.from('block_assignments').insert({ block_id: blk.id, person_id: lead.id, day_date: firstDay, status: 'assigned', is_poc: true, assigned_by: me?.id || null })
      }
      onToast(`Team "${effName}" created.`)
      onCreated(blk.id)
    } catch (e) { onToast('Could not create team: ' + (e.message || e)) } finally { setBusy(false) }
  }

  const lbl = { fontSize: 12, fontWeight: 600, color: '#5C5142', display: 'block', marginBottom: 5 }
  const fld = { fontSize: 13, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 9, background: '#fff', color: 'var(--ink)', width: '100%' }

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 130, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 480, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 22, boxShadow: 'var(--shadow-lg)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Create team</h3>
          <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={onClose}>✕ Close</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>A team is an activity block on {ev.name}. Dates come from the phase; mode is set in Planning.</div>

        <div style={{ marginBottom: 14 }}>
          <span style={lbl}>Activity <span style={{ fontWeight: 400, color: 'var(--muted-2)' }}>· shared list</span></span>
          {addingType ? (
            <div style={{ display: 'flex', gap: 8 }}>
              <input autoFocus value={newType} onChange={(e) => setNewType(e.target.value)} placeholder="New activity (e.g. Kitchen)" onKeyDown={(e) => e.key === 'Enter' && createType()} style={fld} />
              <button className="btn btn-primary" disabled={busy || !newType.trim()} onClick={createType} style={{ fontSize: 12.5, padding: '8px 12px' }}>Add</button>
              <button className="btn btn-ghost" onClick={() => { setAddingType(false); setNewType('') }} style={{ fontSize: 12.5, padding: '8px 10px' }}>Cancel</button>
            </div>
          ) : (
            <div style={{ display: 'flex', gap: 8 }}>
              <select value={typeId} onChange={(e) => setTypeId(e.target.value)} style={fld}>
                <option value="">— pick activity —</option>
                {allTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <button className="btn btn-ghost" onClick={() => setAddingType(true)} style={{ fontSize: 12.5, padding: '8px 12px', whiteSpace: 'nowrap' }}>＋ New</button>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 130 }}>
            <span style={lbl}>Team name</span>
            <input value={nameEdited ? name : autoName} onChange={(e) => { setName(e.target.value); setNameEdited(true) }} placeholder={autoName} style={fld} />
          </div>
          <div style={{ width: 110 }}>
            <span style={lbl}>Size needed</span>
            <input type="number" min={0} value={needed} onChange={(e) => setNeeded(e.target.value)} style={fld} />
          </div>
        </div>

        {phases.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <span style={lbl}>Phase <span style={{ fontWeight: 400, color: 'var(--muted-2)' }}>· carries the dates</span></span>
            <select value={phaseId} onChange={(e) => setPhaseId(e.target.value)} style={fld}>
              <option value="">— unphased (event span) —</option>
              {phases.map((p) => <option key={p.id} value={p.id}>{p.label}{p.start_by ? ` · ${fmtDay(p.start_by)}${p.finish_by && p.finish_by !== p.start_by ? `–${fmtDay(p.finish_by)}` : ''}` : ''}</option>)}
            </select>
          </div>
        )}

        <div style={{ marginBottom: 18, position: 'relative' }}>
          <span style={lbl}>Lead / POC <span style={{ fontWeight: 400, color: 'var(--muted-2)' }}>· optional</span></span>
          {lead ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span className="pill" style={pill('#F3E3D2', '#9C4A14')}>{lead.full_name}</span>
              <button className="btn btn-ghost" style={{ fontSize: 12 }} onClick={() => setLead(null)}>Change</button>
            </div>
          ) : (
            <>
              <input value={leadQ} onChange={(e) => setLeadQ(e.target.value)} placeholder="Search a person…" style={fld} />
              {leadResults.length > 0 && (
                <div className="card" style={{ position: 'absolute', top: 62, left: 0, right: 0, zIndex: 20, boxShadow: 'var(--shadow-lg)', padding: 6 }}>
                  {leadResults.map((p) => (
                    <div key={p.id} className="rowhover" style={{ padding: '7px 9px', borderRadius: 8, cursor: 'pointer', fontSize: 13 }} onClick={() => { setLead(p); setLeadQ(''); setLeadResults([]) }}>{p.full_name}</div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <button className="btn btn-primary" disabled={busy || !typeId} onClick={create} style={{ width: '100%', padding: '12px', fontSize: 14, opacity: busy || !typeId ? 0.55 : 1 }}>
          {busy ? 'Creating…' : 'Create team'}
        </button>
      </div>
    </div>
  )
}
