import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Pad, ErrorCard, Loading, Empty } from '../components/View'
import { initials, avatarFor } from '../lib/ui'

// ADMIN pages — Users & Roles, Centres, Pincode→Centre map.
// Access DERIVES from role + the live pincode_map (read by RLS); these pages only
// CONFIGURE role + centre. Every write here is also gated admin-only at the policy
// layer (profiles_self_update / centers_write / settings_write), so this is not
// UI-only hiding. Role/centre changes are audited by a DB trigger (role_audit).

// A role is the (SCOPE × SPECIALTY) pair, stored as fields — never a flat string.
// SCOPE: Admin (all + config) · Sector (all centres) · Centre (one centre).
// SPECIALTY: Volunteer · Meditator · Both (Both = the super-role / admin).
// The stored role encodes the scope tier; center_id carries the centre; specialty
// its own column. Adding a role = picking (scope, specialty) here — no code change.
const LEVELS = [
  { v: 'sector', label: 'Sector — all centres' },
  { v: 'center', label: 'Centre — one centre' },
  { v: 'admin', label: 'RCO / Admin' },
]
const SPECIALTIES = [
  { v: 'volunteer', label: 'Volunteer' },
  { v: 'meditator', label: 'Meditator' },
  { v: 'both', label: 'Both' },
]
const roleForLevel = { sector: 'sector_nurturer', center: 'center_coordinator', admin: 'admin' }
const levelForRole = (role, centerId) =>
  role === 'admin' ? 'admin' : role === 'center_coordinator' || (centerId && centerId !== 'all') ? 'center' : 'sector'
const SENTINELS = ['all', 'unassigned']
const selStyle = { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', minHeight: 40 }
const inputStyle = { padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: 'var(--ink)', outline: 'none', minHeight: 40 }

export default function Admin({ me, onToast }) {
  const [tab, setTab] = useState('users')
  const tabs = [
    { k: 'users', label: 'Users & Roles' },
    { k: 'centres', label: 'Centres' },
    { k: 'pincodes', label: 'Pincode → Centre' },
  ]
  return (
    <Pad>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 13, color: 'var(--muted)' }}>
          Access is derived from role + the pincode map — set a person's role (and, for a coordinator, their centre); the database does the filtering.
        </div>
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {tabs.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)} className="btn" style={{ padding: '8px 15px', fontSize: 13, borderRadius: 20, background: tab === t.k ? '#241B14' : '#fff', color: tab === t.k ? '#F6ECDC' : 'var(--ink-soft)', border: tab === t.k ? 'none' : '1px solid var(--border)' }}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'users' && <UsersRoles onToast={onToast} />}
      {tab === 'centres' && <Centres onToast={onToast} />}
      {tab === 'pincodes' && <Pincodes onToast={onToast} />}
    </Pad>
  )
}

// ---------------------------------------------------------------- Users & Roles
function UsersRoles({ onToast }) {
  const [rows, setRows] = useState(null)
  const [centres, setCentres] = useState([])
  const [err, setErr] = useState(null)

  const load = useCallback(async () => {
    setErr(null)
    const [pf, ce] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, role, center_id, active, specialty').order('role').order('full_name'),
      supabase.from('centers').select('id, name, active').order('name'),
    ])
    if (pf.error) { setErr(pf.error.message); setRows([]); return }
    setRows(pf.data || [])
    setCentres((ce.data || []).filter((c) => !SENTINELS.includes(c.id) && c.active))
  }, [])
  useEffect(() => { load() }, [load])

  if (err) return <ErrorCard>Couldn't load users: {err}</ErrorCard>
  if (!rows) return <Loading label="Loading users…" />
  if (rows.length === 0) return <Empty label="No user profiles found." />

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      {rows.map((u, i) => (
        <UserRow key={u.id} u={u} idx={i} centres={centres} onToast={onToast} onSaved={load} />
      ))}
    </div>
  )
}

function UserRow({ u, idx, centres, onToast, onSaved }) {
  const [name, setName] = useState(u.full_name || '')
  const [level, setLevel] = useState(levelForRole(u.role, u.center_id))
  const [specialty, setSpecialty] = useState(u.specialty || '')
  const [centre, setCentre] = useState(SENTINELS.includes(u.center_id) ? (centres[0]?.id || '') : u.center_id)
  const [busy, setBusy] = useState(false)

  // After a save the parent reloads; re-seed the editor from the fresh DB row so
  // it always reflects persisted truth. A failed save leaves u unchanged, so the
  // attempted value + dirty state (and the error toast) remain visible.
  useEffect(() => {
    setName(u.full_name || '')
    setLevel(levelForRole(u.role, u.center_id))
    setSpecialty(u.specialty || '')
    setCentre(SENTINELS.includes(u.center_id) ? (centres[0]?.id || '') : u.center_id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [u.full_name, u.role, u.center_id, u.specialty])

  // Admin is always both-specialty; sector/centre must pick a specialty.
  const specialtyValue = level === 'admin' ? 'both' : specialty
  const targetCentre = level === 'center' ? centre : 'all'
  const dirty =
    name.trim() !== (u.full_name || '') ||
    level !== levelForRole(u.role, u.center_id) ||
    specialtyValue !== (u.specialty || (level === 'admin' ? 'both' : '')) ||
    (level === 'center' && centre !== u.center_id)

  async function save() {
    if (level !== 'admin' && !specialty) return onToast('Pick a specialty (Volunteer / Meditator / Both).')
    if (level === 'center' && !centre) return onToast('Pick a centre.')
    setBusy(true)
    try {
      const { error } = await supabase.from('profiles')
        .update({ full_name: name.trim(), role: roleForLevel[level], center_id: targetCentre, specialty: specialtyValue })
        .eq('id', u.id)
      if (error) throw error
      const lvl = LEVELS.find((l) => l.v === level)?.label
      onToast(`${name.trim() || u.email} → ${lvl}${level === 'center' ? ' · ' + targetCentre : ''}${level !== 'admin' ? ' · ' + specialtyValue : ''}`)
      onSaved()
    } catch (e) {
      onToast('Could not update: ' + (e.message || e))
    } finally { setBusy(false) }
  }

  // Deactivating flips profiles.active → is_active() false → RLS denies ALL data
  // access, regardless of role. The reversible lever for departed accounts.
  async function toggleActive() {
    setBusy(true)
    try {
      const { error } = await supabase.from('profiles').update({ active: !u.active }).eq('id', u.id)
      if (error) throw error
      onToast(`${u.full_name || u.email} ${u.active ? 'deactivated — no data access' : 'reactivated'}.`)
      onSaved()
    } catch (e) { onToast('Could not update: ' + (e.message || e)) } finally { setBusy(false) }
  }

  // Hard-remove the profile. Irreversible. If the account owns linked records the
  // FK refuses and we tell the admin to deactivate instead. (Auth login, if it ever
  // signs in again, is recreated inactive by handle_new_user — no access.)
  async function remove() {
    if (!window.confirm(`Remove ${u.full_name || u.email}? This deletes their profile and access. This cannot be undone.`)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('profiles').delete().eq('id', u.id)
      if (error) throw error
      onToast(`${u.full_name || u.email} removed.`)
      onSaved()
    } catch (e) {
      const msg = /foreign key|violates/i.test(e.message || '') ? 'Account owns linked records — deactivate instead of deleting.' : (e.message || e)
      onToast('Could not remove: ' + msg)
    } finally { setBusy(false) }
  }

  return (
    <div className="rowhover" style={{ display: 'flex', gap: 10, padding: '14px 18px', borderBottom: '1px solid #F1E9DB', alignItems: 'center', flexWrap: 'wrap' }}>
      <div style={{ width: 38, height: 38, borderRadius: '50%', background: avatarFor(idx), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{initials(name || u.email || '?')}</div>
      <div style={{ minWidth: 150, flex: 1 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Full name" style={{ ...inputStyle, width: '100%', minHeight: 34, padding: '6px 9px', fontWeight: 600 }} />
        <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{u.email || 'no email'}{!u.active && <span style={{ color: '#B5532F', marginLeft: 8 }}>inactive</span>}</div>
      </div>
      <select value={level} onChange={(e) => setLevel(e.target.value)} style={selStyle} title="Scope">
        {LEVELS.map((l) => <option key={l.v} value={l.v}>{l.label}</option>)}
      </select>
      <select value={specialtyValue} disabled={level === 'admin'} onChange={(e) => setSpecialty(e.target.value)} style={{ ...selStyle, opacity: level === 'admin' ? 0.5 : 1 }} title="Specialty">
        {level === 'admin'
          ? [<option key="both" value="both">Both</option>]
          : [<option key="_" value="">— specialty —</option>, ...SPECIALTIES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)]}
      </select>
      <select value={level === 'center' ? centre : ''} disabled={level !== 'center'} onChange={(e) => setCentre(e.target.value)} style={{ ...selStyle, opacity: level === 'center' ? 1 : 0.5 }} title="Centre">
        {level === 'center'
          ? [<option key="_" value="">— centre —</option>, ...centres.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)]
          : [<option key="_" value="">n/a</option>]}
      </select>
      <button className="btn btn-primary" disabled={!dirty || busy} onClick={save} style={{ padding: '9px 15px', fontSize: 12.5, opacity: dirty ? 1 : 0.5 }}>
        {busy ? 'Saving…' : 'Save'}
      </button>
      <button className="btn btn-ghost" disabled={busy} onClick={toggleActive} title={u.active ? 'Remove all data access (keeps the record)' : 'Restore access'} style={{ padding: '9px 12px', fontSize: 12.5, color: u.active ? '#B5532F' : '#4E7C3F' }}>
        {u.active ? 'Deactivate' : 'Activate'}
      </button>
      <button disabled={busy} onClick={remove} title="Delete this profile (irreversible)" style={{ padding: '9px 11px', fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: '1px solid #E7C9B8', background: '#fff', color: '#B5532F', cursor: busy ? 'default' : 'pointer' }}>Remove</button>
    </div>
  )
}

// ---------------------------------------------------------------------- Centres
function Centres({ onToast }) {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [newId, setNewId] = useState('')
  const [newName, setNewName] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    const { data, error } = await supabase.from('centers').select('id, name, active, created_at').order('id')
    if (error) { setErr(error.message); setRows([]); return }
    setRows(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  async function addCentre() {
    const id = newId.trim().toLowerCase().replace(/\s+/g, '_')
    const name = newName.trim()
    if (!id || !name) return onToast('Both a short id and a name are required.')
    setBusy(true)
    try {
      const { error } = await supabase.from('centers').insert({ id, name, active: true })
      if (error) throw error
      setNewId(''); setNewName('')
      onToast(`Centre "${name}" added.`)
      load()
    } catch (e) {
      onToast(e.message?.includes('duplicate') ? 'That centre id already exists.' : 'Could not add: ' + (e.message || e))
    } finally { setBusy(false) }
  }

  async function toggleActive(c) {
    const { error } = await supabase.from('centers').update({ active: !c.active }).eq('id', c.id)
    if (error) return onToast('Could not update: ' + error.message)
    onToast(`${c.name || c.id} ${c.active ? 'deactivated' : 'activated'}.`)
    load()
  }

  // Destructive: deleting a centre must not silently orphan coordinators, mapped
  // pincodes, or people. Count dependants, warn, and prefer deactivate.
  async function removeCentre(c) {
    const [pf, pe, mp] = await Promise.all([
      supabase.from('profiles').select('id', { count: 'exact', head: true }).eq('center_id', c.id),
      supabase.from('people').select('id', { count: 'exact', head: true }).eq('center_id', c.id),
      supabase.from('settings').select('value').eq('key', 'pincode_map').single(),
    ])
    const coordinators = pf.count || 0
    const people = pe.count || 0
    const pincodes = Object.values(mp.data?.value || {}).filter((v) => v === c.id).length
    if (coordinators || people || pincodes) {
      onToast(`Can't delete "${c.name || c.id}": ${coordinators} user(s), ${pincodes} pincode(s), ${people} person record(s) still point to it. Reassign those first, or Deactivate instead.`)
      return
    }
    if (!window.confirm(`Delete centre "${c.name || c.id}"? Nothing references it. This cannot be undone.`)) return
    const { error } = await supabase.from('centers').delete().eq('id', c.id)
    if (error) return onToast('Could not delete: ' + error.message)
    onToast(`Centre "${c.name || c.id}" deleted.`)
    load()
  }

  if (err) return <ErrorCard>Couldn't load centres: {err}</ErrorCard>
  if (!rows) return <Loading label="Loading centres…" />

  const real = rows.filter((c) => !SENTINELS.includes(c.id))
  const sentinels = rows.filter((c) => SENTINELS.includes(c.id))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="card" style={{ overflow: 'hidden' }}>
        {real.map((c) => (
          <div key={c.id} className="rowhover" style={{ display: 'flex', gap: 12, padding: '14px 18px', borderBottom: '1px solid #F1E9DB', alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ flex: 1, minWidth: 150 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>{c.name || c.id}{!c.active && <span style={{ fontSize: 11, color: '#B5532F', marginLeft: 8 }}>inactive</span>}</div>
              <div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>id: {c.id}</div>
            </div>
            <button className="btn btn-ghost" style={{ padding: '8px 12px', fontSize: 12.5 }} onClick={() => toggleActive(c)}>{c.active ? 'Deactivate' : 'Activate'}</button>
            <button onClick={() => removeCentre(c)} style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: '1px solid #E7C9B8', background: '#fff', color: '#B5532F', cursor: 'pointer' }}>Delete</button>
          </div>
        ))}
        {real.length === 0 && <div style={{ padding: 20 }}><Empty label="No centres yet — add one below." /></div>}
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Add a centre</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Centre name (e.g. Bommasandra)" style={{ ...inputStyle, flex: 2, minWidth: 180 }} />
          <input value={newId} onChange={(e) => setNewId(e.target.value)} placeholder="short id (e.g. bommasandra)" style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
          <button className="btn btn-primary" disabled={busy} onClick={addCentre} style={{ padding: '9px 16px', fontSize: 12.5 }}>{busy ? 'Adding…' : 'Add centre'}</button>
        </div>
      </div>

      {sentinels.length > 0 && (
        <div style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>
          System rows (not editable): {sentinels.map((s) => `${s.name || s.id}`).join(' · ')}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------- Pincode → Centre
function Pincodes({ onToast }) {
  const [map, setMap] = useState(null) // array of {pincode, centre}
  const [centres, setCentres] = useState([])
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)
  const [newPin, setNewPin] = useState('')
  const [newCentre, setNewCentre] = useState('')

  const load = useCallback(async () => {
    setErr(null)
    const [s, ce] = await Promise.all([
      supabase.from('settings').select('value').eq('key', 'pincode_map').single(),
      supabase.from('centers').select('id, name, active').order('name'),
    ])
    if (s.error) { setErr(s.error.message); setMap([]); return }
    const obj = s.data?.value || {}
    setMap(Object.entries(obj).map(([pincode, centre]) => ({ pincode, centre })).sort((a, b) => a.pincode.localeCompare(b.pincode)))
    setCentres((ce.data || []).filter((c) => !SENTINELS.includes(c.id) && c.active))
  }, [])
  useEffect(() => { load() }, [load])

  // Persist the whole map object. RLS reads settings.pincode_map live, so a save
  // takes effect immediately — no code change, no redeploy.
  async function persist(nextArr, msg) {
    const obj = {}
    for (const r of nextArr) if (r.pincode && r.centre) obj[r.pincode] = r.centre
    setBusy(true)
    try {
      const { error } = await supabase.from('settings').update({ value: obj }).eq('key', 'pincode_map')
      if (error) throw error
      onToast(msg)
      load()
    } catch (e) {
      onToast('Could not save map: ' + (e.message || e))
    } finally { setBusy(false) }
  }

  function setCentreFor(pincode, centre) {
    persist(map.map((r) => (r.pincode === pincode ? { ...r, centre } : r)), `${pincode} → ${centre}`)
  }
  function removePin(pincode) {
    if (!window.confirm(`Remove pincode ${pincode} from the map? People there become unmapped (RCO-only) until remapped.`)) return
    persist(map.filter((r) => r.pincode !== pincode), `${pincode} removed from map.`)
  }
  function addPin() {
    const pin = newPin.replace(/\D/g, '')
    if (!pin) return onToast('Enter a numeric pincode.')
    if (!newCentre) return onToast('Pick a centre.')
    if (map.some((r) => r.pincode === pin)) return onToast('That pincode is already mapped.')
    setNewPin(''); setNewCentre('')
    persist([...map, { pincode: pin, centre: newCentre }], `${pin} → ${newCentre}`)
  }

  if (err) return <ErrorCard>Couldn't load the pincode map: {err}</ErrorCard>
  if (!map) return <Loading label="Loading pincode map…" />

  const centreName = (id) => centres.find((c) => c.id === id)?.name || id

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>
        The map is read live by the database — adding or removing a pincode re-scopes coordinators immediately. Unmapped pincodes stay unmapped (only RCO/Admin sees them).
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr auto', gap: 12, padding: '11px 18px', background: 'var(--panel)', borderBottom: '1px solid var(--border)', fontSize: 10.5, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700 }}>
          <span>Pincode</span><span>Centre</span><span></span>
        </div>
        {map.map((r) => (
          <div key={r.pincode} className="rowhover" style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr auto', gap: 12, padding: '11px 18px', borderBottom: '1px solid #F1E9DB', alignItems: 'center' }}>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{r.pincode}</div>
            <select value={r.centre} disabled={busy} onChange={(e) => setCentreFor(r.pincode, e.target.value)} style={selStyle}>
              {!centres.some((c) => c.id === r.centre) && <option value={r.centre}>{r.centre} (unknown)</option>}
              {centres.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
            </select>
            <button onClick={() => removePin(r.pincode)} disabled={busy} title="Remove" style={{ padding: '7px 11px', fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: '1px solid #E7C9B8', background: '#fff', color: '#B5532F', cursor: 'pointer' }}>✕</button>
          </div>
        ))}
        {map.length === 0 && <div style={{ padding: 20 }}><Empty label="No pincodes mapped yet." /></div>}
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 10 }}>Add a pincode</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input value={newPin} onChange={(e) => setNewPin(e.target.value)} placeholder="Pincode (e.g. 560102)" inputMode="numeric" style={{ ...inputStyle, flex: 1, minWidth: 140 }} />
          <select value={newCentre} onChange={(e) => setNewCentre(e.target.value)} style={{ ...selStyle, flex: 1, minWidth: 160 }}>
            <option value="">— centre —</option>
            {centres.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
          </select>
          <button className="btn btn-primary" disabled={busy} onClick={addPin} style={{ padding: '9px 16px', fontSize: 12.5 }}>Add</button>
        </div>
      </div>
    </div>
  )
}
