import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { initials, avatarFor } from '../lib/ui'
import { STATUS_ORDER, OUTCOME_TO_STATUS, pillFor } from '../lib/calllog'
import { fillTemplate } from '../lib/phone'
import { useBreakpoint } from '../lib/useBreakpoint'
import ReachButtons from '../components/ReachButtons'
import CallLogDialog from '../components/CallLogDialog'
import CampaignScriptPanel from '../components/CampaignScriptPanel'
import AddRecipientsDialog from '../components/AddRecipientsDialog'
import AddCallerDialog from '../components/AddCallerDialog'

const CAMP_STATUS_PILL = {
  active: { background: '#EAF2E5', color: '#4E7C3F' },
  paused: { background: '#FBEAD9', color: '#C28A2A' },
  done: { background: '#F1EADD', color: '#8C7E6B' },
}

// Derive a contact's outreach status from their append-only call_logs (latest wins).
function contactStatus(logs) {
  if (!logs || logs.length === 0) return 'To call'
  const latest = logs[0] // newest-first
  return OUTCOME_TO_STATUS[latest.reachability] || latest.reachability || 'Attempted'
}
function lastTouch(logs) {
  if (!logs || !logs.length) return '—'
  const d = new Date(logs[0].logged_at)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function Campaigns({ me, isCoordinator = false, onToast }) {
  const [campaigns, setCampaigns] = useState(null)
  const [journeys, setJourneys] = useState([])
  const [logsByJourney, setLogsByJourney] = useState({})
  const [callerNames, setCallerNames] = useState({}) // `${source}:${id}` -> name
  const [callerPools, setCallerPools] = useState({}) // campaign_id -> [{key,source,id,name,profileId}]
  const [actorNames, setActorNames] = useState({}) // profile.id -> full_name (call_logs actor)
  const [err, setErr] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [callFilter, setCallFilter] = useState('all')
  const [showTest, setShowTest] = useState(false)

  const load = useCallback(async () => {
    try {
      const { data: camps, error: e1 } = await supabase
        .from('campaigns')
        .select('id, name, goal, script, message, whatsapp_template, sms_template, segment, audience, status, center_id, created_at, is_test')
        .order('created_at', { ascending: false })
      if (e1) throw e1

      const { data: js, error: e2 } = await supabase
        .from('journeys')
        .select(
          'id, campaign_id, status, assigned_to, caller_source, caller_id, ' +
            'person:people!journeys_person_id_fkey(id, full_name, phone, center_id), ' +
            'assignee:profiles!journeys_assigned_to_fkey(full_name)',
        )
        .not('campaign_id', 'is', null)
        .limit(2000)
      if (e2) throw e2

      // Resolve callers (whichever source) to names, and build each campaign's caller
      // POOL (from segment.callers ∪ callers seen on journeys) with profile ids for
      // reassignment targets. Nurturing-team callers carry a profile_id (login); volunteer
      // callers are assignment-only (no login), so assigned_to stays null for them.
      const poolSpec = {} // campaign_id -> Set of "source:id"
      for (const c of camps || []) {
        const set = new Set()
        for (const cc of c.segment?.callers || []) if (cc?.source && cc?.id) set.add(`${cc.source}:${cc.id}`)
        poolSpec[c.id] = set
      }
      for (const j of js || []) {
        if (j.caller_source && j.caller_id) (poolSpec[j.campaign_id] ||= new Set()).add(`${j.caller_source}:${j.caller_id}`)
      }
      const allKeys = [...new Set(Object.values(poolSpec).flatMap((s) => [...s]))]
      const volIds = allKeys.filter((k) => k.startsWith('volunteer:')).map((k) => k.slice('volunteer:'.length))
      const nurIds = allKeys.filter((k) => k.startsWith('nurturing_team:')).map((k) => k.slice('nurturing_team:'.length))
      const names = {}
      const profileByKey = {}
      if (volIds.length) {
        const { data } = await supabase.from('people').select('id, full_name').in('id', volIds)
        for (const p of data || []) names['volunteer:' + p.id] = p.full_name
      }
      if (nurIds.length) {
        const { data } = await supabase.from('nurturers').select('id, full_name, profile_id').in('id', nurIds)
        for (const n of data || []) {
          names['nurturing_team:' + n.id] = n.full_name
          if (n.profile_id) profileByKey['nurturing_team:' + n.id] = n.profile_id
        }
      }
      const pools = {}
      for (const [cid, set] of Object.entries(poolSpec)) {
        pools[cid] = [...set].map((key) => {
          const [source, id] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)]
          return { key, source, id, name: names[key] || 'Unknown', profileId: profileByKey[key] || null }
        })
      }

      const jIds = (js || []).map((j) => j.id)
      let logs = []
      if (jIds.length) {
        const { data: ls, error: e3 } = await supabase
          .from('call_logs')
          .select('id, journey_id, reachability, remarks, logged_at, logged_by')
          .in('journey_id', jIds)
          .order('logged_at', { ascending: false })
        if (e3) throw e3
        logs = ls || []
      }
      const byJ = {}
      for (const c of logs) (byJ[c.journey_id] ||= []).push(c)
      const actorIds = [...new Set(logs.map((l) => l.logged_by).filter(Boolean))]
      const actors = {}
      if (actorIds.length) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', actorIds)
        for (const p of profs || []) actors[p.id] = p.full_name
      }

      setCampaigns(camps || [])
      setJourneys(js || [])
      setLogsByJourney(byJ)
      setCallerNames(names)
      setCallerPools(pools)
      setActorNames(actors)
    } catch (e) {
      setErr(e.message || String(e))
    }
  }, [])

  useEffect(() => {
    let alive = true
    load().finally(() => alive)
    return () => { alive = false }
  }, [load])

  // Build per-campaign contact rows + aggregates.
  const enriched = useMemo(() => {
    const map = {}
    for (const c of campaigns || []) {
      map[c.id] = { ...c, contacts: [], removed: [], callers: {}, callerPool: callerPools[c.id] || [] }
    }
    for (const j of journeys) {
      const bucket = map[j.campaign_id]
      if (!bucket) continue
      const logs = logsByJourney[j.id] || []
      const status = contactStatus(logs)
      const callerKey = j.caller_source && j.caller_id ? `${j.caller_source}:${j.caller_id}` : null
      const assignee = (callerKey && callerNames[callerKey]) || j.assignee?.full_name || null
      const src = j.caller_source === 'nurturing_team' ? ' · Team' : j.caller_source === 'volunteer' ? ' · Volunteer' : ''
      const row = {
        journeyId: j.id,
        personId: j.person?.id || null,
        name: j.person?.full_name || 'Unknown',
        phone: j.person?.phone || '',
        callerKey,
        assigned: assignee ? assignee + src : '— unassigned —',
        last: lastTouch(logs),
        status,
        logs,
      }
      if (j.status === 'dropped') {
        bucket.removed.push(row)
        continue
      }
      bucket.contacts.push(row)
      if (assignee) {
        const k = (bucket.callers[callerKey || assignee] ||= { key: callerKey, name: assignee + src, assigned: 0, contacted: 0, responded: 0 })
        k.assigned += 1
        if (logs.length) k.contacted += 1
        if (status === 'Replied' || status === 'Enrolled') k.responded += 1
      }
    }
    for (const c of Object.values(map)) {
      c.reach = c.contacts.length
      c.responded = c.contacts.filter((x) => x.status === 'Replied' || x.status === 'Enrolled').length
      c.enrolled = c.contacts.filter((x) => x.status === 'Enrolled').length
      c.responsePct = c.reach ? Math.round((c.responded / c.reach) * 100) + '%' : '0%'
      c.callerList = Object.values(c.callers).map((k) => ({ ...k, rate: k.contacted ? Math.round((k.responded / k.contacted) * 100) + '%' : '—' }))
    }
    return map
  }, [campaigns, journeys, logsByJourney, callerNames, callerPools])

  const loading = !campaigns && !err
  const open = openId ? enriched[openId] : null

  if (loading) return <Pad>Loading campaigns…</Pad>
  if (err)
    return (
      <Pad>
        <div className="card" style={{ padding: 14, borderColor: '#E7C9B8', background: '#FBEEE6', color: '#9C4A14', fontSize: 13 }}>
          Couldn't load campaigns: {err}
        </div>
      </Pad>
    )

  if (open)
    return (
      <Detail
        c={open}
        me={me}
        isCoordinator={isCoordinator}
        logsByJourney={logsByJourney}
        actorNames={actorNames}
        reload={load}
        onBack={() => setOpenId(null)}
        callFilter={callFilter}
        setCallFilter={setCallFilter}
        onToast={onToast}
      />
    )

  const allCamps = campaigns || []
  const testCount = allCamps.filter((c) => c.is_test).length
  // Test campaigns are hidden from the real list (and their stats never count) by default.
  const visibleCamps = allCamps.filter((c) => (showTest ? c.is_test : !c.is_test))

  return (
    <Pad>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 18 }}>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)', maxWidth: 560 }}>
          Pinpointed campaigns for volunteers and meditators — matched to insights so the right programme reaches the right cohort at the right time.
        </p>
        {testCount > 0 && (
          <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '8px 12px' }} onClick={() => setShowTest((s) => !s)}>
            {showTest ? 'Hide test' : `Show test (${testCount})`}
          </button>
        )}
      </div>
      {visibleCamps.length === 0 && (
        <div className="card" style={{ padding: 28, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          {showTest ? 'No test campaigns.' : 'No campaigns yet. Create one from the Dashboard insights or the Volunteers list.'}
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', gap: 16 }}>
        {visibleCamps.map((c) => {
          const e = enriched[c.id]
          return (
            <div key={c.id} className="rowhover card" style={{ padding: 21, display: 'flex', flexDirection: 'column', cursor: 'pointer', ...(c.is_test ? { borderColor: '#E7C9B8', background: '#FDF7EF' } : {}) }} onClick={() => setOpenId(c.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 13 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.25 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{c.audience || c.goal || '—'}</div>
                </div>
                <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                  {c.is_test && <span className="pill" style={{ background: '#F6E0CE', color: '#B5532F' }}>test</span>}
                  <span className="pill" style={CAMP_STATUS_PILL[c.status] || CAMP_STATUS_PILL.active}>{c.status}</span>
                </div>
              </div>
              <div style={{ display: 'flex', gap: 22, padding: '13px 0', borderTop: '1px solid #F2EBDD', borderBottom: '1px solid #F2EBDD', marginBottom: 13 }}>
                <Metric v={e.reach} label="reached" />
                <Metric v={e.responsePct} label="responded" color="#4E7C3F" />
                <Metric v={e.enrolled} label="enrolled" />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 12.5, lineHeight: 1.45, color: '#B0601E', background: '#FBF1E4', padding: '10px 12px', borderRadius: 10 }}>
                {Icon.campaigns(15)}
                <span>{c.goal || `${e.reach} contacts · ${e.callerList.length} caller(s) assigned.`}</span>
              </div>
            </div>
          )
        })}
      </div>
    </Pad>
  )
}

function Metric({ v, label, color }) {
  return (
    <div>
      <div style={{ fontFamily: "'Newsreader',serif", fontSize: 20, fontWeight: 600, lineHeight: 1, color: color || 'var(--ink)' }}>{v}</div>
      <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 3 }}>{label}</div>
    </div>
  )
}

function Pad({ children }) {
  return <div className="main-pad" style={{ padding: '26px 32px 60px', overflowY: 'auto' }}>{children}</div>
}

// Compact labelled stat used in the phone caller cards (the desktop table shows
// these as columns instead).
function CallerStat({ v, label, color }) {
  return (
    <div>
      <div style={{ fontSize: 15, fontWeight: 600, lineHeight: 1, color: color || '#3A3024' }}>{v}</div>
      <div style={{ fontSize: 10.5, color: 'var(--muted-2)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

function Detail({ c, me, isCoordinator, logsByJourney, actorNames, reload, onBack, callFilter, setCallFilter, onToast }) {
  const { isPhone } = useBreakpoint()
  const [logFor, setLogFor] = useState(null) // {journeyId, personId, name, phone}
  const [showRemoved, setShowRemoved] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [addRecipients, setAddRecipients] = useState(false)
  const [addCaller, setAddCaller] = useState(false)
  const [busyDel, setBusyDel] = useState(false)
  const myId = me?.id
  const myName = me?.full_name || ''

  // Test campaigns are hard-deletable regardless of activity (their activity was never
  // real). Delete the journeys first (SET NULL would orphan them) — that CASCADES their
  // calls/call_logs — then the campaign. Never offered for real campaigns.
  async function deleteTestCampaign() {
    if (!c.is_test) return
    if (!window.confirm(`Permanently delete the TEST campaign “${c.name}” and all its recipients, calls and logs? This cannot be undone.`)) return
    setBusyDel(true)
    try {
      const { error: ej } = await supabase.from('journeys').delete().eq('campaign_id', c.id)
      if (ej) throw ej
      const { error: ec } = await supabase.from('campaigns').delete().eq('id', c.id)
      if (ec) throw ec
      onToast('Test campaign deleted.')
      await reload()
      onBack()
    } catch (e) { onToast('Could not delete: ' + (e.message || e)) } finally { setBusyDel(false) }
  }

  // Every person already in the campaign (active or removed) — so Add can't duplicate.
  const existingPersonIds = useMemo(
    () => new Set([...c.contacts, ...c.removed].map((x) => x.personId).filter(Boolean)),
    [c.contacts, c.removed],
  )
  const existingCallerKeys = useMemo(() => new Set(c.callerPool.map((x) => x.key)), [c.callerPool])

  const chips = [
    { key: 'all', label: 'All' },
    { key: 'To call', label: 'To call' },
    { key: 'Call back', label: 'Call back' },
    { key: 'Replied', label: 'Replied' },
    { key: 'Enrolled', label: 'Enrolled' },
  ]
  const counts = c.contacts.reduce((a, x) => ((a[x.status] = (a[x.status] || 0) + 1), a), {})
  const shown = [...c.contacts]
    .filter((x) => callFilter === 'all' || x.status === callFilter)
    .sort((a, b) => (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9))

  // ---- coordinator mutations (RLS is the real backstop) ----
  async function removeRecipient(row) {
    if (!window.confirm(`Remove ${row.name} from this campaign? Their call history is kept; they're marked removed, not deleted.`)) return
    setBusyId(row.journeyId)
    try {
      const { error } = await supabase.from('journeys').update({ status: 'dropped' }).eq('id', row.journeyId)
      if (error) throw error
      onToast?.(`${row.name} removed (history kept).`)
      await reload()
    } catch (e) { onToast?.('Could not remove: ' + (e.message || e)) } finally { setBusyId(null) }
  }
  async function restoreRecipient(row) {
    setBusyId(row.journeyId)
    try {
      const { error } = await supabase.from('journeys').update({ status: 'active' }).eq('id', row.journeyId)
      if (error) throw error
      onToast?.(`${row.name} restored.`)
      await reload()
    } catch (e) { onToast?.('Could not restore: ' + (e.message || e)) } finally { setBusyId(null) }
  }
  async function reassign(row, caller) {
    setBusyId(row.journeyId)
    try {
      const patch = caller
        ? { caller_source: caller.source, caller_id: caller.id, assigned_to: caller.profileId || null }
        : { caller_source: null, caller_id: null, assigned_to: null }
      const { error } = await supabase.from('journeys').update(patch).eq('id', row.journeyId)
      if (error) throw error
      onToast?.(caller ? `${row.name} assigned to ${caller.name}.` : `${row.name} unassigned.`)
      await reload()
    } catch (e) { onToast?.('Could not reassign: ' + (e.message || e)) } finally { setBusyId(null) }
  }
  async function removeCaller(caller) {
    const key = caller.key
    const affected = c.contacts.filter((x) => x.callerKey === key)
    if (!window.confirm(`Remove ${caller.name} as a caller? Their ${affected.length} assigned recipient(s) become unassigned for reassignment — nobody is deleted.`)) return
    setBusyId('caller:' + key)
    try {
      const ids = affected.map((x) => x.journeyId)
      if (ids.length) {
        const { error } = await supabase.from('journeys').update({ caller_source: null, caller_id: null, assigned_to: null }).in('id', ids)
        if (error) throw error
      }
      onToast?.(`${caller.name} removed — ${affected.length} recipient(s) now unassigned.`)
      await reload()
    } catch (e) { onToast?.('Could not remove caller: ' + (e.message || e)) } finally { setBusyId(null) }
  }

  const gridCols = isCoordinator ? '1.5fr 1.1fr 1.2fr 0.8fr 0.9fr 300px' : '1.7fr 1.2fr 1.3fr 0.9fr 1fr'
  const callerCols = isCoordinator ? '1.6fr 0.8fr 0.8fr 0.8fr 0.8fr 0.7fr' : '1.7fr 0.9fr 0.9fr 0.9fr 0.9fr'
  const unassignedCount = c.contacts.filter((x) => !x.callerKey).length

  return (
    <Pad>
      <div onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: 'var(--orange)', cursor: 'pointer', marginBottom: 16 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
        All campaigns
      </div>

      {/* header */}
      <div className="card" style={{ padding: 24, marginBottom: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 23, fontWeight: 600, margin: '0 0 4px' }}>{c.name}</h2>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{c.audience || c.goal || '—'}</div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {c.is_test && <span className="pill" style={{ background: '#F6E0CE', color: '#B5532F' }}>test</span>}
            <span className="pill" style={CAMP_STATUS_PILL[c.status] || CAMP_STATUS_PILL.active}>{c.status}</span>
            {isCoordinator && c.is_test && (
              <button disabled={busyDel} onClick={deleteTestCampaign} style={{ fontSize: 12.5, padding: '7px 12px', fontWeight: 600, borderRadius: 8, border: '1px solid #E7C9B8', background: '#fff', color: '#B5532F', cursor: busyDel ? 'default' : 'pointer' }}>Delete test campaign</button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 26, marginTop: 18, paddingTop: 18, borderTop: '1px solid #F2EBDD', flexWrap: 'wrap' }}>
          <Metric v={c.reach} label="reached" />
          <Metric v={c.responsePct} label="responded" color="#4E7C3F" />
          <Metric v={c.enrolled} label="enrolled" />
          <Metric v={c.callerList.length} label="callers" />
        </div>
      </div>

      {/* script + templates (coordinator can edit; callers see the same) */}
      <CampaignScriptPanel campaign={c} canEdit={isCoordinator} onSaved={reload} onToast={onToast} />

      {/* call list */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 3px' }}>Call list</h3>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--muted)' }}>
            Everyone in this cohort to be reached out to — and where each one stands.
            {isCoordinator && unassignedCount > 0 && <span style={{ color: '#B5532F', fontWeight: 600 }}> · {unassignedCount} unassigned</span>}
          </p>
        </div>
        {isCoordinator && (
          <button className="btn btn-primary" style={{ fontSize: 12.5, padding: '8px 14px' }} onClick={() => setAddRecipients(true)}>+ Add recipients</button>
        )}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {chips.map((f) => {
          const on = callFilter === f.key
          const n = f.key === 'all' ? c.contacts.length : counts[f.key] || 0
          return (
            <button key={f.key} onClick={() => setCallFilter(f.key)} className="btn" style={{ padding: '7px 13px', fontSize: 12.5, borderRadius: 20, background: on ? '#241B14' : '#fff', color: on ? '#F6ECDC' : 'var(--ink-soft)', border: on ? 'none' : '1px solid var(--border)' }}>
              {f.label} <span style={{ opacity: 0.6 }}>{n}</span>
            </button>
          )
        })}
      </div>
      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        {!isPhone && (
          <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 12, padding: '13px 22px', background: '#FAF4EA', borderBottom: '1px solid var(--border-soft)', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted-2)' }}>
            <span>Contact</span>
            <span>Phone</span>
            <span>Assigned to</span>
            <span>Last touch</span>
            <span>Status</span>
            {isCoordinator && <span>Actions</span>}
          </div>
        )}
        {shown.length === 0 && <div style={{ padding: 26, textAlign: 'center', fontSize: 13, color: 'var(--muted-2)' }}>No contacts in this status.</div>}

        {isPhone && shown.map((p, i) => (
          <div key={p.journeyId} className="rowhover" style={{ padding: 14, borderBottom: '1px solid #F4EEE2' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 11 }}>
              <div style={{ width: 38, height: 38, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{initials(p.name)}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <div style={{ fontSize: 14.5, fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
                  <span className="pill" style={pillFor(p.status)}>{p.status}</span>
                </div>
                <div style={{ fontSize: 12.5, color: p.phone ? 'var(--muted)' : 'var(--muted-2)', marginTop: 2 }}>{p.phone || 'no phone on record'}</div>
                <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 2 }}>Last touch: {p.last}{isCoordinator && p.logs[0] ? ` · by ${actorNames[p.logs[0].logged_by] || '—'}` : ''}</div>
              </div>
            </div>
            <div style={{ marginTop: 8 }}>
              {isCoordinator ? (
                <select
                  value={p.callerKey || ''}
                  disabled={busyId === p.journeyId}
                  onChange={(e) => reassign(p, c.callerPool.find((x) => x.key === e.target.value) || null)}
                  style={{ width: '100%', minHeight: 40, fontSize: 12.5, padding: '8px 10px', border: '1px solid var(--border)', borderRadius: 8, background: '#fff', color: p.callerKey ? '#3A3024' : '#B5532F' }}
                >
                  <option value="">— unassigned —</option>
                  {c.callerPool.map((cp) => <option key={cp.key} value={cp.key}>{cp.name}{cp.source === 'nurturing_team' ? ' · Team' : ' · Volunteer'}</option>)}
                </select>
              ) : (
                <div style={{ fontSize: 12.5, color: '#3A3024' }}>Assigned to: {p.assigned}</div>
              )}
            </div>
            {isCoordinator && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
                <ReachButtons phone={p.phone} smsText={fillTemplate(c.sms_template, { name: p.name, myName })} waText={fillTemplate(c.whatsapp_template, { name: p.name, myName })} />
                <button className="btn btn-ghost" style={{ padding: '9px 14px', fontSize: 12.5, minHeight: 40 }} onClick={() => setLogFor(p)}>Log</button>
                <button title="Remove from campaign" disabled={busyId === p.journeyId} onClick={() => removeRecipient(p)} style={{ padding: '9px 12px', fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: '1px solid #E7C9B8', background: '#fff', color: '#B5532F', cursor: 'pointer', marginLeft: 'auto', minHeight: 40 }}>✕ Remove</button>
              </div>
            )}
          </div>
        ))}

        {!isPhone && shown.map((p, i) => (
          <div key={p.journeyId} className="rowhover" style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 12, padding: '13px 22px', borderBottom: '1px solid #F4EEE2', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 600, flexShrink: 0 }}>{initials(p.name)}</div>
              <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
            </div>
            <div style={{ fontSize: 13, color: p.phone ? 'var(--ink-soft)' : 'var(--muted-2)' }}>{p.phone || 'no phone on record'}</div>
            <div style={{ fontSize: 13, color: '#3A3024' }}>
              {isCoordinator ? (
                <select
                  value={p.callerKey || ''}
                  disabled={busyId === p.journeyId}
                  onChange={(e) => reassign(p, c.callerPool.find((x) => x.key === e.target.value) || null)}
                  style={{ maxWidth: '100%', fontSize: 12.5, padding: '5px 6px', border: '1px solid var(--border)', borderRadius: 8, background: '#fff', color: p.callerKey ? '#3A3024' : '#B5532F' }}
                >
                  <option value="">— unassigned —</option>
                  {c.callerPool.map((cp) => <option key={cp.key} value={cp.key}>{cp.name}{cp.source === 'nurturing_team' ? ' · Team' : ' · Volunteer'}</option>)}
                </select>
              ) : p.assigned}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{p.last}</div>
            <div>
              <span className="pill" style={pillFor(p.status)}>{p.status}</span>
              {isCoordinator && p.logs[0] && <div style={{ fontSize: 10, color: 'var(--muted-2)', marginTop: 3 }}>by {actorNames[p.logs[0].logged_by] || '—'}</div>}
            </div>
            {isCoordinator && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <ReachButtons phone={p.phone} smsText={fillTemplate(c.sms_template, { name: p.name, myName })} waText={fillTemplate(c.whatsapp_template, { name: p.name, myName })} />
                <button className="btn btn-ghost" style={{ padding: '6px 9px', fontSize: 12 }} onClick={() => setLogFor(p)}>Log</button>
                <button title="Remove from campaign" disabled={busyId === p.journeyId} onClick={() => removeRecipient(p)} style={{ padding: '6px 8px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: '1px solid #E7C9B8', background: '#fff', color: '#B5532F', cursor: 'pointer' }}>✕</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* removed (soft-deleted) recipients — history preserved */}
      {isCoordinator && c.removed.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <button onClick={() => setShowRemoved((s) => !s)} className="btn btn-ghost" style={{ fontSize: 12.5, padding: '6px 12px' }}>
            {showRemoved ? 'Hide' : 'Show'} {c.removed.length} removed
          </button>
          {showRemoved && (
            <div className="card" style={{ overflow: 'hidden', marginTop: 10, opacity: 0.85 }}>
              {c.removed.map((p) => (
                <div key={p.journeyId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '11px 22px', borderBottom: '1px solid #F4EEE2' }}>
                  <div style={{ fontSize: 13, color: 'var(--muted)' }}><s>{p.name}</s> · {p.phone || 'no phone'} · {p.logs.length} log{p.logs.length !== 1 ? 's' : ''} kept</div>
                  <button disabled={busyId === p.journeyId} onClick={() => restoreRecipient(p)} className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }}>Restore</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* callers */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 3px' }}>Callers</h3>
          <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--muted)' }}>The volunteers &amp; team calling this cohort.</p>
        </div>
        {isCoordinator && (
          <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '8px 14px' }} onClick={() => setAddCaller(true)}>+ Add caller</button>
        )}
      </div>
      <div className="card" style={{ overflow: 'hidden' }}>
        {!isPhone && (
          <div style={{ display: 'grid', gridTemplateColumns: callerCols, gap: 12, padding: '13px 22px', background: '#FAF4EA', borderBottom: '1px solid var(--border-soft)', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted-2)' }}>
            <span>Caller</span>
            <span>Assigned</span>
            <span>Contacted</span>
            <span>Responded</span>
            <span>Reply rate</span>
            {isCoordinator && <span></span>}
          </div>
        )}
        {c.callerList.length === 0 && <div style={{ padding: 26, textAlign: 'center', fontSize: 13, color: 'var(--muted-2)' }}>No callers assigned yet.</div>}

        {isPhone && c.callerList.map((k, i) => (
          <div key={k.name} className="rowhover" style={{ padding: 14, borderBottom: '1px solid #F4EEE2' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div style={{ width: 36, height: 36, borderRadius: '50%', background: avatarFor(i + 2), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 600, flexShrink: 0 }}>{initials(k.name)}</div>
              <div style={{ fontSize: 14, fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.name}</div>
              {isCoordinator && k.key && <button title="Remove caller (recipients become unassigned)" disabled={busyId === 'caller:' + k.key} onClick={() => removeCaller(c.callerPool.find((x) => x.key === k.key) || { key: k.key, name: k.name })} style={{ padding: '8px 12px', fontSize: 12.5, fontWeight: 600, borderRadius: 8, border: '1px solid #E7C9B8', background: '#fff', color: '#B5532F', cursor: 'pointer', minHeight: 40 }}>Remove</button>}
            </div>
            <div style={{ display: 'flex', gap: 18, marginTop: 10, flexWrap: 'wrap' }}>
              <CallerStat v={k.assigned} label="assigned" color="#9C4A14" />
              <CallerStat v={k.contacted} label="contacted" />
              <CallerStat v={k.responded} label="responded" />
              <CallerStat v={k.rate} label="reply rate" />
            </div>
          </div>
        ))}

        {!isPhone && c.callerList.map((k, i) => (
          <div key={k.name} className="rowhover" style={{ display: 'grid', gridTemplateColumns: callerCols, gap: 12, padding: '14px 22px', borderBottom: '1px solid #F4EEE2', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarFor(i + 2), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(k.name)}</div>
              <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.name}</div>
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#9C4A14' }}>{k.assigned}</div>
            <div style={{ fontSize: 13.5, color: '#3A3024' }}>{k.contacted}</div>
            <div style={{ fontSize: 13.5, color: '#3A3024' }}>{k.responded}</div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{k.rate}</div>
            {isCoordinator && (
              <div>
                {k.key && <button title="Remove caller (recipients become unassigned)" disabled={busyId === 'caller:' + k.key} onClick={() => removeCaller(c.callerPool.find((x) => x.key === k.key) || { key: k.key, name: k.name })} style={{ padding: '5px 9px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: '1px solid #E7C9B8', background: '#fff', color: '#B5532F', cursor: 'pointer' }}>Remove</button>}
              </div>
            )}
          </div>
        ))}
      </div>

      {logFor && (
        <CallLogDialog
          journey={{ id: logFor.journeyId, person_id: logFor.personId, person: { full_name: logFor.name, phone: logFor.phone } }}
          logs={logsByJourney[logFor.journeyId] || []}
          actorNames={actorNames}
          myId={myId}
          onClose={() => setLogFor(null)}
          onSaved={reload}
          onToast={onToast}
        />
      )}

      {addRecipients && (
        <AddRecipientsDialog
          campaign={c}
          existingPersonIds={existingPersonIds}
          onClose={() => setAddRecipients(false)}
          onAdded={reload}
          onToast={onToast}
        />
      )}
      {addCaller && (
        <AddCallerDialog
          campaign={c}
          existingKeys={existingCallerKeys}
          onClose={() => setAddCaller(false)}
          onAdded={reload}
          onToast={onToast}
        />
      )}
    </Pad>
  )
}
