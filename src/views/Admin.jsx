import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Pad, ErrorCard, Loading, Empty } from '../components/View'
import { initials, avatarFor } from '../lib/ui'

// ADMIN pages — Users & Roles, Centres, Pincode→Centre map.
// Access DERIVES from role + the live pincode_map (read by RLS); these pages only
// CONFIGURE role + centre. Every write here is also gated admin-only at the policy
// layer (profiles_self_update / centers_write / settings_write), so this is not
// UI-only hiding. Role/centre changes are audited by a DB trigger (role_audit).

// Roles are DATA (roles + role_sections tables). Admin creates a role, toggles
// which SECTIONS it can open; assigning a user a role grants those sections.
// Centre scope (which centre's data) is a separate dimension via profiles.center_id.
const SECTIONS = [
  { k: 'dashboard', label: 'Dashboard' },
  { k: 'volunteers', label: 'Volunteers' },
  { k: 'meditators', label: 'Meditators' },
  { k: 'advance', label: 'Advance Programmes' },
  { k: 'event_hub', label: 'Event Hub' },
  { k: 'attendance', label: 'Attendance' },
  { k: 'nurturing', label: 'Nurturing & Care' },
  { k: 'interest', label: 'Interest Inbox' },
  { k: 'campaigns', label: 'Campaigns' },
  { k: 'unresolved', label: 'Unresolved' },
]
const SENTINELS = ['all', 'unassigned']
const selStyle = { padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 12.5, fontFamily: 'inherit', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer', minHeight: 40 }
const inputStyle = { padding: '9px 11px', border: '1px solid var(--border)', borderRadius: 9, fontSize: 13, fontFamily: 'inherit', background: '#fff', color: 'var(--ink)', outline: 'none', minHeight: 40 }

export default function Admin({ me, onToast }) {
  const [tab, setTab] = useState('users')
  const tabs = [
    { k: 'users', label: 'Users & Roles' },
    { k: 'roles', label: 'Roles' },
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
      {tab === 'roles' && <RolesManager onToast={onToast} />}
      {tab === 'centres' && <Centres onToast={onToast} />}
      {tab === 'pincodes' && <Pincodes onToast={onToast} />}
    </Pad>
  )
}

// ---------------------------------------------------------------- Users & Roles
function UsersRoles({ onToast }) {
  const [rows, setRows] = useState(null)
  const [centres, setCentres] = useState([])
  const [roles, setRoles] = useState([])
  const [q, setQ] = useState('')
  const [err, setErr] = useState(null)

  const load = useCallback(async () => {
    setErr(null)
    const [pf, ce, rl] = await Promise.all([
      supabase.from('profiles').select('id, full_name, email, role, center_id, active').order('role').order('full_name'),
      supabase.from('centers').select('id, name, active').order('name'),
      supabase.from('roles').select('key, label, active').order('label'),
    ])
    if (pf.error) { setErr(pf.error.message); setRows([]); return }
    setRows(pf.data || [])
    setCentres((ce.data || []).filter((c) => !SENTINELS.includes(c.id) && c.active))
    setRoles((rl.data || []).filter((r) => r.active))
  }, [])
  useEffect(() => { load() }, [load])

  if (err) return <ErrorCard>Couldn't load users: {err}</ErrorCard>
  if (!rows) return <Loading label="Loading users…" />

  const s = q.trim().toLowerCase()
  const shown = s ? rows.filter((u) => (u.full_name || '').toLowerCase().includes(s) || (u.email || '').toLowerCase().includes(s)) : rows

  return (
    <>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or email…"
        style={{ ...inputStyle, width: '100%', marginBottom: 12 }} />
      <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>{shown.length} of {rows.length} user{rows.length !== 1 ? 's' : ''}</div>
      {shown.length === 0 ? <Empty label="No users match." /> : (
        <div className="card" style={{ overflow: 'hidden' }}>
          {shown.map((u, i) => (
            <UserRow key={u.id} u={u} idx={i} centres={centres} roles={roles} onToast={onToast} onSaved={load} />
          ))}
        </div>
      )}
    </>
  )
}

function UserRow({ u, idx, centres, roles, onToast, onSaved }) {
  const [name, setName] = useState(u.full_name || '')
  const [role, setRole] = useState(u.role)
  // Centre scope: 'all' = sector (all centres); else a specific centre.
  const [centre, setCentre] = useState(SENTINELS.includes(u.center_id) ? 'all' : u.center_id)
  const [busy, setBusy] = useState(false)

  // Re-seed from the fresh DB row after a save, so the editor reflects persisted
  // truth (a failed save leaves the attempt + dirty state + error toast visible).
  useEffect(() => {
    setName(u.full_name || '')
    setRole(u.role)
    setCentre(SENTINELS.includes(u.center_id) ? 'all' : u.center_id)
  }, [u.full_name, u.role, u.center_id])

  // Admin is always all-centres; other roles can be sector ('all') or one centre.
  const targetCentre = role === 'admin' ? 'all' : centre
  const dirty = name.trim() !== (u.full_name || '') || role !== u.role || targetCentre !== u.center_id

  async function save() {
    setBusy(true)
    try {
      const { error } = await supabase.from('profiles')
        .update({ full_name: name.trim(), role, center_id: targetCentre }).eq('id', u.id)
      if (error) throw error
      const label = roles.find((r) => r.key === role)?.label || role
      onToast(`${name.trim() || u.email} → ${label} · ${targetCentre === 'all' ? 'all centres' : targetCentre}`)
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
      <select value={role} onChange={(e) => setRole(e.target.value)} style={selStyle} title="Role">
        {roles.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}
        {!roles.some((r) => r.key === role) && <option value={role}>{role}</option>}
      </select>
      <select value={targetCentre} disabled={role === 'admin'} onChange={(e) => setCentre(e.target.value)} style={{ ...selStyle, opacity: role === 'admin' ? 0.5 : 1 }} title="Centre (data scope)">
        <option value="all">All centres (sector)</option>
        {centres.map((c) => <option key={c.id} value={c.id}>{c.name || c.id}</option>)}
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

// ------------------------------------------------------------- Roles (as data)
function RolesManager({ onToast }) {
  const [roles, setRoles] = useState(null)
  const [err, setErr] = useState(null)
  const [newLabel, setNewLabel] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    setErr(null)
    const { data, error } = await supabase.from('roles')
      .select('id, key, label, is_system, active, role_sections(section)').order('label')
    if (error) { setErr(error.message); setRoles([]); return }
    setRoles(data || [])
  }, [])
  useEffect(() => { load() }, [load])

  async function addRole() {
    const label = newLabel.trim()
    if (!label) return
    const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
    if (!key) return onToast('Give the role a name with letters or numbers.')
    setBusy(true)
    try {
      const { error } = await supabase.from('roles').insert({ key, label })
      if (error) throw error
      setNewLabel(''); onToast(`Role "${label}" added — now pick its sections.`); load()
    } catch (e) {
      onToast(/duplicate|unique/i.test(e.message || '') ? 'A role with that name already exists.' : 'Could not add role: ' + (e.message || e))
    } finally { setBusy(false) }
  }

  if (err) return <ErrorCard>Couldn't load roles: {err}</ErrorCard>
  if (!roles) return <Loading label="Loading roles…" />

  return (
    <>
      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} placeholder="New role name (e.g. Volunteer Nurturer)"
          onKeyDown={(e) => e.key === 'Enter' && addRole()} style={{ ...inputStyle, flex: 1, minWidth: 220 }} />
        <button className="btn btn-primary" disabled={busy || !newLabel.trim()} onClick={addRole} style={{ padding: '9px 16px', fontSize: 13 }}>＋ Add role</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {roles.map((r) => <RoleCard key={r.id} role={r} onToast={onToast} onChanged={load} />)}
      </div>
    </>
  )
}

function RoleCard({ role, onToast, onChanged }) {
  const [label, setLabel] = useState(role.label)
  const [busy, setBusy] = useState(false)
  const editable = !role.is_system // admin is locked to all-access
  const secSet = new Set((role.role_sections || []).map((s) => s.section))

  async function toggleSection(sec) {
    if (!editable) return
    setBusy(true)
    try {
      const q = secSet.has(sec)
        ? supabase.from('role_sections').delete().eq('role_id', role.id).eq('section', sec)
        : supabase.from('role_sections').insert({ role_id: role.id, section: sec })
      const { error } = await q
      if (error) throw error
      onChanged()
    } catch (e) { onToast('Could not update sections: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function rename() {
    if (label.trim() === role.label || !label.trim()) return
    setBusy(true)
    try {
      const { error } = await supabase.from('roles').update({ label: label.trim() }).eq('id', role.id)
      if (error) throw error
      onToast('Role renamed.'); onChanged()
    } catch (e) { onToast('Could not rename: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function toggleActive() {
    setBusy(true)
    try {
      const { error } = await supabase.from('roles').update({ active: !role.active }).eq('id', role.id)
      if (error) throw error
      onToast(`Role ${role.active ? 'deactivated' : 'reactivated'}.`); onChanged()
    } catch (e) { onToast('Could not update: ' + (e.message || e)) } finally { setBusy(false) }
  }

  return (
    <div className="card" style={{ padding: 16, opacity: role.active ? 1 : 0.55 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 12 }}>
        <input value={label} disabled={!editable} onChange={(e) => setLabel(e.target.value)} onBlur={rename}
          style={{ ...inputStyle, minWidth: 180, fontWeight: 600, opacity: editable ? 1 : 0.7 }} />
        {role.is_system && <span className="pill" style={{ background: '#EDE4D6', color: '#8C7E6B', fontSize: 10.5 }}>system · all access</span>}
        {!role.active && <span className="pill" style={{ background: '#FBE6E0', color: '#B5532F', fontSize: 10.5 }}>inactive</span>}
        {!role.is_system && (
          <button className="btn btn-ghost" disabled={busy} onClick={toggleActive} style={{ marginLeft: 'auto', fontSize: 12, padding: '6px 11px', color: role.active ? '#B5532F' : '#4E7C3F' }}>
            {role.active ? 'Deactivate' : 'Reactivate'}
          </button>
        )}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {SECTIONS.map((s) => {
          const on = role.is_system || secSet.has(s.k)
          return (
            <button key={s.k} disabled={!editable || busy} onClick={() => toggleSection(s.k)}
              style={{ fontSize: 12, padding: '6px 11px', borderRadius: 8, cursor: editable ? 'pointer' : 'default',
                border: on ? '1px solid #2F6E5E' : '1px solid var(--border)', background: on ? '#E9F0EF' : '#fff', color: on ? '#2F6E5E' : 'var(--muted)', fontWeight: on ? 600 : 400 }}>
              {on ? '✓ ' : ''}{s.label}
            </button>
          )
        })}
      </div>
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
