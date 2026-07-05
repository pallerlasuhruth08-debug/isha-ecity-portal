import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { initials, avatarFor, pill } from '../lib/ui'
import { Pad, ErrorCard, Loading, Empty } from '../components/View'
import SidePanel, { PanelHeader } from '../components/SidePanel'
import PersonProfile from '../components/PersonProfile'
import { telHref, waHref } from '../lib/phone'

// Nurturing = durable nurturer→person CARE, structured over the ONE people table:
//   teams + team_members (POC = a member with powers) and nurturing_assignments.
// This is a standing CASELOAD view, NOT a campaign. Contact logged here is written to
// the unified call-history tagged contact_source='nurturing'.

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

export default function Nurturing({ me, isCoordinator = false, onToast }) {
  const [teams, setTeams] = useState([])
  const [teamId, setTeamId] = useState('')
  const [tab, setTab] = useState('caseloads') // caseloads | assign | team
  const [members, setMembers] = useState([]) // team_members (+person)
  const [assignments, setAssignments] = useState([]) // active nurturing_assignments (+nurturer/cared)
  const [lastContact, setLastContact] = useState({}) // cared_person_id -> latest nurturing logged_at
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(true)

  const [caseloadFor, setCaseloadFor] = useState(null) // nurturer person for the caseload panel
  const [profileId, setProfileId] = useState(null)
  const [myPersonId, setMyPersonId] = useState(null) // POC person (this coordinator) if resolvable

  // Resolve the acting coordinator to a person (for assigned_by), via nurturers.profile_id.
  useEffect(() => {
    if (!me?.id) return
    supabase.from('nurturers').select('person_id').eq('profile_id', me.id).maybeSingle().then(({ data }) => setMyPersonId(data?.person_id || null))
  }, [me?.id])

  useEffect(() => {
    supabase.from('teams').select('id, type, name').order('created_at').then(({ data }) => {
      setTeams(data || [])
      if (data?.length && !teamId) setTeamId(data[0].id)
    })
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    if (!teamId) return
    setLoading(true)
    setErr(null)
    try {
      const [mRes, aRes] = await Promise.all([
        supabase.from('team_members')
          .select('id, is_poc, joined_at, person:people!team_members_person_id_fkey(id, full_name, phone, pincode, center_id)')
          .eq('team_id', teamId).is('left_at', null),
        supabase.from('nurturing_assignments')
          .select('id, nurturer_person_id, cared_person_id, assigned_at, nurturer:people!nurturing_assignments_nurturer_person_id_fkey(id, full_name, phone), cared:people!nurturing_assignments_cared_person_id_fkey(id, full_name, phone, pincode)')
          .eq('active', true),
      ])
      if (mRes.error) throw mRes.error
      if (aRes.error) throw aRes.error
      const asg = aRes.data || []
      setMembers(mRes.data || [])
      setAssignments(asg)
      // latest nurturing contact per cared person
      const caredIds = [...new Set(asg.map((a) => a.cared_person_id))]
      const lc = {}
      if (caredIds.length) {
        const { data: logs } = await supabase.from('call_logs')
          .select('person_id, logged_at').eq('contact_source', 'nurturing').in('person_id', caredIds)
          .order('logged_at', { ascending: false })
        for (const l of logs || []) if (!lc[l.person_id]) lc[l.person_id] = l.logged_at
      }
      setLastContact(lc)
    } catch (e) { setErr(e.message || String(e)) } finally { setLoading(false) }
  }, [teamId])
  useEffect(() => { load() }, [load])

  const memberByPerson = useMemo(() => Object.fromEntries(members.map((m) => [m.person?.id, m])), [members])
  const nurturerPersonIds = useMemo(() => new Set(members.map((m) => m.person?.id)), [members])
  // Active nurturers = team members (they carry caseloads).
  const caseByNurturer = useMemo(() => {
    const map = {}
    for (const a of assignments) {
      if (!a.nurturer_person_id) continue
      ;(map[a.nurturer_person_id] ||= []).push(a)
    }
    return map
  }, [assignments])
  const orphaned = useMemo(() => assignments.filter((a) => !a.nurturer_person_id), [assignments])
  const isOverdue = (caredId) => (daysSince(lastContact[caredId]) ?? 9999) >= OVERDUE_DAYS

  const team = teams.find((t) => t.id === teamId)
  const tabBtn = (k, label, n) => (
    <button key={k} onClick={() => setTab(k)} className="btn" style={{ padding: '8px 14px', fontSize: 13, background: tab === k ? '#241B14' : '#fff', color: tab === k ? '#F6ECDC' : 'var(--ink-soft)', border: tab === k ? 'none' : '1px solid var(--border)' }}>
      {label}{n != null && <span style={{ opacity: 0.6 }}> {n}</span>}
    </button>
  )

  return (
    <Pad>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 3px' }}>Nurturing & Care</h2>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)' }}>Durable nurturer caseloads — a standing structure, not a campaign.</p>
        </div>
        {teams.length > 1 && (
          <select value={teamId} onChange={(e) => setTeamId(e.target.value)} style={{ padding: '8px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 13, background: '#fff' }}>
            {teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 18, flexWrap: 'wrap' }}>
        {tabBtn('caseloads', 'Caseloads', members.length)}
        {tabBtn('assign', 'Assign', orphaned.length ? `· ${orphaned.length} orphaned` : null)}
        {tabBtn('team', 'Team', null)}
      </div>

      {err && <ErrorCard>Couldn't load nurturing: {err}</ErrorCard>}
      {loading && <Loading label="Loading nurturing…" />}

      {!loading && tab === 'caseloads' && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 16 }}>
          {members.length === 0 && <Empty label="No nurturers on this team yet — add them in the Team tab." />}
          {members.map((m, i) => {
            const cases = caseByNurturer[m.person?.id] || []
            const overdue = cases.filter((c) => isOverdue(c.cared_person_id)).length
            return (
              <div key={m.id} className="card rowhover" onClick={() => setCaseloadFor(m.person)} style={{ padding: 20, cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
                  <div style={{ width: 42, height: 42, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 600, flexShrink: 0 }}>{initials(m.person?.full_name || '?')}</div>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ fontSize: 14.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.person?.full_name || 'Unknown'}{m.is_poc && <span className="pill" style={{ ...pill('#EAF2E5', '#4E7C3F'), marginLeft: 8 }}>POC</span>}</div>
                    <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{m.person?.phone || 'No phone'}{m.person?.pincode ? ` · ${m.person.pincode}` : ''}</div>
                  </div>
                </div>
                <div style={{ display: 'flex', gap: 22, paddingTop: 12, borderTop: '1px solid #F2EBDD' }}>
                  <Stat v={cases.length} label="in caseload" />
                  <Stat v={overdue} label="overdue" color={overdue ? '#B5532F' : '#4E7C3F'} />
                </div>
              </div>
            )
          })}
        </div>
      )}

      {!loading && tab === 'assign' && (
        <AssignTab
          team={team} members={members} assignments={assignments} orphaned={orphaned}
          nurturerPersonIds={nurturerPersonIds} assignedBy={myPersonId} isCoordinator={isCoordinator}
          onChanged={load} onToast={onToast} onOpenProfile={setProfileId}
        />
      )}

      {!loading && tab === 'team' && (
        <TeamTab team={team} members={members} isCoordinator={isCoordinator} onChanged={load} onToast={onToast} onOpenProfile={setProfileId} />
      )}

      {caseloadFor && (
        <CaseloadPanel
          nurturer={caseloadFor} cases={caseByNurturer[caseloadFor.id] || []} lastContact={lastContact}
          members={members} assignedBy={myPersonId} onClose={() => setCaseloadFor(null)} onChanged={load} onToast={onToast} onOpenProfile={setProfileId}
        />
      )}
      {profileId && <PersonProfile personId={profileId} onClose={() => setProfileId(null)} onToast={onToast} onChanged={load} />}
    </Pad>
  )
}

function Stat({ v, label, color }) {
  return (
    <div>
      <div style={{ fontFamily: "'Newsreader',serif", fontSize: 22, fontWeight: 600, lineHeight: 1, color: color || 'var(--ink)' }}>{v}</div>
      <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 3 }}>{label}</div>
    </div>
  )
}

const reach = (phone) => {
  const t = telHref(phone), w = waHref(phone)
  const base = { padding: '5px 10px', fontSize: 11.5, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border)', textDecoration: 'none', whiteSpace: 'nowrap' }
  if (!t) return null
  return (
    <span style={{ display: 'flex', gap: 6 }} onClick={(e) => e.stopPropagation()}>
      <a href={t} style={{ ...base, color: 'var(--ink-soft)', background: '#fff' }}>Call</a>
      <a href={w} target="_blank" rel="noreferrer" style={{ ...base, color: 'var(--ink-soft)', background: '#fff' }}>WhatsApp</a>
    </span>
  )
}

// ---- Caseload panel: a nurturer's assigned people + log nurturing contact ----
function CaseloadPanel({ nurturer, cases, lastContact, assignedBy, onClose, onChanged, onToast, onOpenProfile }) {
  const [busy, setBusy] = useState(false)
  const [logFor, setLogFor] = useState(null) // assignment being logged

  async function endAssignment(a) {
    if (!window.confirm(`End ${nurturer.full_name}'s care of ${a.cared?.full_name}? The record is kept (history), not deleted.`)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('nurturing_assignments').update({ active: false, ended_at: new Date().toISOString() }).eq('id', a.id)
      if (error) throw error
      onToast('Assignment ended (kept as history).')
      onChanged()
    } catch (e) { onToast('Could not end: ' + (e.message || e)) } finally { setBusy(false) }
  }

  return (
    <SidePanel onClose={onClose} width={540}>
      <PanelHeader onClose={onClose}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 48, height: 48, borderRadius: '50%', background: avatarFor(1), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 17, fontWeight: 600 }}>{initials(nurturer.full_name)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 2px' }}>{nurturer.full_name}</h2>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{cases.length} in caseload</div>
          </div>
        </div>
      </PanelHeader>
      <div style={{ padding: '20px 26px' }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 10px' }}>Caseload — people in their care</h3>
        {cases.length === 0 && <Empty label="No one assigned yet." />}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {cases.map((a) => {
            const overdue = (daysSince(lastContact[a.cared_person_id]) ?? 9999) >= OVERDUE_DAYS
            return (
              <div key={a.id} className="card" style={{ padding: 13 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div onClick={() => onOpenProfile(a.cared?.id)} style={{ minWidth: 0, flex: 1, cursor: 'pointer' }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600 }}>{a.cared?.full_name || 'Unknown'}</div>
                    <div style={{ fontSize: 11.5, color: overdue ? '#B5532F' : 'var(--muted)' }}>{lastContactLabel(lastContact[a.cared_person_id])}{overdue ? ' · overdue' : ''}{a.cared?.pincode ? ` · ${a.cared.pincode}` : ''}</div>
                  </div>
                  {reach(a.cared?.phone)}
                  <button className="btn btn-primary" style={{ padding: '5px 10px', fontSize: 11.5 }} onClick={() => setLogFor(a)}>Log</button>
                  <button title="End care" onClick={() => endAssignment(a)} disabled={busy} style={{ padding: '5px 8px', fontSize: 11.5, borderRadius: 7, border: '1px solid #E7C9B8', background: '#fff', color: '#B5532F', cursor: 'pointer' }}>✕</button>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      {logFor && <NurturingLog assignment={logFor} loggedBy={assignedBy} onClose={() => setLogFor(null)} onSaved={() => { setLogFor(null); onChanged() }} onToast={onToast} />}
    </SidePanel>
  )
}

// Log a nurturing contact -> call_logs (contact_source='nurturing', tied to the assignment).
function NurturingLog({ assignment, loggedBy, onClose, onSaved, onToast }) {
  const [outcome, setOutcome] = useState('Reached')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  async function save() {
    setBusy(true)
    try {
      const { error } = await supabase.from('call_logs').insert({
        person_id: assignment.cared_person_id,
        nurturing_assignment_id: assignment.id,
        journey_id: null,
        contact_source: 'nurturing',
        reachability: outcome,
        remarks: note || null,
        logged_by: loggedBy || null,
      })
      if (error) throw error
      onToast(`Logged nurturing contact with ${assignment.cared?.full_name || 'person'}.`)
      onSaved()
    } catch (e) { onToast('Could not log: ' + (e.message || e)) } finally { setBusy(false) }
  }
  const inputStyle = { width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', background: '#fff' }
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 140, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 420, maxWidth: '100%', padding: 24 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 4px' }}>Log nurturing contact</h3>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>{assignment.cared?.full_name} · {assignment.cared?.phone || 'no phone'}</div>
        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#5C5142', marginBottom: 14 }}>Outcome
          <select value={outcome} onChange={(e) => setOutcome(e.target.value)} style={{ ...inputStyle, marginTop: 6 }}>
            {['Reached', 'No answer', 'Call back', 'Doing well', 'Needs support'].map((o) => <option key={o}>{o}</option>)}
          </select>
        </label>
        <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: '#5C5142', marginBottom: 16 }}>Note (optional)
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

// ---- Assign tab: POC assigns a nurturer (same-pincode default) to a cared person ----
function AssignTab({ members, orphaned, nurturerPersonIds, assignedBy, isCoordinator, onChanged, onToast, onOpenProfile }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [assignFor, setAssignFor] = useState(null) // cared person to assign

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setResults([]); return }
    let alive = true
    setSearching(true)
    const t = setTimeout(async () => {
      const digits = term.replace(/\D/g, '')
      let query = supabase.from('people').select('id, full_name, phone, pincode, is_meditator').limit(20)
      query = digits.length >= 4 ? query.ilike('phone', `%${digits}%`) : query.ilike('full_name', `%${term}%`)
      const { data } = await query
      if (alive) { setResults(data || []); setSearching(false) }
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [q])

  return (
    <div>
      {orphaned.length > 0 && (
        <div className="card" style={{ padding: 18, marginBottom: 18, borderColor: '#E7C9B8', background: '#FBF1E4' }}>
          <div style={{ fontSize: 14, fontWeight: 600, color: '#9C4A14', marginBottom: 10 }}>{orphaned.length} orphaned — nurturer left, awaiting reassignment</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {orphaned.map((a) => (
              <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', background: '#fff', borderRadius: 9, padding: '10px 12px' }}>
                <div style={{ minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{a.cared?.full_name}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>{a.cared?.pincode ? ` · ${a.cared.pincode}` : ''}</span>
                </div>
                <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 11px' }} onClick={() => setAssignFor({ ...a.cared, _reassignId: a.id })}>Reassign</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="card" style={{ padding: 20 }}>
        <h3 style={{ fontSize: 15, fontWeight: 600, margin: '0 0 4px' }}>Assign a nurturer</h3>
        <div style={{ fontSize: 12.5, color: 'var(--muted)', marginBottom: 12 }}>Find the person to care for; nurturers from the same pincode are offered first.</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a person by name or phone…" style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '11px 12px', fontSize: 14, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: 12 }} />
        {searching && <div style={{ fontSize: 13, color: 'var(--muted-2)' }}>Searching…</div>}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {results.map((p) => (
            <div key={p.id} className="rowhover" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10 }}>
              <div onClick={() => onOpenProfile(p.id)} style={{ minWidth: 0, flex: 1, cursor: 'pointer' }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.full_name || '(no name)'}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.phone || 'no phone'}{p.pincode ? ` · ${p.pincode}` : ''}{p.is_meditator ? ' · meditator' : ''}</div>
              </div>
              <button className="btn btn-primary" style={{ fontSize: 12, padding: '6px 11px' }} onClick={() => setAssignFor(p)}>Assign nurturer</button>
            </div>
          ))}
        </div>
      </div>

      {assignFor && (
        <AssignDialog
          cared={assignFor} members={members} assignedBy={assignedBy}
          onClose={() => setAssignFor(null)}
          onDone={() => { setAssignFor(null); onChanged() }}
          onToast={onToast}
        />
      )}
    </div>
  )
}

function AssignDialog({ cared, members, assignedBy, onClose, onDone, onToast }) {
  const [busy, setBusy] = useState(false)
  // Same-pincode nurturers first (default pick list); others still allowed.
  const sorted = useMemo(() => {
    const same = members.filter((m) => m.person?.pincode && cared.pincode && m.person.pincode === cared.pincode)
    const rest = members.filter((m) => !(m.person?.pincode && cared.pincode && m.person.pincode === cared.pincode))
    return { same, rest }
  }, [members, cared.pincode])

  async function assign(nurturerPersonId) {
    setBusy(true)
    try {
      if (cared._reassignId) {
        const { error } = await supabase.from('nurturing_assignments').update({ nurturer_person_id: nurturerPersonId, assigned_by: assignedBy || null, assigned_at: new Date().toISOString() }).eq('id', cared._reassignId)
        if (error) throw error
      } else {
        const { error } = await supabase.from('nurturing_assignments').insert({ nurturer_person_id: nurturerPersonId, cared_person_id: cared.id, active: true, assigned_by: assignedBy || null })
        if (error) throw error
      }
      onToast(`Assigned to ${members.find((m) => m.person?.id === nurturerPersonId)?.person?.full_name || 'nurturer'}.`)
      onDone()
    } catch (e) { onToast('Could not assign: ' + (e.message || e)) } finally { setBusy(false) }
  }

  const row = (m) => (
    <button key={m.id} disabled={busy} onClick={() => assign(m.person.id)} className="rowhover" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: '#fff', cursor: 'pointer', textAlign: 'left', width: '100%' }}>
      <div style={{ width: 30, height: 30, borderRadius: '50%', background: '#C2691F', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{initials(m.person?.full_name || '?')}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600 }}>{m.person?.full_name}{m.is_poc && <span className="pill" style={{ ...pill('#EAF2E5', '#4E7C3F'), marginLeft: 8 }}>POC</span>}</div>
        <div style={{ fontSize: 12, color: 'var(--muted)' }}>{m.person?.pincode ? `pincode ${m.person.pincode}` : 'no pincode'}</div>
      </div>
    </button>
  )
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 140, padding: 20 }} onClick={onClose}>
      <div className="card" style={{ width: 460, maxWidth: '100%', padding: 24, maxHeight: '86vh', overflowY: 'auto' }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 2px' }}>Assign nurturer</h3>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>for {cared.full_name}{cared.pincode ? ` · pincode ${cared.pincode}` : ' · no pincode'}</div>
        {sorted.same.length > 0 && <>
          <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: '#4E7C3F', fontWeight: 700, marginBottom: 8 }}>Same pincode</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 16 }}>{sorted.same.map(row)}</div>
        </>}
        <div style={{ fontSize: 11, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700, marginBottom: 8 }}>{sorted.same.length ? 'Other nurturers' : 'Nurturers'}</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{sorted.rest.map(row)}</div>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}><button className="btn btn-ghost" onClick={onClose}>Cancel</button></div>
      </div>
    </div>
  )
}

// ---- Team tab: roster, POC toggle, add member, mark left ----
function TeamTab({ team, members, isCoordinator, onChanged, onToast, onOpenProfile }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [busy, setBusy] = useState(false)
  const memberPersonIds = useMemo(() => new Set(members.map((m) => m.person?.id)), [members])

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setResults([]); return }
    let alive = true
    const t = setTimeout(async () => {
      const digits = term.replace(/\D/g, '')
      let query = supabase.from('people').select('id, full_name, phone, pincode').limit(15)
      query = digits.length >= 4 ? query.ilike('phone', `%${digits}%`) : query.ilike('full_name', `%${term}%`)
      const { data } = await query
      if (alive) setResults((data || []).filter((p) => !memberPersonIds.has(p.id)))
    }, 300)
    return () => { alive = false; clearTimeout(t) }
  }, [q, memberPersonIds])

  async function addMember(personId) {
    setBusy(true)
    try {
      const { error } = await supabase.from('team_members').insert({ team_id: team.id, person_id: personId, is_poc: false })
      if (error) throw error
      onToast('Added to team.'); setQ(''); setResults([]); onChanged()
    } catch (e) { onToast('Could not add: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function togglePoc(m) {
    setBusy(true)
    try {
      const { error } = await supabase.from('team_members').update({ is_poc: !m.is_poc }).eq('id', m.id)
      if (error) throw error
      onToast(m.is_poc ? 'POC removed.' : 'Marked POC.'); onChanged()
    } catch (e) { onToast('Could not update: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function markLeft(m) {
    if (!window.confirm(`Remove ${m.person?.full_name} from the team? Their active assignments are orphaned back to a POC for reassignment; nothing is deleted.`)) return
    setBusy(true)
    try {
      // Orphan their active assignments back to the POC (never drop the cared person).
      const { error: e1 } = await supabase.from('nurturing_assignments').update({ nurturer_person_id: null }).eq('nurturer_person_id', m.person.id).eq('active', true)
      if (e1) throw e1
      const { error: e2 } = await supabase.from('team_members').update({ left_at: new Date().toISOString() }).eq('id', m.id)
      if (e2) throw e2
      onToast(`${m.person?.full_name} left — their people are in the orphaned queue.`); onChanged()
    } catch (e) { onToast('Could not remove: ' + (e.message || e)) } finally { setBusy(false) }
  }

  return (
    <div>
      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        <div style={{ padding: '13px 20px', background: 'var(--panel)', borderBottom: '1px solid var(--border)', fontSize: 13, fontWeight: 600 }}>{team?.name} · {members.length} members</div>
        {members.map((m) => (
          <div key={m.id} className="rowhover" style={{ display: 'flex', alignItems: 'center', gap: 11, padding: '12px 20px', borderBottom: '1px solid #F1E9DB' }}>
            <div onClick={() => onOpenProfile(m.person?.id)} style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0, flex: 1, cursor: 'pointer' }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: '#3D6E60', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600 }}>{initials(m.person?.full_name || '?')}</div>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600 }}>{m.person?.full_name || 'Unknown'}{m.is_poc && <span className="pill" style={{ ...pill('#EAF2E5', '#4E7C3F'), marginLeft: 8 }}>POC</span>}</div>
                <div style={{ fontSize: 11.5, color: 'var(--muted)' }}>{m.person?.phone || 'No phone'}{m.person?.pincode ? ` · ${m.person.pincode}` : ''}</div>
              </div>
            </div>
            {isCoordinator && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button disabled={busy} onClick={() => togglePoc(m)} className="btn btn-ghost" style={{ fontSize: 11.5, padding: '5px 10px' }}>{m.is_poc ? 'Unset POC' : 'Make POC'}</button>
                <button disabled={busy} onClick={() => markLeft(m)} style={{ fontSize: 11.5, padding: '5px 10px', borderRadius: 7, border: '1px solid #E7C9B8', background: '#fff', color: '#B5532F', cursor: 'pointer' }}>Remove</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {isCoordinator && (
        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, margin: '0 0 10px' }}>Add a team member</h3>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search a person by name or phone…" style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 13.5, fontFamily: 'inherit', outline: 'none', boxSizing: 'border-box', marginBottom: 10 }} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {results.map((p) => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, justifyContent: 'space-between', padding: '9px 12px', border: '1px solid var(--border)', borderRadius: 10 }}>
                <div><span style={{ fontSize: 13.5, fontWeight: 600 }}>{p.full_name}</span> <span style={{ fontSize: 12, color: 'var(--muted)' }}>{p.phone || 'no phone'}{p.pincode ? ` · ${p.pincode}` : ''}</span></div>
                <button disabled={busy} className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 11px' }} onClick={() => addMember(p.id)}>Add</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
