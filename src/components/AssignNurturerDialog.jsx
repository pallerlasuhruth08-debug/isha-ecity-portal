import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { initials } from '../lib/ui'
import { pill } from '../lib/ui'
import { distribute, describeShare, DEFAULT_CAP } from '../lib/assignment'

// Bulk "Assign to nurturer" — the ONLY place group assignment happens (from the
// Volunteers/Meditators population screens). Writes nurturing_assignments (same table
// as single-add). Default pick list = nurturers in the same pincode(s) as the selected
// people. For each selected person: fill an existing ORPHANED active row (nurturer=null)
// if one exists, else insert a new active assignment. Multiple nurturers per person are
// allowed, so a person already covered just gets an additional row.
export default function AssignNurturerDialog({ personIds = [], label = '', me, onClose, onDone, onToast }) {
  const [nurturers, setNurturers] = useState([]) // {personId, full_name, pincode, is_poc, load}
  const [selPincodes, setSelPincodes] = useState(new Set())
  const [assignedBy, setAssignedBy] = useState(null)
  const [busy, setBusy] = useState(false)
  // People, keyed by pincode, so a split can put each person near a nurturer.
  const [cohort, setCohort] = useState(null)
  // 'one'   — everyone selected onto a single nurturer (the original behaviour)
  // 'split' — share the cohort out across the roster
  //
  // 'split' is the default the moment there are more people than one person could
  // reasonably hold. With 10 nurturers and 7,381 people on record, "all of them
  // onto one volunteer" was the only option this dialog offered, which is why the
  // centre's nurturing coverage was 1.
  const [mode, setMode] = useState('one')
  const [cap, setCap] = useState(DEFAULT_CAP)

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [tm, pp, mine, held] = await Promise.all([
        supabase.from('team_members').select('is_poc, person:people!team_members_person_id_fkey(id, full_name, pincode)').is('left_at', null),
        personIds.length ? supabase.from('people').select('id, pincode').in('id', personIds.slice(0, 1000)) : Promise.resolve({ data: [] }),
        me?.id ? supabase.from('nurturers').select('person_id').eq('profile_id', me.id).maybeSingle() : Promise.resolve({ data: null }),
        // What each nurturer already holds — a plan that ignores existing load just
        // moves the pile around.
        supabase.from('nurturing_assignments').select('nurturer_person_id').eq('active', true).not('nurturer_person_id', 'is', null),
      ])
      if (!alive) return
      const loadBy = {}
      for (const r of held.data || []) loadBy[r.nurturer_person_id] = (loadBy[r.nurturer_person_id] || 0) + 1
      const seen = new Set()
      const list = []
      for (const m of tm.data || []) {
        const p = m.person
        if (!p || seen.has(p.id)) continue
        seen.add(p.id)
        list.push({ personId: p.id, full_name: p.full_name, pincode: p.pincode, is_poc: m.is_poc, load: loadBy[p.id] || 0 })
      }
      setNurturers(list)
      setCohort(pp.data || [])
      setSelPincodes(new Set((pp.data || []).map((r) => r.pincode).filter(Boolean)))
      setAssignedBy(mine.data?.person_id || null)
      if (personIds.length > DEFAULT_CAP) setMode('split')
    })()
    return () => { alive = false }
  }, [personIds, me?.id])

  const plan = useMemo(
    () => (cohort ? distribute(cohort, nurturers, { cap }) : null),
    [cohort, nurturers, cap],
  )

  // Applies a whole plan. Same orphan-first rule as single assign, done once for
  // the entire cohort rather than per nurturer, so one pass over the orphan rows
  // serves every share.
  async function applyPlan() {
    if (!plan || !plan.plan.length) return
    setBusy(true)
    try {
      const { data: orphans } = await supabase
        .from('nurturing_assignments')
        .select('id, cared_person_id')
        .eq('active', true).is('nurturer_person_id', null)
        .in('cared_person_id', personIds)
      const orphanByPerson = Object.fromEntries((orphans || []).map((o) => [o.cared_person_id, o.id]))
      const stamp = new Date().toISOString()
      const inserts = []
      for (const share of plan.plan) {
        for (const pid of share.personIds) {
          if (orphanByPerson[pid]) {
            const { error } = await supabase.from('nurturing_assignments')
              .update({ nurturer_person_id: share.nurturer.personId, assigned_by: assignedBy || null, assigned_at: stamp })
              .eq('id', orphanByPerson[pid])
            if (error) throw error
          } else {
            inserts.push({ nurturer_person_id: share.nurturer.personId, cared_person_id: pid, active: true, assigned_by: assignedBy || null })
          }
        }
      }
      for (let i = 0; i < inserts.length; i += 500) {
        const { error } = await supabase.from('nurturing_assignments').insert(inserts.slice(i, i + 500))
        if (error) throw error
      }
      const placed = plan.plan.reduce((n, sh) => n + sh.personIds.length, 0)
      onToast(`Shared ${placed} across ${plan.plan.length} nurturer${plan.plan.length > 1 ? 's' : ''}${plan.unassigned.length ? ` · ${plan.unassigned.length} left over (nobody had room)` : ''}.`)
      onDone?.()
    } catch (e) {
      onToast('Could not assign: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

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
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{n.full_name}{n.is_poc && <span className="pill" style={{ ...pill('var(--success-bg)', 'var(--success-fg)'), marginLeft: 8 }}>POC</span>}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{n.pincode ? `pincode ${n.pincode}` : 'no pincode'}</div>
      </div>
    </button>
  )

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 140, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 470, maxWidth: '100%', padding: 24, maxHeight: '86vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 2px' }}>Assign to nurturer</h3>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>{personIds.length} {label || 'people'} · nurturers in the same pincode are offered first</div>

        {/* Two modes, because there are two genuinely different jobs. Handing one
            person to a specific nurturer is a decision. Placing four hundred is a
            distribution — and offering only the first is why nobody ever did the
            second. */}
        {personIds.length > 1 && nurturers.length > 1 && (
          <div style={{ display: 'flex', gap: 6, marginBottom: 14 }}>
            {[['split', 'Share across nurturers'], ['one', 'All to one nurturer']].map(([k, lab]) => (
              <button key={k} onClick={() => setMode(k)} aria-pressed={mode === k} className="btn"
                style={{ padding: '7px 13px', fontSize: 12.5, borderRadius: 'var(--radius-pill)', background: mode === k ? 'var(--sb-bg)' : '#fff', color: mode === k ? 'var(--sb-ink)' : 'var(--ink-soft)', border: mode === k ? 'none' : '1px solid var(--border)' }}>{lab}</button>
            ))}
          </div>
        )}

        {mode === 'split' && plan && (
          <div style={{ marginBottom: 4 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--ink-soft)', fontWeight: 600, marginBottom: 12 }}>
              At most
              <input type="number" min="1" max="500" value={cap}
                onChange={(e) => setCap(Math.max(1, Number(e.target.value) || 1))}
                style={{ width: 72, padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 13, fontFamily: 'inherit' }} />
              people each, including who they already hold
            </label>

            {plan.plan.length === 0 ? (
              <div className="card" style={{ padding: 14, fontSize: 13, background: 'var(--danger-bg)', borderColor: 'var(--danger-border)', color: 'var(--danger-fg)', marginBottom: 12 }}>
                Every nurturer is already at {cap}. Raise the cap, or add nurturers to the care group first.
              </div>
            ) : (
              <>
                {/* The plan is shown BEFORE it is applied. Assigning several hundred
                    people is not something anyone should confirm blind. */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
                  {plan.plan.map((sh) => (
                    <div key={sh.nurturer.personId} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 10, background: '#fff' }}>
                      <div style={{ width: 28, height: 28, borderRadius: '50%', background: '#C2691F', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10.5, fontWeight: 600, flexShrink: 0 }}>{initials(sh.nurturer.full_name || '?')}</div>
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sh.nurturer.full_name}</div>
                        <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{describeShare(sh)}{sh.nurturer.load ? ` · ${sh.nurturer.load} already` : ''}</div>
                      </div>
                    </div>
                  ))}
                </div>

                {plan.unassigned.length > 0 && (
                  <div className="card" style={{ padding: 12, fontSize: 12.5, background: 'var(--pill-warm-bg)', borderColor: 'var(--border)', color: 'var(--pill-warm-fg)', marginBottom: 12 }}>
                    <b>{plan.unassigned.length}</b> of {personIds.length} will be left over — the roster only has room for {plan.capacity}. They stay unassigned rather than being quietly piled onto someone.
                  </div>
                )}

                <button className="btn btn-primary" disabled={busy} onClick={applyPlan} style={{ width: '100%', justifyContent: 'center', padding: '11px' }}>
                  {busy ? 'Assigning…' : `Assign ${plan.plan.reduce((n, sh) => n + sh.personIds.length, 0)} across ${plan.plan.length} nurturer${plan.plan.length > 1 ? 's' : ''}`}
                </button>
              </>
            )}
          </div>
        )}

        {mode === 'one' && <>
        {same.length > 0 && <>
          <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: '#4E7C3F', fontWeight: 700, marginBottom: 8 }}>Same pincode</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>{same.map(row)}</div>
        </>}
        <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, marginBottom: 8 }}>{same.length ? 'Other nurturers' : 'Nurturers'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{rest.map(row)}</div>
        </>}
        {nurturers.length === 0 && <Empty />}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  )
}

function Empty() {
  return <div style={{ padding: 16, fontSize: 13, color: 'var(--muted-2)' }}>No nurturers on any team yet — add them in the Nurturing team view.</div>
}
