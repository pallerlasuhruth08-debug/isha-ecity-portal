import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { initials } from '../lib/ui'
import { pill } from '../lib/ui'

// Bulk "Assign to nurturer" — the ONLY place group assignment happens (from the
// Volunteers/Meditators population screens). Writes nurturing_assignments (same table
// as single-add). Default pick list = nurturers in the same pincode(s) as the selected
// people. For each selected person: fill an existing ORPHANED active row (nurturer=null)
// if one exists, else insert a new active assignment. Multiple nurturers per person are
// allowed, so a person already covered just gets an additional row.
export default function AssignNurturerDialog({ personIds = [], label = '', me, onClose, onDone, onToast }) {
  const [nurturers, setNurturers] = useState([]) // {personId, full_name, pincode, is_poc}
  const [selPincodes, setSelPincodes] = useState(new Set())
  const [assignedBy, setAssignedBy] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [tm, pp, mine] = await Promise.all([
        supabase.from('team_members').select('is_poc, person:people!team_members_person_id_fkey(id, full_name, pincode)').is('left_at', null),
        personIds.length ? supabase.from('people').select('pincode').in('id', personIds.slice(0, 1000)) : Promise.resolve({ data: [] }),
        me?.id ? supabase.from('nurturers').select('person_id').eq('profile_id', me.id).maybeSingle() : Promise.resolve({ data: null }),
      ])
      if (!alive) return
      const seen = new Set()
      const list = []
      for (const m of tm.data || []) {
        const p = m.person
        if (!p || seen.has(p.id)) continue
        seen.add(p.id)
        list.push({ personId: p.id, full_name: p.full_name, pincode: p.pincode, is_poc: m.is_poc })
      }
      setNurturers(list)
      setSelPincodes(new Set((pp.data || []).map((r) => r.pincode).filter(Boolean)))
      setAssignedBy(mine.data?.person_id || null)
    })()
    return () => { alive = false }
  }, [personIds, me?.id])

  const { same, rest } = useMemo(() => {
    const same = nurturers.filter((n) => n.pincode && selPincodes.has(n.pincode))
    const rest = nurturers.filter((n) => !(n.pincode && selPincodes.has(n.pincode)))
    return { same, rest }
  }, [nurturers, selPincodes])

  async function assign(nurturerPersonId, name) {
    if (!personIds.length) return
    setBusy(true)
    try {
      // Fill orphaned active rows where they exist; insert for the rest.
      const { data: orphans } = await supabase
        .from('nurturing_assignments')
        .select('id, cared_person_id')
        .eq('active', true).is('nurturer_person_id', null)
        .in('cared_person_id', personIds)
      const orphanByPerson = Object.fromEntries((orphans || []).map((o) => [o.cared_person_id, o.id]))
      const toUpdate = [], toInsert = []
      for (const pid of personIds) {
        if (orphanByPerson[pid]) toUpdate.push(orphanByPerson[pid])
        else toInsert.push({ nurturer_person_id: nurturerPersonId, cared_person_id: pid, active: true, assigned_by: assignedBy || null })
      }
      if (toUpdate.length) {
        for (let i = 0; i < toUpdate.length; i += 200) {
          const { error } = await supabase.from('nurturing_assignments')
            .update({ nurturer_person_id: nurturerPersonId, assigned_by: assignedBy || null, assigned_at: new Date().toISOString() })
            .in('id', toUpdate.slice(i, i + 200))
          if (error) throw error
        }
      }
      if (toInsert.length) {
        for (let i = 0; i < toInsert.length; i += 500) {
          const { error } = await supabase.from('nurturing_assignments').insert(toInsert.slice(i, i + 500))
          if (error) throw error
        }
      }
      onToast(`Assigned ${personIds.length} to ${name}${toUpdate.length ? ` (${toUpdate.length} reassigned from orphaned)` : ''}.`)
      onDone?.()
    } catch (e) {
      onToast('Could not assign: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const row = (n) => (
    <button key={n.personId} disabled={busy} onClick={() => assign(n.personId, n.full_name)} className="rowhover" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: '#fff', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
      <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#C2691F', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{initials(n.full_name || '?')}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{n.full_name}{n.is_poc && <span className="pill" style={{ ...pill('#EAF2E5', '#4E7C3F'), marginLeft: 8 }}>POC</span>}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{n.pincode ? `pincode ${n.pincode}` : 'no pincode'}</div>
      </div>
    </button>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 140, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 470, maxWidth: '100%', padding: 24, maxHeight: '86vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 2px' }}>Assign to nurturer</h3>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>{personIds.length} {label || 'people'} · nurturers in the same pincode are offered first</div>
        {same.length > 0 && <>
          <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: '#4E7C3F', fontWeight: 700, marginBottom: 8 }}>Same pincode</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>{same.map(row)}</div>
        </>}
        <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, marginBottom: 8 }}>{same.length ? 'Other nurturers' : 'Nurturers'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{rest.map(row)}</div>
        {nurturers.length === 0 && <Empty />}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  )
}

function Empty() {
  return <div style={{ padding: 16, fontSize: 13, color: 'var(--muted-2)' }}>No nurturers on any team yet — add them in the Nurturing team view.</div>
}
