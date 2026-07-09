import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pill } from '../lib/ui'
import { phaseChipLabel } from '../lib/planning'

// Create a team = create an ACTIVITY BLOCK on this event (one source of truth).
// Shared by the Teams tab and the Planning to-do launchers. onCreated(blockId) fires
// with the new block id so a caller can link it back (e.g. check off a to-do).
export default function CreateTeamForm({ ev, types = [], firstDay, me, block = null, onClose, onCreated, onToast }) {
  const editing = !!block
  const [localTypes, setLocalTypes] = useState([])
  const [typeId, setTypeId] = useState(block?.activity_type_id || '')
  const [name, setName] = useState(block?.heading || '')
  const [nameEdited, setNameEdited] = useState(!!block)
  const [needed, setNeeded] = useState(block?.volunteers_needed ?? 4)
  const [phaseIds, setPhaseIds] = useState([]) // multi-phase (block_phases junction)
  const [phases, setPhases] = useState([])
  const [attnLocked, setAttnLocked] = useState(false) // team has captured attendance → activity_type locked
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
  // Edit mode: load the team's current phases + whether it has captured attendance
  // (marked assignment or event-level rows) — which locks the activity_type.
  useEffect(() => {
    if (!block) return
    supabase.from('block_phases').select('phase_id').eq('block_id', block.id)
      .then(({ data }) => setPhaseIds((data || []).map((r) => r.phase_id)))
    ;(async () => {
      const { count: attCount } = await supabase.from('attendance').select('id', { count: 'exact', head: true }).eq('block_id', block.id)
      const { data: asg } = await supabase.from('block_assignments').select('status').eq('block_id', block.id)
      const marked = (asg || []).some((a) => ['show', 'no_show', 'involved'].includes(a.status))
      setAttnLocked((attCount || 0) > 0 || marked)
    })()
  }, [block])

  const togglePhase = (id) => setPhaseIds((cur) => cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
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

  // Sync the block_phases junction to the selected phase set.
  async function syncPhases(blockId) {
    await supabase.from('block_phases').delete().eq('block_id', blockId)
    if (phaseIds.length) await supabase.from('block_phases').insert(phaseIds.map((pid) => ({ block_id: blockId, phase_id: pid })))
  }

  async function create() {
    if (!typeId) return onToast('Pick an activity type.')
    setBusy(true)
    try {
      const primaryPhase = phaseIds[0] || null // legacy phase_id mirrors the first selected phase
      if (editing) {
        // activity_type is LOCKED once attendance exists — never rewrite it here.
        const patch = { heading: effName, volunteers_needed: Number(needed) || 0, phase_id: primaryPhase }
        if (!attnLocked) patch.activity_type_id = typeId
        const { error } = await supabase.from('activity_blocks').update(patch).eq('id', block.id)
        if (error) throw error
        await syncPhases(block.id)
        onToast(`Team "${effName}" updated.`)
        onCreated(block.id)
        return
      }
      const { data: blk, error } = await supabase.from('activity_blocks').insert({
        activity_id: ev.id, heading: effName, activity_type_id: typeId, volunteers_needed: Number(needed) || 0,
        phase_id: primaryPhase, recruiting_method: 'manual', attendance_mode: 'per_day', created_by: me?.id || null,
      }).select('id').single()
      if (error) throw error
      await syncPhases(blk.id)
      if (lead) {
        await supabase.from('block_assignments').insert({ block_id: blk.id, person_id: lead.id, day_date: firstDay, status: 'assigned', is_poc: true, assigned_by: me?.id || null })
      }
      onToast(`Team "${effName}" created.`)
      onCreated(blk.id)
    } catch (e) { onToast(`Could not ${editing ? 'update' : 'create'} team: ` + (e.message || e)) } finally { setBusy(false) }
  }

  const lbl = { fontSize: 12, fontWeight: 600, color: '#5C5142', display: 'block', marginBottom: 5 }
  const fld = { fontSize: 13, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 9, background: '#fff', color: 'var(--ink)', width: '100%' }

  return (
    <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 130, padding: 20 }} onClick={onClose}>
      <div className="card modal-sheet" style={{ width: 480, maxWidth: '100%', maxHeight: '90vh', overflowY: 'auto', padding: 22, boxShadow: 'var(--shadow-lg)' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>{editing ? 'Edit team' : 'Create team'}</h3>
          <button className="btn btn-ghost" style={{ fontSize: 13 }} onClick={onClose}>✕ Close</button>
        </div>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>A team is an activity block on {ev.name}. Dates come from the phase; mode is set in Planning.</div>

        {/* Order: Team Name → Activity Type → Size → Phase(s) */}
        <div style={{ marginBottom: 14 }}>
          <span style={lbl}>Team name</span>
          <input value={nameEdited ? name : autoName} onChange={(e) => { setName(e.target.value); setNameEdited(true) }} placeholder={autoName} style={fld} />
        </div>

        <div style={{ marginBottom: 14 }}>
          <span style={lbl}>Activity type <span style={{ fontWeight: 400, color: 'var(--muted-2)' }}>· shared list</span></span>
          {attnLocked ? (
            <>
              <select value={typeId} disabled style={{ ...fld, opacity: 0.6, cursor: 'not-allowed' }}>
                {allTypes.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <div style={{ fontSize: 11.5, color: '#9C4A14', marginTop: 5 }}>🔒 Locked — this team has captured attendance. Changing its activity type would rewrite that participation history.</div>
            </>
          ) : addingType ? (
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

        <div style={{ marginBottom: 14, width: 130 }}>
          <span style={lbl}>Size needed</span>
          <input type="number" min={0} value={needed} onChange={(e) => setNeeded(e.target.value)} style={fld} />
        </div>

        {phases.length > 0 && (
          <div style={{ marginBottom: 14 }}>
            <span style={lbl}>Phase(s) <span style={{ fontWeight: 400, color: 'var(--muted-2)' }}>· a team can span several</span></span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {phases.map((p) => (
                <label key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, cursor: 'pointer', padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 8, background: phaseIds.includes(p.id) ? '#F6E8D8' : '#fff' }}>
                  <input type="checkbox" checked={phaseIds.includes(p.id)} onChange={() => togglePhase(p.id)} />
                  {phaseChipLabel(p)}
                </label>
              ))}
            </div>
          </div>
        )}

        {!editing && (
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
        )}

        <button className="btn btn-primary" disabled={busy || !typeId} onClick={create} style={{ width: '100%', padding: '12px', fontSize: 14, opacity: busy || !typeId ? 0.55 : 1 }}>
          {busy ? (editing ? 'Saving…' : 'Creating…') : (editing ? 'Save changes' : 'Create team')}
        </button>
      </div>
    </div>
  )
}
