import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { initials, avatarFor } from '../lib/ui'
import { STATUS_ORDER, OUTCOME_TO_STATUS, pillFor } from '../lib/calllog'
import { MESSAGE_STATUS, pillForMessage, labelForMessage } from '../lib/messageStatus'
import { fillTemplate } from '../lib/phone'
import { useBreakpoint } from '../lib/useBreakpoint'
import { Pad, ErrorCard } from '../components/View'
import ReachButtons from '../components/ReachButtons'
import CallLogDialog from '../components/CallLogDialog'
import CampaignScriptPanel from '../components/CampaignScriptPanel'
import AddCallerDialog from '../components/AddCallerDialog'
import EditCampaignDialog from '../components/EditCampaignDialog'
import KebabMenu from '../components/KebabMenu'
import SidePanel, { PanelHeader } from '../components/SidePanel'

const CAMP_STATUS_PILL = {
  active: { background: '#EAF2E5', color: '#4E7C3F' },
  paused: { background: '#FBEAD9', color: '#C28A2A' },
  done: { background: '#F1EADD', color: '#8C7E6B' },
}
// Campaign type badge: messaging (WhatsApp/SMS only) vs full (calls + messaging).
const TYPE_PILL = {
  messaging: { background: '#E4EEF6', color: '#2F5E86', label: 'Messaging' },
  full: { background: '#F1EADD', color: '#8C7E6B', label: 'Full' },
}
const typeOf = (c) => (c.campaign_type === 'messaging' ? 'messaging' : 'full')

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

export default function Campaigns({ me, isCoordinator = false, onToast, openCampaignId = null, onCampaignConsumed, onAddRecipients }) {
  const [campaigns, setCampaigns] = useState(null)
  const [journeys, setJourneys] = useState([])
  const [logsByJourney, setLogsByJourney] = useState({})
  const [callerNames, setCallerNames] = useState({}) // `${source}:${id}` -> name
  const [callerPools, setCallerPools] = useState({}) // campaign_id -> [{key,source,id,name,profileId}]
  const [actorNames, setActorNames] = useState({}) // profile.id -> full_name (call_logs actor)
  const [eventNames, setEventNames] = useState({}) // activity.id -> {name, activity_date} for linked events
  const [splitsByCampaign, setSplitsByCampaign] = useState({}) // campaign_id -> [campaign_splits row]
  const [err, setErr] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [editId, setEditId] = useState(null) // campaign being edited from the LIST view
  const [callFilter, setCallFilter] = useState('all')
  const [showTest, setShowTest] = useState(false)

  const load = useCallback(async () => {
    try {
      const { data: camps, error: e1 } = await supabase
        .from('campaigns')
        .select('id, name, goal, script, message, whatsapp_template, sms_template, segment, audience, status, center_id, created_at, is_test, event_id, edited_by, edited_at, campaign_type, portal_token')
        .order('created_at', { ascending: false })
      if (e1) throw e1

      // Resolve linked-event names (optional link; most campaigns have none).
      const evIds = [...new Set((camps || []).map((c) => c.event_id).filter(Boolean))]
      const evNames = {}
      if (evIds.length) {
        const { data: evs } = await supabase.from('activities').select('id, name, activity_date').in('id', evIds)
        for (const e of evs || []) evNames[e.id] = e
      }
      setEventNames(evNames)

      const { data: js, error: e2 } = await supabase
        .from('journeys')
        .select(
          'id, campaign_id, status, assigned_to, caller_source, caller_id, split_number, message_status, ' +
            'person:people!journeys_person_id_fkey(id, full_name, phone, center_id), ' +
            'assignee:profiles!journeys_assigned_to_fkey(full_name)',
        )
        .not('campaign_id', 'is', null)
        .limit(2000)
      if (e2) throw e2

      const { data: splits, error: e4 } = await supabase
        .from('campaign_splits')
        .select('id, campaign_id, split_number, share_token, created_at, claimed_by_name, claimed_by_phone, claimed_at, last_active_at')
        .order('split_number')
      if (e4) throw e4
      setSplitsByCampaign(
        (splits || []).reduce((m, s) => ((m[s.campaign_id] ||= []).push(s), m), {}),
      )

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

  // Open a specific campaign when routed here (e.g. from an event-hub row).
  useEffect(() => {
    if (!openCampaignId || !campaigns) return
    if (campaigns.some((c) => c.id === openCampaignId)) setOpenId(openCampaignId)
    onCampaignConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openCampaignId, campaigns])

  // A leftover call-status filter (e.g. "Replied") means nothing on a messaging
  // campaign's To message/Sent/Responded chips — reset on every campaign switch.
  useEffect(() => { setCallFilter('all') }, [openId])

  // Build per-campaign contact rows + aggregates.
  const enriched = useMemo(() => {
    const map = {}
    for (const c of campaigns || []) {
      map[c.id] = { ...c, contacts: [], removed: [], callers: {}, callerPool: callerPools[c.id] || [], splitCount: (splitsByCampaign[c.id] || []).length }
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
        messageStatus: j.message_status || 'to_message',
        logs,
        splitNumber: j.split_number ?? null,
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
      // Messaging-campaign counterpart to reach/responded/enrolled — mutually exclusive
      // buckets over message_status (no call ever happens for these campaigns).
      c.msgToMessage = c.contacts.filter((x) => x.messageStatus === 'to_message').length
      c.msgSent = c.contacts.filter((x) => x.messageStatus === 'sent').length
      c.msgResponded = c.contacts.filter((x) => x.messageStatus === 'responded').length
    }
    return map
  }, [campaigns, journeys, logsByJourney, callerNames, callerPools, splitsByCampaign])

  const loading = !campaigns && !err
  const open = openId ? enriched[openId] : null

  if (loading) return <Pad>Loading campaigns…</Pad>
  if (err)
    return (
      <Pad>
        <ErrorCard>Couldn't load campaigns: {err}</ErrorCard>
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
        eventNames={eventNames}
        splits={splitsByCampaign[openId] || []}
        reload={load}
        setJourneys={setJourneys}
        onBack={() => setOpenId(null)}
        callFilter={callFilter}
        setCallFilter={setCallFilter}
        onAddRecipients={onAddRecipients}
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
        <p className="mobile-hide" style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)', maxWidth: 560 }}>
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
                <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap', justifyContent: 'flex-end', alignItems: 'center' }}>
                  <span className="pill" style={{ background: TYPE_PILL[typeOf(c)].background, color: TYPE_PILL[typeOf(c)].color }}>{TYPE_PILL[typeOf(c)].label}</span>
                  {c.is_test && <span className="pill" style={{ background: '#F6E0CE', color: '#B5532F' }}>test</span>}
                  {c.event_id && <span className="pill" title={eventNames[c.event_id]?.name || 'Linked event'} style={{ background: '#F6E8D8', color: '#C2691F' }}>↻ event</span>}
                  <span className="pill" style={CAMP_STATUS_PILL[c.status] || CAMP_STATUS_PILL.active}>{c.status}</span>
                  {isCoordinator && (
                    <button title="Edit campaign" onClick={(ev) => { ev.stopPropagation(); setEditId(c.id) }} style={{ padding: '4px 9px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: '1px solid var(--border)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer' }}>Edit</button>
                  )}
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
      {editId && enriched[editId] && (
        <EditCampaignDialog campaign={enriched[editId]} me={me} onClose={() => setEditId(null)} onSaved={load} onToast={onToast} />
      )}
    </Pad>
  )
}

// Optional event link (both jobs via one field): PRESENT → recruiting campaign
// (acceptances flow to the event's interest pool via DB trigger, and it groups
// under the event in the hub). ABSENT → standalone campaign, unchanged. Linking
// is a write here; the hub only reads it.
function EventLinkControl({ campaign, eventName, isCoordinator, reload, onToast }) {
  const [editing, setEditing] = useState(false)
  const [events, setEvents] = useState(null)
  const [busy, setBusy] = useState(false)

  async function openPicker() {
    setEditing(true)
    if (events) return
    const { data } = await supabase.from('activities').select('id, name, activity_date').is('archived_at', null).order('start_date', { ascending: false }).limit(200)
    setEvents(data || [])
  }
  async function setEvent(eventId) {
    setBusy(true)
    const { error } = await supabase.from('campaigns').update({ event_id: eventId }).eq('id', campaign.id)
    setBusy(false)
    setEditing(false)
    if (error) return onToast('Could not update link: ' + error.message)
    onToast(eventId ? 'Campaign linked to event — acceptances now flow to its pool.' : 'Campaign unlinked (now standalone).')
    reload()
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-soft)', display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 12, color: 'var(--muted)' }}>Event link:</span>
      {campaign.event_id ? (
        <span className="pill" style={{ background: '#F6E8D8', color: '#C2691F' }}>↻ {eventName || 'linked event'}</span>
      ) : (
        <span style={{ fontSize: 12, color: 'var(--muted-2)' }}>None — standalone campaign</span>
      )}
      {isCoordinator && (
        editing ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select disabled={busy} defaultValue={campaign.event_id || ''} onChange={(e) => setEvent(e.target.value || null)}
              style={{ fontSize: 12, padding: '6px 9px', border: '1px solid var(--border)', borderRadius: 8, background: '#fff', color: 'var(--ink)', cursor: 'pointer' }}>
              <option value="">— No event (standalone) —</option>
              {(events || []).map((e) => <option key={e.id} value={e.id}>{e.name}{e.activity_date ? ` · ${e.activity_date}` : ''}</option>)}
            </select>
            <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }} onClick={() => setEditing(false)}>Cancel</button>
          </div>
        ) : (
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }} onClick={openPicker}>{campaign.event_id ? 'Change / unlink' : 'Link to event'}</button>
        )
      )}
    </div>
  )
}

const agoFrom = (iso) => {
  if (!iso) return ''
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} min ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  return `${Math.floor(hrs / 24)} day${Math.floor(hrs / 24) === 1 ? '' : 's'} ago`
}
const VERIFIED_LABEL = { phone: 'phone', email: 'email', coordinator: 'coordinator' }

// Divide the campaign's active recipients into N batches (random order, remainder
// to the first batches). Batches then self-assign via the ONE shared campaign
// portal link (campaigns.portal_token) — no per-batch link, no coordinator
// hand-assignment. Splitting only offered while none exist yet — redividing a
// live campaign would silently reshuffle recipients out from under volunteers
// already mid-way through their batch.
function CampaignSplits({ campaign, contacts, splits, myId, reload, onToast }) {
  const [n, setN] = useState(2)
  const [busy, setBusy] = useState(false)
  const [sessions, setSessions] = useState([])

  const portalLink = `${window.location.origin}${window.location.pathname}#volunteer-portal/${campaign.portal_token}`
  async function copyLink() {
    try {
      await navigator.clipboard.writeText(portalLink)
      onToast('Link copied.')
    } catch {
      onToast('Could not copy — link: ' + portalLink)
    }
  }

  const loadSessions = useCallback(() => {
    supabase.from('portal_sessions').select('id, phone, name, status, verified_by, batch_id, expires_at, first_used_at')
      .eq('campaign_id', campaign.id).order('first_used_at', { ascending: false })
      .then(({ data }) => setSessions(data || []))
  }, [campaign.id])
  useEffect(() => { loadSessions() }, [loadSessions])

  const verifiedByPhone = Object.fromEntries(sessions.filter((s) => s.status === 'approved').map((s) => [s.phone, s.verified_by]))
  const pending = sessions.filter((s) => s.status === 'pending')

  async function approveSession(s) {
    setBusy(true)
    try {
      const { error } = await supabase.from('portal_sessions').update({ status: 'approved', verified_by: 'coordinator', approved_by: myId, approved_at: new Date().toISOString() }).eq('id', s.id)
      if (error) throw error
      const { data, error: e2 } = await supabase.rpc('claim_portal_assign_batch', { p_token: campaign.portal_token, p_phone: s.phone })
      if (e2) throw e2
      onToast(`${s.name} approved` + (data?.status === 'ok' ? ' and assigned a batch.' : ' — no batch available yet.'))
      loadSessions(); reload()
    } catch (e) { onToast('Could not approve: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function rejectSession(s) {
    if (!window.confirm(`Reject ${s.name}'s access request?`)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('portal_sessions').update({ status: 'rejected' }).eq('id', s.id)
      if (error) throw error
      onToast(`${s.name} rejected.`)
      loadSessions()
    } catch (e) { onToast('Could not reject: ' + (e.message || e)) } finally { setBusy(false) }
  }
  // Frees the batch AND clears the volunteer's stored batch_id -- their next visit
  // (or 30s poll) re-runs auto-assignment and picks up a fresh one automatically.
  async function releaseBatch(s) {
    if (!window.confirm(`Release Split ${s.split_number}? ${s.claimed_by_name} will lose access; the batch becomes available again.`)) return
    setBusy(true)
    try {
      const { error } = await supabase.from('campaign_splits').update({ claimed_by_name: null, claimed_by_phone: null, claimed_at: null, last_active_at: null }).eq('id', s.id)
      if (error) throw error
      if (s.claimed_by_phone) await supabase.from('portal_sessions').update({ batch_id: null }).eq('campaign_id', campaign.id).eq('phone', s.claimed_by_phone)
      onToast(`Split ${s.split_number} released.`)
      loadSessions(); reload()
    } catch (e) { onToast('Could not release: ' + (e.message || e)) } finally { setBusy(false) }
  }
  async function extendSession(s) {
    const sess = sessions.find((x) => x.phone === s.claimed_by_phone)
    if (!sess) return onToast('No portal session found for this volunteer.')
    setBusy(true)
    try {
      const base = Math.max(new Date(sess.expires_at).getTime(), Date.now())
      const { error } = await supabase.from('portal_sessions').update({ expires_at: new Date(base + 24 * 3600 * 1000).toISOString() }).eq('id', sess.id)
      if (error) throw error
      onToast(`${s.claimed_by_name}'s session extended by 24 hours.`)
      loadSessions()
    } catch (e) { onToast('Could not extend: ' + (e.message || e)) } finally { setBusy(false) }
  }

  async function createSplits() {
    const total = contacts.length
    if (n < 2 || n > total) return onToast(`Enter a number between 2 and ${total}.`)
    setBusy(true)
    try {
      const shuffled = [...contacts]
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1))
        ;[shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      const base = Math.floor(total / n)
      const remainder = total % n
      const { data: rows, error: e1 } = await supabase
        .from('campaign_splits')
        .insert(Array.from({ length: n }, (_, i) => ({ campaign_id: campaign.id, split_number: i + 1 })))
        .select('id, split_number')
      if (e1) throw e1
      let cursor = 0
      for (let s = 1; s <= n; s++) {
        const size = base + (s <= remainder ? 1 : 0)
        const chunk = shuffled.slice(cursor, cursor + size)
        cursor += size
        if (chunk.length) {
          const { error: e2 } = await supabase.from('journeys').update({ split_number: s }).in('id', chunk.map((r) => r.journeyId))
          if (e2) throw e2
        }
      }
      onToast(`Split into ${n} groups.`)
      reload()
    } catch (e) { onToast('Could not split: ' + (e.message || e)) } finally { setBusy(false) }
  }

  if (splits.length === 0) {
    return (
      <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-soft)' }}>
        <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>Split the call list into batches. Volunteers self-assign to one via a single shared link — no per-batch link to hand out.</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input type="number" min={2} max={contacts.length} value={n} onChange={(e) => setN(Number(e.target.value))}
            style={{ width: 70, padding: '7px 9px', border: '1px solid var(--border)', borderRadius: 8, fontSize: 14, fontFamily: 'inherit' }} />
          <span style={{ fontSize: 12, color: 'var(--muted)' }}>batches from {contacts.length} people</span>
          <button className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }} disabled={busy || contacts.length < 2} onClick={createSplits}>{busy ? 'Splitting…' : 'Split into batches'}</button>
        </div>
      </div>
    )
  }

  return (
    <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border-soft)' }}>
      {pending.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: '#C2691F', marginBottom: 8 }}>Pending approvals</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {pending.map((s) => (
              <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5, padding: '8px 10px', background: '#FBF1E4', border: '1px solid #E7C9B8', borderRadius: 9 }}>
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#C2691F', flexShrink: 0 }} />
                <span style={{ fontWeight: 600 }}>{s.name}</span>
                <span style={{ color: 'var(--muted)' }}>{s.phone}</span>
                <span style={{ color: 'var(--muted)' }}>· Requested {agoFrom(s.first_used_at)}</span>
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                  <button className="btn btn-primary" disabled={busy} style={{ height: 30, padding: '0 11px', fontSize: 12 }} onClick={() => approveSession(s)}>Approve →</button>
                  <button disabled={busy} style={{ height: 30, padding: '0 11px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: '1px solid #E7C9B8', background: '#fff', color: 'var(--red)', cursor: 'pointer' }} onClick={() => rejectSession(s)}>Reject ✕</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted-2)' }}>Batches</div>
        <button className="btn btn-ghost" style={{ height: 28, padding: '0 10px', fontSize: 12, marginLeft: 'auto' }} disabled={busy} onClick={copyLink}>Copy portal link</button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {splits.map((s) => {
          const rows = contacts.filter((c) => c.splitNumber === s.split_number)
          const sent = rows.filter((c) => c.messageStatus && c.messageStatus !== 'to_message').length
          const pct = rows.length ? Math.round((sent / rows.length) * 100) : 0
          const claimed = !!s.claimed_by_phone
          return (
            <div key={s.id} style={{ padding: '10px 12px', border: '1px solid var(--border-soft)', borderRadius: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', fontSize: 12.5 }}>
                <span style={{ fontWeight: 600, flexShrink: 0 }}>Split {s.split_number}</span>
                <span style={{ color: 'var(--muted)' }}>{rows.length} people</span>
                <span style={{ color: 'var(--muted)' }}>{sent} sent</span>
                {claimed ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontWeight: 600, color: '#4E7C3F' }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#4E7C3F' }} />{s.claimed_by_name}
                  </span>
                ) : (
                  <span style={{ color: 'var(--muted-2)', fontWeight: 600 }}>Available</span>
                )}
                {claimed && (
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                    <button className="btn btn-ghost" style={{ height: 30, padding: '0 10px', fontSize: 12 }} disabled={busy} onClick={() => extendSession(s)}>+24hrs</button>
                    <button style={{ height: 30, padding: '0 10px', fontSize: 12, fontWeight: 600, borderRadius: 7, border: '1px solid #E7C9B8', background: '#fff', color: 'var(--red)', cursor: 'pointer' }} disabled={busy} onClick={() => releaseBatch(s)}>Release</button>
                  </div>
                )}
              </div>
              {rows.length > 0 && (
                <div style={{ height: 5, borderRadius: 3, background: '#EFE4D3', overflow: 'hidden', marginTop: 8 }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: 'var(--orange)', borderRadius: 3 }} />
                </div>
              )}
              {claimed && (
                <div style={{ fontSize: 11.5, color: 'var(--muted-2)', marginTop: 6 }}>
                  Verified: {VERIFIED_LABEL[verifiedByPhone[s.claimed_by_phone]] || 'unknown'} · Last active {agoFrom(s.last_active_at)}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function Metric({ v, label, color }) {
  return (
    <div>
      <div style={{ fontFamily: "'Newsreader',serif", fontSize: 20, fontWeight: 600, lineHeight: 1, color: color || 'var(--ink)' }}>{v}</div>
      <div style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 3 }}>{label}</div>
    </div>
  )
}

// Compact labelled stat used in the phone caller cards (the desktop table shows
// these as columns instead).
function CallerStat({ v, label, color }) {
  return (
    <div>
      <div style={{ fontSize: 16, fontWeight: 600, lineHeight: 1, color: color || 'var(--ink-soft)' }}>{v}</div>
      <div style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 2 }}>{label}</div>
    </div>
  )
}

// Messaging campaigns' mark-as-sent toggle. Unsent: neutral "Sent" (the action).
// Sent/Responded: green "✓ Sent" (the confirmation) — tapping it again asks before
// reverting, so an accidental double-tap can't silently wipe the record.
function SentButton({ status, onToggle, compact = false }) {
  const sent = status === 'sent' || status === 'responded'
  const base = compact ? { flex: 1, height: 36, fontSize: 14 } : { height: 36, padding: '0 12px', fontSize: 12 }
  return (
    <button onClick={onToggle} style={{ ...base, fontWeight: 600, borderRadius: 8, cursor: 'pointer', border: '1px solid ' + (sent ? '#4E7C3F' : 'var(--border)'), background: sent ? '#EAF2E5' : '#fff', color: sent ? '#4E7C3F' : 'var(--ink-soft)' }}>
      {sent ? '✓ Sent' : 'Sent'}
    </button>
  )
}

function Detail({ c, me, isCoordinator, logsByJourney, actorNames, eventNames = {}, splits = [], reload, setJourneys, onBack, callFilter, setCallFilter, onAddRecipients, onToast }) {
  const { isPhone } = useBreakpoint()
  const [logFor, setLogFor] = useState(null) // {journeyId, personId, name, phone}
  const [assignFor, setAssignFor] = useState(null) // recipient row being reassigned (kebab → Assign caller)
  const [detailFor, setDetailFor] = useState(null) // recipient row shown in the View-details panel
  const [showRemoved, setShowRemoved] = useState(false)
  const [busyId, setBusyId] = useState(null)
  const [addOpen, setAddOpen] = useState(false) // source-chooser popover
  const [addCaller, setAddCaller] = useState(false)
  const [detailTab, setDetailTab] = useState('calls') // 'calls' | 'callers'
  const [editing, setEditing] = useState(false)
  const [busyDel, setBusyDel] = useState(false)
  const [lastChannel, setLastChannel] = useState({}) // journeyId -> 'sms'|'whatsapp', last Message/WhatsApp link tapped
  const myId = me?.id
  const myName = me?.full_name || ''
  const messaging = c.campaign_type === 'messaging' // WhatsApp/SMS only — no call button, script or log

  // Messaging Sent/Responded — optimistic: flip journeys state immediately so the
  // badge/counts/pills update with no reload, then write; revert + toast on failure.
  function setMessageStatusOptimistic(row, next, write) {
    const prev = row.messageStatus
    setJourneys((js) => js.map((j) => (j.id === row.journeyId ? { ...j, message_status: next } : j)))
    write().catch((e) => {
      setJourneys((js) => js.map((j) => (j.id === row.journeyId ? { ...j, message_status: prev } : j)))
      onToast?.('Could not update: ' + (e.message || e))
    })
  }
  function markSent(row) {
    const channel = lastChannel[row.journeyId] || 'whatsapp'
    setMessageStatusOptimistic(row, 'sent', async () => {
      const { error: e1 } = await supabase.from('message_logs').insert({ journey_id: row.journeyId, campaign_id: c.id, person_id: row.personId, channel, sent_by: myId })
      if (e1) throw e1
      const { error: e2 } = await supabase.from('journeys').update({ message_status: 'sent' }).eq('id', row.journeyId)
      if (e2) throw e2
    })
  }
  function unmarkSent(row) {
    if (!window.confirm('Mark as not sent?')) return
    setMessageStatusOptimistic(row, 'to_message', async () => {
      const { error } = await supabase.from('journeys').update({ message_status: 'to_message' }).eq('id', row.journeyId)
      if (error) throw error
    })
  }
  function toggleSent(row) {
    if (row.messageStatus === 'sent' || row.messageStatus === 'responded') unmarkSent(row)
    else markSent(row)
  }
  function markResponded(row) {
    setMessageStatusOptimistic(row, 'responded', async () => {
      const { error } = await supabase.from('journeys').update({ message_status: 'responded' }).eq('id', row.journeyId)
      if (error) throw error
      // Feeds the person back into the linked event's Volunteer Interest pool, same
      // shape as any other event_interest row — coordinator approves from there same as usual.
      if (c.event_id && row.personId) {
        const { error: e2 } = await supabase.from('event_interest').upsert({ activity_id: c.event_id, person_id: row.personId, source: 'campaign_response' }, { onConflict: 'activity_id,person_id' })
        if (e2) throw e2
      }
    })
    onToast?.(`${row.name} marked Responded.`)
  }

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

  const existingCallerKeys = useMemo(() => new Set(c.callerPool.map((x) => x.key)), [c.callerPool])

  const chips = messaging
    ? [{ key: 'all', label: 'All' }, ...MESSAGE_STATUS.map((s) => ({ key: s.v, label: s.label }))]
    : [
        { key: 'all', label: 'All' },
        { key: 'To call', label: 'To call' },
        { key: 'Call back', label: 'Call back' },
        { key: 'Replied', label: 'Replied' },
        { key: 'Enrolled', label: 'Enrolled' },
      ]
  const statusKey = messaging ? 'messageStatus' : 'status'
  const counts = c.contacts.reduce((a, x) => ((a[x[statusKey]] = (a[x[statusKey]] || 0) + 1), a), {})
  const MESSAGE_ORDER = { to_message: 0, sent: 1, responded: 2 }
  const shown = [...c.contacts]
    .filter((x) => callFilter === 'all' || x[statusKey] === callFilter)
    .sort((a, b) => messaging
      ? (MESSAGE_ORDER[a.messageStatus] ?? 9) - (MESSAGE_ORDER[b.messageStatus] ?? 9)
      : (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9))

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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h2
              style={{
                fontSize: isPhone ? 20 : 22,
                fontWeight: 600,
                margin: '0 0 4px',
                ...(isPhone
                  ? { display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }
                  : { whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }),
              }}
            >
              {c.name}
            </h2>
            <div style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 10 }}>{c.audience || c.goal || '—'}</div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <span className="pill" style={{ background: TYPE_PILL[typeOf(c)].background, color: TYPE_PILL[typeOf(c)].color }}>{TYPE_PILL[typeOf(c)].label}</span>
              {c.is_test && <span className="pill" style={{ background: '#F6E0CE', color: 'var(--red)' }}>test</span>}
              <span className="pill" style={CAMP_STATUS_PILL[c.status] || CAMP_STATUS_PILL.active}>{c.status}</span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
            {isCoordinator && (
              <button onClick={() => setEditing(true)} className="btn btn-ghost" style={{ fontSize: 12, padding: '7px 12px' }}>Edit ✎</button>
            )}
            {isCoordinator && c.is_test && (
              <button disabled={busyDel} onClick={deleteTestCampaign} style={{ fontSize: 12, padding: '7px 12px', fontWeight: 600, borderRadius: 8, border: '1px solid #E7C9B8', background: '#fff', color: 'var(--red)', cursor: busyDel ? 'default' : 'pointer' }}>Delete test campaign</button>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 26, marginTop: 18, paddingTop: 18, borderTop: '1px solid var(--border-soft)', flexWrap: 'wrap' }}>
          {messaging ? (
            <>
              <Metric v={c.contacts.length} label="recipients" />
              <Metric v={c.msgSent} label="sent" color="#8A6D1B" />
              <Metric v={c.msgResponded} label="responded" color="#4E7C3F" />
              <Metric v={0} label="confirmed" />
            </>
          ) : (
            <>
              <Metric v={c.reach} label="reached" />
              <Metric v={c.responsePct} label="responded" color="#4E7C3F" />
              <Metric v={c.enrolled} label="enrolled" />
              <Metric v={c.callerList.length} label="callers" />
            </>
          )}
        </div>
        <EventLinkControl campaign={c} eventName={eventNames[c.event_id]?.name} isCoordinator={isCoordinator} reload={reload} onToast={onToast} />
        {isCoordinator && <CampaignSplits campaign={c} contacts={c.contacts} splits={splits} myId={myId} reload={reload} onToast={onToast} />}
        {c.edited_at && (
          <div style={{ marginTop: 12, fontSize: 12, color: 'var(--muted-2)' }}>
            Last edited {new Date(c.edited_at).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' })}
            {actorNames[c.edited_by] ? ` by ${actorNames[c.edited_by]}` : ''}
          </div>
        )}
      </div>

      {/* Three tabs: the recipient call list, the caller roster, and the call
          script / message templates (previously a stacked section — same
          content, just behind a tab now). */}
      <div className="scroll-tabs" style={{ display: 'flex', gap: 18, marginBottom: 16, borderBottom: '1px solid var(--border)' }}>
        {[
          { k: 'calls', label: `Call List (${c.contacts.length})` },
          { k: 'callers', label: `Callers (${c.callerList.length})` },
          { k: 'script', label: 'Script & Templates' },
        ].map((t) => (
          <button key={t.k} onClick={() => setDetailTab(t.k)}
            style={{ padding: '10px 2px', marginBottom: -1, fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', border: 'none', borderBottom: '2px solid ' + (detailTab === t.k ? 'var(--orange)' : 'transparent'), background: 'transparent', color: detailTab === t.k ? 'var(--ink)' : 'var(--muted)', cursor: 'pointer' }}>{t.label}</button>
        ))}
      </div>

      {detailTab === 'script' && (
        <CampaignScriptPanel campaign={c} canEdit={isCoordinator} onSaved={reload} onToast={onToast} hideScript={messaging} />
      )}

      {detailTab === 'calls' && (<>
      {/* call list */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 12 }}>
        {isCoordinator && (
          <div style={{ position: 'relative' }}>
            <button className="btn btn-primary" style={{ height: 36, padding: '0 14px', fontSize: 12 }} onClick={() => setAddOpen((v) => !v)}>+ Add recipients</button>
            {addOpen && (
              <>
                <div onClick={() => setAddOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 40 }} />
                <div className="card" style={{ position: 'absolute', left: 0, top: 'calc(100% + 6px)', zIndex: 41, minWidth: 210, padding: 6, boxShadow: 'var(--shadow-lg)' }}>
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '.05em', textTransform: 'uppercase', color: 'var(--muted-2)', padding: '8px 10px 4px' }}>Add from…</div>
                  {[
                    { src: 'interest', label: c.event_id ? 'Volunteer Interests (this event)' : 'Volunteer Interests' },
                    { src: 'volunteers', label: 'Volunteers' },
                    { src: 'meditators', label: 'Meditators' },
                  ].map((o) => (
                    <button key={o.src} onClick={() => { setAddOpen(false); onAddRecipients?.(c.id, c.name, o.src) }}
                      style={{ display: 'block', width: '100%', textAlign: 'left', padding: '9px 10px', fontSize: 14, fontWeight: 500, border: 'none', background: 'transparent', color: 'var(--ink)', cursor: 'pointer', borderRadius: 8 }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#F6EFE2')} onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>{o.label}</button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}
        {isCoordinator && unassignedCount > 0 && (
          <span className="pill" style={{ background: '#FBE6E0', color: 'var(--red)', fontWeight: 600 }}>{unassignedCount} unassigned ⚠</span>
        )}
      </div>
      <div className="scroll-tabs" style={{ display: 'flex', flexWrap: 'nowrap', overflowX: 'auto', gap: 8, marginBottom: 14 }}>
        {chips.map((f) => {
          const on = callFilter === f.key
          const n = f.key === 'all' ? c.contacts.length : counts[f.key] || 0
          return (
            <button key={f.key} onClick={() => setCallFilter(f.key)} className="btn" style={{ padding: '7px 13px', fontSize: 12, borderRadius: 20, background: on ? '#241B14' : '#fff', color: on ? '#F6ECDC' : 'var(--ink-soft)', border: on ? 'none' : '1px solid var(--border)', flexShrink: 0 }}>
              {f.label}{n > 0 && <span style={{ opacity: 0.6 }}> {n}</span>}
            </button>
          )
        })}
      </div>
      <div className="card" style={{ overflow: 'hidden', marginBottom: 16 }}>
        {!isPhone && (
          <div style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 12, padding: '13px 22px', background: '#FAF4EA', borderBottom: '1px solid var(--border-soft)', fontSize: 12, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted-2)' }}>
            <span>Contact</span>
            <span>Phone</span>
            <span>Assigned to</span>
            <span>Last touch</span>
            <span>Status</span>
            {isCoordinator && <span>Actions</span>}
          </div>
        )}
        {shown.length === 0 && <div style={{ padding: 26, textAlign: 'center', fontSize: 14, color: 'var(--muted-2)' }}>No contacts in this status.</div>}

        {isPhone && shown.map((p, i) => (
          <div key={p.journeyId} className="rowhover" onClick={() => setDetailFor(p)} style={{ padding: '8px 14px', borderBottom: '1px solid var(--border-soft)', cursor: 'pointer' }}>
            {/* Row 1: avatar, name + phone, status */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: 26, height: 26, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>{initials(p.name)}</div>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'baseline', gap: 6 }}>
                <span style={{ fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</span>
                <span style={{ fontSize: 12, color: p.phone ? 'var(--muted)' : 'var(--muted-2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.phone || 'no phone'}</span>
              </div>
              <span className="pill" style={{ ...(messaging ? pillForMessage(p.messageStatus) : pillFor(p.status)), flexShrink: 0 }}>{messaging ? labelForMessage(p.messageStatus) : p.status}</span>
            </div>
            {/* Row 2: Call, Message, WhatsApp, Log/Sent, ⋯ — equal width, one row */}
            {isCoordinator && (
              <div onClick={(e) => e.stopPropagation()} style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 6 }}>
                <ReachButtons compact phone={p.phone} messaging={messaging} onChannelTap={(ch) => setLastChannel((m) => ({ ...m, [p.journeyId]: ch }))} smsText={fillTemplate(c.sms_template, { name: p.name, myName })} waText={fillTemplate(c.whatsapp_template, { name: p.name, myName })} />
                {!messaging && <button style={{ flex: 1, height: 36, fontSize: 14, fontWeight: 600, borderRadius: 8, border: '1px solid var(--border)', background: '#fff', color: 'var(--ink-soft)', cursor: 'pointer' }} onClick={() => setLogFor(p)}>Log</button>}
                {messaging && <SentButton compact status={p.messageStatus} onToggle={() => toggleSent(p)} />}
                <KebabMenu buttonStyle={{ height: 36, width: 36, fontSize: 16 }} items={[
                  ...(messaging ? [{ label: '↩ Mark as Responded', onClick: () => markResponded(p), disabled: p.messageStatus === 'responded' }] : []),
                  { label: 'Assign caller', onClick: () => setAssignFor(p) },
                  { label: messaging ? '✕ Remove from campaign' : 'Remove', onClick: () => removeRecipient(p), danger: true, disabled: busyId === p.journeyId },
                  { label: messaging ? '👁 View profile' : 'View details', onClick: () => setDetailFor(p) },
                ]} />
              </div>
            )}
          </div>
        ))}

        {!isPhone && shown.map((p, i) => (
          <div key={p.journeyId} className="rowhover" style={{ display: 'grid', gridTemplateColumns: gridCols, gap: 12, padding: '13px 22px', borderBottom: '1px solid var(--border-soft)', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(p.name)}</div>
              <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
            </div>
            <div style={{ fontSize: 14, color: p.phone ? 'var(--ink-soft)' : 'var(--muted-2)' }}>{p.phone || 'no phone on record'}</div>
            <div style={{ fontSize: 14, color: 'var(--ink-soft)' }}>
              {isCoordinator ? (
                <select
                  value={p.callerKey || ''}
                  disabled={busyId === p.journeyId}
                  onChange={(e) => reassign(p, c.callerPool.find((x) => x.key === e.target.value) || null)}
                  style={{ maxWidth: '100%', fontSize: 12, padding: '5px 6px', border: '1px solid var(--border)', borderRadius: 8, background: '#fff', color: p.callerKey ? 'var(--ink-soft)' : 'var(--red)' }}
                >
                  <option value="">— unassigned —</option>
                  {c.callerPool.map((cp) => <option key={cp.key} value={cp.key}>{cp.name}{cp.source === 'nurturing_team' ? ' · Team' : ' · Volunteer'}</option>)}
                </select>
              ) : p.assigned}
            </div>
            <div style={{ fontSize: 12, color: 'var(--muted)' }}>{p.last}</div>
            <div>
              <span className="pill" style={messaging ? pillForMessage(p.messageStatus) : pillFor(p.status)}>{messaging ? labelForMessage(p.messageStatus) : p.status}</span>
              {isCoordinator && p.logs[0] && <div style={{ fontSize: 12, color: 'var(--muted-2)', marginTop: 3 }}>by {actorNames[p.logs[0].logged_by] || '—'}</div>}
            </div>
            {isCoordinator && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <ReachButtons phone={p.phone} messaging={messaging} onChannelTap={(ch) => setLastChannel((m) => ({ ...m, [p.journeyId]: ch }))} smsText={fillTemplate(c.sms_template, { name: p.name, myName })} waText={fillTemplate(c.whatsapp_template, { name: p.name, myName })} />
                {!messaging && <button className="btn btn-ghost" style={{ padding: '6px 9px', fontSize: 12 }} onClick={() => setLogFor(p)}>Log</button>}
                {messaging && <SentButton status={p.messageStatus} onToggle={() => toggleSent(p)} />}
                {messaging && (
                  <KebabMenu buttonStyle={{ height: 32, width: 32, fontSize: 14 }} items={[
                    { label: '↩ Mark as Responded', onClick: () => markResponded(p), disabled: p.messageStatus === 'responded' },
                    { label: '👁 View profile', onClick: () => setDetailFor(p) },
                  ]} />
                )}
                <button title="Remove from campaign" disabled={busyId === p.journeyId} onClick={() => removeRecipient(p)} style={{ padding: '6px 8px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: '1px solid #E7C9B8', background: '#fff', color: 'var(--red)', cursor: 'pointer' }}>✕</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {/* removed (soft-deleted) recipients — history preserved */}
      {isCoordinator && c.removed.length > 0 && (
        <div style={{ marginBottom: 28 }}>
          <button onClick={() => setShowRemoved((s) => !s)} className="btn btn-ghost" style={{ fontSize: 12, padding: '6px 12px' }}>
            {showRemoved ? 'Hide' : 'Show'} {c.removed.length} removed
          </button>
          {showRemoved && (
            <div className="card" style={{ overflow: 'hidden', marginTop: 10, opacity: 0.85 }}>
              {c.removed.map((p) => (
                <div key={p.journeyId} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '11px 22px', borderBottom: '1px solid var(--border-soft)' }}>
                  <div style={{ fontSize: 14, color: 'var(--muted)' }}><s>{p.name}</s> · {p.phone || 'no phone'} · {p.logs.length} log{p.logs.length !== 1 ? 's' : ''} kept</div>
                  <button disabled={busyId === p.journeyId} onClick={() => restoreRecipient(p)} className="btn btn-ghost" style={{ fontSize: 12, padding: '5px 10px' }}>Restore</button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      </>)}

      {detailTab === 'callers' && (<>
      {/* callers — no heading/description here, the tab label already says "Callers" */}
      {isCoordinator && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
          <button className="btn btn-ghost" style={{ height: 36, padding: '0 14px', fontSize: 12 }} onClick={() => setAddCaller(true)}>+ Add caller</button>
        </div>
      )}
      <div className="card" style={{ overflow: 'hidden' }}>
        {!isPhone && (
          <div style={{ display: 'grid', gridTemplateColumns: callerCols, gap: 12, padding: '13px 22px', background: '#FAF4EA', borderBottom: '1px solid var(--border-soft)', fontSize: 12, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted-2)' }}>
            <span>Caller</span>
            <span>Assigned</span>
            <span>Contacted</span>
            <span>Responded</span>
            <span>Reply rate</span>
            {isCoordinator && <span></span>}
          </div>
        )}
        {c.callerList.length === 0 && <div style={{ padding: 26, textAlign: 'center', fontSize: 14, color: 'var(--muted-2)' }}>No callers assigned yet.</div>}

        {isPhone && c.callerList.map((k, i) => (
          <div key={k.name} className="rowhover" style={{ padding: 14, borderBottom: '1px solid var(--border-soft)' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarFor(i + 2), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(k.name)}</div>
              <div style={{ fontSize: 16, fontWeight: 600, flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.name}</div>
              {isCoordinator && k.key && <button title="Remove caller (recipients become unassigned)" disabled={busyId === 'caller:' + k.key} onClick={() => removeCaller(c.callerPool.find((x) => x.key === k.key) || { key: k.key, name: k.name })} style={{ padding: '8px 12px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: '1px solid #E7C9B8', background: '#fff', color: 'var(--red)', cursor: 'pointer', minHeight: 40 }}>Remove</button>}
            </div>
            <div style={{ display: 'flex', gap: 18, marginTop: 10, flexWrap: 'wrap' }}>
              <CallerStat v={k.assigned} label="assigned" color="var(--rust)" />
              <CallerStat v={k.contacted} label="contacted" />
              <CallerStat v={k.responded} label="responded" />
              <CallerStat v={k.rate} label="reply rate" />
            </div>
          </div>
        ))}

        {!isPhone && c.callerList.map((k, i) => (
          <div key={k.name} className="rowhover" style={{ display: 'grid', gridTemplateColumns: callerCols, gap: 12, padding: '14px 22px', borderBottom: '1px solid var(--border-soft)', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarFor(i + 2), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>{initials(k.name)}</div>
              <div style={{ fontSize: 16, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.name}</div>
            </div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--rust)' }}>{k.assigned}</div>
            <div style={{ fontSize: 14, color: 'var(--ink-soft)' }}>{k.contacted}</div>
            <div style={{ fontSize: 14, color: 'var(--ink-soft)' }}>{k.responded}</div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>{k.rate}</div>
            {isCoordinator && (
              <div>
                {k.key && <button title="Remove caller (recipients become unassigned)" disabled={busyId === 'caller:' + k.key} onClick={() => removeCaller(c.callerPool.find((x) => x.key === k.key) || { key: k.key, name: k.name })} style={{ padding: '5px 9px', fontSize: 12, fontWeight: 600, borderRadius: 8, border: '1px solid #E7C9B8', background: '#fff', color: 'var(--red)', cursor: 'pointer' }}>Remove</button>}
              </div>
            )}
          </div>
        ))}
      </div>
      </>)}

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

      {addCaller && (
        <AddCallerDialog
          campaign={c}
          existingKeys={existingCallerKeys}
          onClose={() => setAddCaller(false)}
          onAdded={reload}
          onToast={onToast}
        />
      )}
      {editing && (
        <EditCampaignDialog campaign={c} me={me} onClose={() => setEditing(false)} onSaved={reload} onToast={onToast} />
      )}

      {assignFor && (
        <AssignCallerModal
          row={assignFor}
          callerPool={c.callerPool}
          busy={busyId === assignFor.journeyId}
          onAssign={(caller) => { reassign(assignFor, caller); setAssignFor(null) }}
          onClose={() => setAssignFor(null)}
        />
      )}
      {detailFor && (
        <RecipientDetailPanel row={detailFor} isCoordinator={isCoordinator} actorNames={actorNames} messaging={messaging} onClose={() => setDetailFor(null)} />
      )}
    </Pad>
  )
}

// Kebab → "Assign caller": the same reassignment the desktop row's inline <select>
// does, presented as a small modal instead of living directly on the mobile card.
function AssignCallerModal({ row, callerPool, busy, onAssign, onClose }) {
  return (
    <div className="modal-backdrop" style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 130, padding: 20 }} onClick={onClose}>
      <div className="card modal-sheet" style={{ width: 380, maxWidth: '100%', padding: 22 }} onClick={(e) => e.stopPropagation()}>
        <h3 style={{ fontSize: 17, fontWeight: 600, margin: '0 0 4px' }}>Assign caller</h3>
        <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>{row.name}</div>
        <select
          autoFocus
          disabled={busy}
          defaultValue={row.callerKey || ''}
          onChange={(e) => onAssign(callerPool.find((x) => x.key === e.target.value) || null)}
          style={{ width: '100%', minHeight: 44, fontSize: 14, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 9, background: '#fff', color: 'var(--ink)' }}
        >
          <option value="">— unassigned —</option>
          {callerPool.map((cp) => <option key={cp.key} value={cp.key}>{cp.name}{cp.source === 'nurturing_team' ? ' · Team' : ' · Volunteer'}</option>)}
        </select>
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}

// Kebab → "View details" (also opened by tapping the card): the fields dropped
// from the compact card — last touch and who's assigned.
function RecipientDetailPanel({ row, isCoordinator, actorNames, messaging = false, onClose }) {
  return (
    <SidePanel onClose={onClose}>
      <PanelHeader onClose={onClose}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{ width: 46, height: 46, borderRadius: '50%', background: avatarFor(0), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16, fontWeight: 600 }}>{initials(row.name)}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 style={{ fontSize: 20, fontWeight: 600, margin: '0 0 3px' }}>{row.name}</h2>
            <span className="pill" style={messaging ? pillForMessage(row.messageStatus) : pillFor(row.status)}>{messaging ? labelForMessage(row.messageStatus) : row.status}</span>
          </div>
        </div>
      </PanelHeader>
      <div style={{ padding: '20px 26px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <DetailField label="Phone" value={row.phone || 'No phone on record'} />
          {isCoordinator && <DetailField label="Assigned to" value={row.assigned} />}
          <DetailField label="Last touch" value={row.last + (isCoordinator && row.logs[0] ? ` · by ${actorNames[row.logs[0].logged_by] || '—'}` : '')} />
        </div>
      </div>
    </SidePanel>
  )
}
function DetailField({ label, value }) {
  return (<div><div style={{ fontSize: 12, color: 'var(--muted-2)', marginBottom: 4 }}>{label}</div><div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)' }}>{value}</div></div>)
}
