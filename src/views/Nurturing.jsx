import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { initials, avatarFor, pill } from '../lib/ui'
import { Pad, ErrorCard, Loading, Empty } from '../components/View'
import PersonProfile from '../components/PersonProfile'
import { telHref, waHref } from '../lib/phone'
import { useBreakpoint } from '../lib/useBreakpoint'

// DISPLAY-ONLY drill-down over three separate tables (teams + team_members +
// nurturing_assignments over one people table): Teams → team roster → nurturer's held
// people. The ONLY assignment allowed here is SINGLE-add to the fixed nurturer (no
// picker). BULK/group assignment lives on Volunteers/Meditators. Held-people are joined
// for display, never stored on team_member.

const genderOf = (g) => ({ M: 'Male', F: 'Female', male: 'Male', female: 'Female' }[g] || g || '—')
const OVERDUE_DAYS = 30
const daysSince = (iso) => (iso ? Math.floor((Date.now() - new Date(iso).getTime()) / 86400000) : null)
const lastContactLabel = (iso) => {
  const d = daysSince(iso)
  if (d === null) return 'Never contacted'
  if (d <= 0) return 'Contacted today'
  if (d === 1) return 'Yesterday'
  if (d < 30) return `${d}d ago`
  return `${Math.round(d / 30)}mo ago`
}
const reach = (phone, isPhone) => {
  const t = telHref(phone)
  if (!t) return <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>no phone</span>
  const base = { padding: isPhone ? '10px 12px' : '5px 10px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border)', textDecoration: 'none', whiteSpace: 'nowrap', color: 'var(--ink-soft)', background: '#fff', minHeight: isPhone ? 44 : undefined, display: 'inline-flex', alignItems: 'center' }
  return (
    <span style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
      <a href={t} style={base}>Call</a>
      <a href={waHref(phone)} target="_blank" rel="noreferrer" style={base}>WhatsApp</a>
    </span>
  )
}

export default function Nurturing({ me, isCoordinator = false, onToast }) {
  const [teams, setTeams] = useState(null)
  const [teamId, setTeamId] = useState(null)     // null = teams list
  const [nurturerId, setNurturerId] = useState(null) // null = team roster
  const [profileId, setProfileId] = useState(null)
  const [err, setErr] = useState(null)

  const loadTeams = useCallback(async () => {
    try {
      const { data, error } = await supabase.from('teams').select('id, type, name').order('created_at')
      if (error) throw error
      // member counts
      const counts = {}
      const { data: tm } = await supabase.from('team_members').select('team_id').is('left_at', null)
      for (const r of tm || []) counts[r.team_id] = (counts[r.team_id] || 0) + 1
      setTeams((data || []).map((t) => ({ ...t, members: counts[t.id] || 0 })))
    } catch (e) { setErr(e.message || String(e)) }
  }, [])
  useEffect(() => { loadTeams() }, [loadTeams])

  if (err) return <Pad><ErrorCard>{err}</ErrorCard></Pad>
  if (!teams) return <Pad><Loading label="Loading teams…" /></Pad>

  // Level 3 — nurturer's held people
  if (teamId && nurturerId) {
    return (
      <>
        <NurturerDetail teamId={teamId} nurturerPersonId={nurturerId} me={me} onBack={() => setNurturerId(null)} onToast={onToast} onOpenProfile={setProfileId} />
        {profileId && <PersonProfile personId={profileId} me={me} onClose={() => setProfileId(null)} onToast={onToast} />}
      </>
    )
  }
  // Level 2 — team roster
  if (teamId) {
    return (
      <>
        <TeamDetail team={teams.find((t) => t.id === teamId)} isCoordinator={isCoordinator} onBack={() => setTeamId(null)} onOpenNurturer={setNurturerId} onToast={onToast} onOpenProfile={setProfileId} onRosterChanged={loadTeams} />
        {profileId && <PersonProfile personId={profileId} me={me} onClose={() => setProfileId(null)} onToast={onToast} />}
      </>
    )
  }
  // Level 1 — teams
  return (
    <Pad>
      <div className="mobile-hide" style={{ marginBottom: 18 }}>
        <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>Nurturing teams. Assignment happens on the Volunteers &amp; Meditators screens — this view is for oversight.</p>
      </div>
      {teams.length === 0 && <Empty label="No teams yet." />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 16 }}>
        {teams.map((t, i) => (
          <div key={t.id} className="card rowhover" onClick={() => setTeamId(t.id)} style={{ padding: 22, cursor: 'pointer' }}>
            <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>{t.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>{t.type}</div>
            <div style={{ paddingTop: 12, borderTop: '1px solid #F2EBDD', fontFamily: "'Newsreader',serif", fontSize: 24, fontWeight: 600 }}>{t.members}<span style={{ fontSize: 12, fontFamily: 'inherit', color: 'var(--muted-2)', fontWeight: 400 }}> nurturers</span></div>
          </div>
        ))}
      </div>
    </Pad>
  )
}

// ---- Level 2: team roster (name, gender, contact) + POC management ----
function TeamDetail({ team, isCoordinator, onBack, onOpenNurturer, onToast, onOpenProfile, onRosterChanged }) {
  const { isPhone } = useBreakpoint()
  const [members, setMembers] = useState(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])

  const load = useCallback(async () => {
    const { data } = await supabase.from('team_members')
      .select('id, is_poc, person:people!team_members_person_id_fkey(id, full_name, phone, gender, pincode)')
      .eq('team_id', team.id).is('left_at', null)
    setMembers(data || [])
  }, [team.id])
  useEffect(() => { load() }, [load])

  const memberIds = useMemo(() => new Set((members || []).map((m) => m.person?.id)), [members])
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setResults([]); return }
    let alive = true
    const t = setTimeout(async () => {
      const digits = term.replace(/\D/g, '')
      let query = supabase.from('people').select('id, full_name, phone, pincode').limit(12)
      query = digits.length >= 4 ? query.ilike('phone', `%${digits}%`) : query.ilike('full_name', `%${term}%`)
      const { data } = await query
      if (alive) setResults((data || []).filter((p) => !memberIds.has(p.id)))
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [q, memberIds])

  async function addMember(personId) {
    setBusy(true)
    try {
      const { error } = await supabase.from('team_members').insert({ team_id: team.id, person_id: personId, is_poc: false })
      if (error) throw error
      onToast('Added to team.'); setQ(''); setResults([]); load(); onRosterChanged?.()
    } catch (e) { onToast('Could not add: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function togglePoc(m) {
    setBusy(true)
    try {
      const { error } = await supabase.from('team_members').update({ is_poc: !m.is_poc }).eq('id', m.id)
      if (error) throw error
      onToast(m.is_poc ? 'POC removed.' : 'Marked POC.'); load()
    } catch (e) { onToast('Could not update: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function markLeft(m) {
    if (!window.confirm(`Remove ${m.person?.full_name} from the team? Their active people are orphaned back to a POC (found via the 'Needs a nurturer' filter on Volunteers/Meditators); nothing is deleted.`)) return
    setBusy(true)
    try {
      const { error: e1 } = await supabase.from('nurturing_assignments').update({ nurturer_person_id: null }).eq('nurturer_person_id', m.person.id).eq('active', true)
      if (e1) throw e1
      const { error: e2 } = await supabase.from('team_members').update({ left_at: new Date().toISOString() }).eq('id', m.id)
      if (e2) throw e2
      onToast(`${m.person?.full_name} left — their people are now unassigned.`); load(); onRosterChanged?.()
    } catch (e) { onToast('Could not remove: ' + (e.message || e)) } finally { setBusy(false) }
  }

  return (
    <Pad>
      <BackLink onClick={onBack} label="All teams" />
      <div className="card" style={{ padding: 22, marginBottom: 18 }}>
        <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 3px' }}>{team.name}</h2>
        <div style={{ fontSize: 14, color: 'var(--muted)' }}>{team.type} · {(members || []).length} nurturers</div>
      </div>

      {!members ? <Loading label="Loading roster…" /> : (
        <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
          {!isPhone && (
            <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.8fr 1.4fr auto', gap: 12, padding: '12px 20px', background: 'var(--panel)', borderBottom: '1px solid var(--border)', fontSize: 12, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700 }}>
              <span>Nurturer</span><span>Gender</span><span>Contact</span><span></span>
            </div>
          )}
          {members.map((m) => (
            isPhone ? (
              <div key={m.id} className="rowhover" style={{ padding: 14, borderBottom: '1px solid #F1E9DB' }}>
                <div onClick={() => onOpenNurturer(m.person?.id)} style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0, cursor: 'pointer' }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--green-2)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(m.person?.full_name || '?')}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{m.person?.full_name || 'Unknown'}{m.is_poc && <span className="pill" style={{ ...pill('#EAF2E5', '#4E7C3F'), marginLeft: 8 }}>POC</span>}</div>
                    <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 1 }}>{genderOf(m.person?.gender)} · {m.person?.phone || 'no phone'}{m.person?.pincode ? ` · ${m.person.pincode}` : ''}</div>
                    <div style={{ fontSize: 12, color: 'var(--orange)', marginTop: 2 }}>view held people →</div>
                  </div>
                </div>
                {isCoordinator && (
                  <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                    <button disabled={busy} onClick={() => togglePoc(m)} className="btn btn-ghost" style={{ fontSize: 12, padding: '9px 12px', minHeight: 44 }}>{m.is_poc ? 'Unset POC' : 'Make POC'}</button>
                    <button disabled={busy} onClick={() => markLeft(m)} style={{ fontSize: 12, padding: '9px 12px', borderRadius: 7, border: '1px solid #E7C9B8', background: '#fff', color: 'var(--red)', cursor: 'pointer', minHeight: 44 }}>Remove</button>
                  </div>
                )}
              </div>
            ) : (
              <div key={m.id} className="rowhover" style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.8fr 1.4fr auto', gap: 12, padding: '12px 20px', borderBottom: '1px solid #F1E9DB', alignItems: 'center' }}>
                <div onClick={() => onOpenNurturer(m.person?.id)} style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0, cursor: 'pointer' }}>
                  <div style={{ width: 34, height: 34, borderRadius: '50%', background: 'var(--green-2)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(m.person?.full_name || '?')}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{m.person?.full_name || 'Unknown'}{m.is_poc && <span className="pill" style={{ ...pill('#EAF2E5', '#4E7C3F'), marginLeft: 8 }}>POC</span>}</div>
                    <div style={{ fontSize: 12, color: 'var(--orange)' }}>view held people →</div>
                  </div>
                </div>
                <div style={{ fontSize: 14, color: 'var(--ink-soft)' }}>{genderOf(m.person?.gender)}</div>
                <div style={{ fontSize: 14, color: 'var(--ink-soft)' }}>{m.person?.phone || 'no phone'}{m.person?.pincode ? ` · ${m.person.pincode}` : ''}</div>
                {isCoordinator ? (
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                    <button disabled={busy} onClick={() => togglePoc(m)} className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }}>{m.is_poc ? 'Unset POC' : 'Make POC'}</button>
                    <button disabled={busy} onClick={() => markLeft(m)} style={{ fontSize: 12, padding: '5px 10px', borderRadius: 7, border: '1px solid #E7C9B8', background: '#fff', color: 'var(--red)', cursor: 'pointer' }}>Remove</button>
                  </div>
                ) : <span />}
              </div>
            )
          ))}
          {members.length === 0 && <div style={{ padding: 22 }}><Empty label="No nurturers on this team yet." /></div>}
        </div>
      )}

      {isCoordinator && (
        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 10px' }}>Add a nurturer to this team</h3>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a person by name or phone…" style={inputStyle} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
            {results.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 10 }}>
                <div><span style={{ fontSize: 14, fontWeight: 600 }}>{p.full_name}</span> <span style={{ fontSize: 12, color: 'var(--muted)' }}>{p.phone || 'no phone'}{p.pincode ? ` · ${p.pincode}` : ''}</span></div>
                <button disabled={busy} className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 11px' }} onClick={() => addMember(p.id)}>Add</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </Pad>
  )
}

// ---- Level 3: a nurturer's held people (+ single-add to THIS nurturer, no picker) ----
function NurturerDetail({ nurturerPersonId, me, onBack, onToast, onOpenProfile }) {
  const { isPhone } = useBreakpoint()
  const [nurturer, setNurturer] = useState(null)
  const [held, setHeld] = useState(null)
  const [lastContact, setLastContact] = useState({})
  const [assignedBy, setAssignedBy] = useState(null)
  const [busy, setBusy] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [logFor, setLogFor] = useState(null)

  useEffect(() => { if (me?.id) supabase.from('nurturers').select('person_id').eq('profile_id', me.id).maybeSingle().then(({ data }) => setAssignedBy(data?.person_id || null)) }, [me?.id])

  const load = useCallback(async () => {
    const [nRes, aRes] = await Promise.all([
      supabase.from('people').select('id, full_name, phone, gender, pincode').eq('id', nurturerPersonId).maybeSingle(),
      supabase.from('nurturing_assignments')
        .select('id, cared_person_id, assigned_at, cared:people!nurturing_assignments_cared_person_id_fkey(id, full_name, phone, gender, pincode)')
        .eq('nurturer_person_id', nurturerPersonId).eq('active', true),
    ])
    setNurturer(nRes.data || null)
    const asg = aRes.data || []
    setHeld(asg)
    const ids = asg.map((a) => a.cared_person_id)
    const lc = {}
    if (ids.length) {
      const { data: logs } = await supabase.from('call_logs').select('person_id, logged_at').eq('contact_source', 'nurturing').in('person_id', ids).order('logged_at', { ascending: false })
      for (const l of logs || []) if (!lc[l.person_id]) lc[l.person_id] = l.logged_at
    }
    setLastContact(lc)
  }, [nurturerPersonId])
  useEffect(() => { load() }, [load])

  const heldIds = useMemo(() => new Set((held || []).map((h) => h.cared_person_id)), [held])
  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setResults([]); return }
    let alive = true
    const t = setTimeout(async () => {
      const digits = term.replace(/\D/g, '')
      let query = supabase.from('people').select('id, full_name, phone, pincode').limit(12)
      query = digits.length >= 4 ? query.ilike('phone', `%${digits}%`) : query.ilike('full_name', `%${term}%`)
      const { data } = await query
      if (alive) setResults((data || []).filter((p) => !heldIds.has(p.id)))
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [q, heldIds])

  // Single-add: nurturer is fixed context, so no picker — just add the searched person.
  async function addToThisNurturer(personId, name) {
    setBusy(true)
    try {
      const { error } = await supabase.from('nurturing_assignments').insert({ nurturer_person_id: nurturerPersonId, cared_person_id: personId, active: true, assigned_by: assignedBy || null })
      if (error) throw error
      onToast(`${name} added to ${nurturer?.full_name}'s caseload.`); setQ(''); setResults([]); load()
    } catch (e) { onToast('Could not add: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function endCare(a) {
    if (!window.confirm(`End care of ${a.cared?.full_name}? The record is kept as history.`)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('nurturing_assignments').update({ active: false, ended_at: new Date().toISOString() }).eq('id', a.id)
      if (error) throw error
      onToast('Care ended (kept as history).'); load()
    } catch (e) { onToast('Could not end: ' + (e.message || e)) } finally { setBusy(false) }
  }

  return (
    <Pad>
      <BackLink onClick={onBack} label="Team roster" />
      <div className="card" style={{ padding: 22, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ width: 46, height: 46, borderRadius: '50%', background: avatarFor(1), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 600 }}>{initials(nurturer?.full_name || '?')}</div>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 2px' }}>{nurturer?.full_name || '…'}</h2>
          <div style={{ fontSize: 14, color: 'var(--muted)' }}>{genderOf(nurturer?.gender)} · {nurturer?.phone || 'no phone'}{nurturer?.pincode ? ` · ${nurturer.pincode}` : ''} · {(held || []).length} held</div>
        </div>
      </div>

      <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 10px' }}>People this nurturer is holding</h3>
      {!held ? <Loading label="Loading…" /> : (
        <div className="card" style={{ overflow: 'hidden', marginBottom: 18 }}>
          {held.length === 0 && <div style={{ padding: 22 }}><Empty label="No one assigned yet — add below, or bulk-assign from Volunteers/Meditators." /></div>}
          {held.map((a) => {
            const overdue = (daysSince(lastContact[a.cared_person_id]) ?? 9999) >= OVERDUE_DAYS
            if (isPhone) {
              return (
                <div key={a.id} className="rowhover" style={{ padding: 14, borderBottom: '1px solid #F1E9DB' }}>
                  <div onClick={() => onOpenProfile(a.cared?.id)} style={{ minWidth: 0, cursor: 'pointer' }}>
                    <div style={{ fontSize: 16, fontWeight: 600 }}>{a.cared?.full_name || 'Unknown'}</div>
                    <div style={{ fontSize: 12, color: overdue ? 'var(--red)' : 'var(--muted)', marginTop: 1 }}>{lastContactLabel(lastContact[a.cared_person_id])}{overdue ? ' · overdue' : ''}</div>
                    <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>{genderOf(a.cared?.gender)} · {a.cared?.phone || 'no phone'}{a.cared?.pincode ? ` · ${a.cared.pincode}` : ''}</div>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                    {reach(a.cared?.phone, true)}
                    <button className="btn btn-primary" style={{ padding: '9px 16px', fontSize: 12, minHeight: 44 }} onClick={() => setLogFor(a)}>Log</button>
                    <button title="End care" onClick={() => endCare(a)} disabled={busy} style={{ padding: '9px 12px', fontSize: 12, borderRadius: 7, border: '1px solid #E7C9B8', background: '#fff', color: 'var(--red)', cursor: 'pointer', marginLeft: 'auto', minHeight: 44 }}>✕ End</button>
                  </div>
                </div>
              )
            }
            return (
              <div key={a.id} className="rowhover" style={{ display: 'grid', gridTemplateColumns: '1.6fr 0.8fr 1.4fr auto', gap: 12, padding: '12px 20px', borderBottom: '1px solid #F1E9DB', alignItems: 'center' }}>
                <div onClick={() => onOpenProfile(a.cared?.id)} style={{ minWidth: 0, cursor: 'pointer' }}>
                  <div style={{ fontSize: 16, fontWeight: 600 }}>{a.cared?.full_name || 'Unknown'}</div>
                  <div style={{ fontSize: 12, color: overdue ? 'var(--red)' : 'var(--muted)' }}>{lastContactLabel(lastContact[a.cared_person_id])}{overdue ? ' · overdue' : ''}</div>
                </div>
                <div style={{ fontSize: 14, color: 'var(--ink-soft)' }}>{genderOf(a.cared?.gender)}</div>
                <div style={{ fontSize: 14, color: 'var(--ink-soft)' }}>{a.cared?.phone || 'no phone'}{a.cared?.pincode ? ` · ${a.cared.pincode}` : ''}</div>
                <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', alignItems: 'center' }}>
                  {reach(a.cared?.phone, false)}
                  <button className="btn btn-primary" style={{ padding: '5px 10px', fontSize: 12 }} onClick={() => setLogFor(a)}>Log</button>
                  <button title="End care" onClick={() => endCare(a)} disabled={busy} style={{ padding: '5px 8px', fontSize: 12, borderRadius: 7, border: '1px solid #E7C9B8', background: '#fff', color: 'var(--red)', cursor: 'pointer' }}>✕</button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Single-add to THIS nurturer — no nurturer-picker (nurturer is the context). */}
      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 3px' }}>Add a person to this nurturer</h3>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 10 }}>Single add. For a group, use “Assign to nurturer” on the Volunteers/Meditators screens.</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a person by name or phone…" style={inputStyle} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
          {results.map((p) => (
            <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 10 }}>
              <div><span style={{ fontSize: 13.5, fontWeight: 600 }}>{p.full_name}</span> <span style={{ fontSize: 12, color: 'var(--muted)' }}>{p.phone || 'no phone'}{p.pincode ? ` · ${p.pincode}` : ''}</span></div>
              <button disabled={busy} className="btn btn-primary" style={{ fontSize: 12, padding: '5px 11px' }} onClick={() => addToThisNurturer(p.id, p.full_name)}>Add to this nurturer</button>
            </div>
          ))}
        </div>
      </div>

      {logFor && <NurturingLog assignment={logFor} loggedBy={assignedBy} onClose={() => setLogFor(null)} onSaved={() => { setLogFor(null); load() }} onToast={onToast} />}
    </Pad>
  )
}

function NurturingLog({ assignment, loggedBy, onClose, onSaved, onToast }) {
  const [outcome, setOutcome] = useState('Reached')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      const { error } = await supabase.from('call_logs').insert({
        person_id: assignment.cared_person_id, nurturing_assignment_id: assignment.id, journey_id: null,
        contact_source: 'nurturing', reachability: outcome, remarks: note || null, logged_by: loggedBy || null,
      })
      if (error) throw error
      onToast(`Logged nurturing contact with ${assignment.cared?.full_name || 'person'}.`); onSaved()
    } catch (e) { onToast('Could not log: ' + (e.message || e)) } finally { setBusy(false) }
  }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 140, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 420, maxWidth: '100%', padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 4px' }}>Log nurturing contact</h3>
        <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 16 }}>{assignment.cared?.full_name} · {assignment.cared?.phone || 'no phone'}</div>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 14 }}>Outcome
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} style={{ ...inputStyle, marginTop: 6 }}>
            {['Reached', 'No answer', 'Call back', 'Doing well', 'Needs support'].map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 16 }}>Note (optional)
          <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} style={{ ...inputStyle, marginTop: 6, resize: 'vertical' }} />
        </label>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  )
}

function BackLink({ onClick, label }) {
  return (
    <div onClick={onClick} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 14, fontWeight: 600, color: 'var(--orange)', cursor: 'pointer', marginBottom: 16 }}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
      {label}
    </div>
  )
}

const inputStyle = { width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: '#fff', color: 'var(--ink)' }
