import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { pill, initials, avatarFor } from '../lib/ui'

const STATUS_PILL = {
  'To call': pill('#F1EADD', '#8C7E6B'),
  'Call back': pill('#FBEAD9', '#C28A2A'),
  Attempted: pill('#F6E8D8', '#C2691F'),
  Replied: pill('#E9F0EF', '#2F6E5E'),
  Enrolled: pill('#EAF2E5', '#4E7C3F'),
  'Not now': pill('#FBE6E0', '#B5532F'),
}
const CAMP_STATUS_PILL = {
  active: pill('#EAF2E5', '#4E7C3F'),
  paused: pill('#FBEAD9', '#C28A2A'),
  done: pill('#F1EADD', '#8C7E6B'),
}
const ORDER = { 'To call': 0, 'Call back': 1, Attempted: 2, Replied: 3, Enrolled: 4, 'Not now': 5 }

// Derive a contact's outreach status from their calls (latest completed wins).
function contactStatus(calls) {
  const done = calls.filter((c) => c.completed_at).sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
  if (done.length === 0) return 'To call'
  const latest = done[0]
  const sad = (latest.sadhana_status || '').toLowerCase()
  if (sad.includes('enrol') || sad.includes('regist')) return 'Enrolled'
  if (latest.reachability === 'answered') return 'Replied'
  if (latest.reachability === 'will_call_back') return 'Call back'
  if (latest.reachability === 'not_reachable') return 'Attempted'
  return 'Attempted'
}

function lastTouch(calls) {
  const done = calls.filter((c) => c.completed_at).sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))
  if (!done.length) return '—'
  const d = new Date(done[0].completed_at)
  const days = Math.floor((Date.now() - d.getTime()) / 86400000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 30) return `${days}d ago`
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

function parseScript(script) {
  if (!script) return []
  return script
    .split(/\n+|(?=\d+[.)]\s)/)
    .map((s) => s.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean)
}

export default function Campaigns({ onToast }) {
  const [campaigns, setCampaigns] = useState(null)
  const [journeys, setJourneys] = useState([])
  const [callsByJourney, setCallsByJourney] = useState({})
  const [callerNames, setCallerNames] = useState({}) // `${source}:${id}` -> name
  const [err, setErr] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [callFilter, setCallFilter] = useState('all')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const { data: camps, error: e1 } = await supabase
          .from('campaigns')
          .select('id, name, goal, script, message, audience, status, center_id, created_at')
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

        // Resolve callers back to real people, whichever source they came from.
        const volIds = [...new Set((js || []).filter((j) => j.caller_source === 'volunteer' && j.caller_id).map((j) => j.caller_id))]
        const nurIds = [...new Set((js || []).filter((j) => j.caller_source === 'nurturing_team' && j.caller_id).map((j) => j.caller_id))]
        const names = {}
        if (volIds.length) {
          const { data } = await supabase.from('people').select('id, full_name').in('id', volIds)
          for (const p of data || []) names['volunteer:' + p.id] = p.full_name
        }
        if (nurIds.length) {
          const { data } = await supabase.from('nurturers').select('id, full_name').in('id', nurIds)
          for (const n of data || []) names['nurturing_team:' + n.id] = n.full_name
        }

        const jIds = (js || []).map((j) => j.id)
        let calls = []
        if (jIds.length) {
          const { data: cs, error: e3 } = await supabase
            .from('calls')
            .select('journey_id, completed_at, reachability, sadhana_status, remarks')
            .in('journey_id', jIds)
          if (e3) throw e3
          calls = cs || []
        }
        const byJ = {}
        for (const c of calls) (byJ[c.journey_id] ||= []).push(c)

        if (!alive) return
        setCampaigns(camps || [])
        setJourneys(js || [])
        setCallsByJourney(byJ)
        setCallerNames(names)
      } catch (e) {
        if (alive) setErr(e.message || String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  // Build per-campaign contact rows + aggregates.
  const enriched = useMemo(() => {
    const map = {}
    for (const c of campaigns || []) {
      map[c.id] = { ...c, contacts: [], callers: {} }
    }
    for (const j of journeys) {
      const bucket = map[j.campaign_id]
      if (!bucket) continue
      const calls = callsByJourney[j.id] || []
      const status = contactStatus(calls)
      // Resolve caller identically whichever source it came from; fall back to the
      // operating profile, then unassigned.
      const callerKey = j.caller_source && j.caller_id ? `${j.caller_source}:${j.caller_id}` : null
      const assignee = (callerKey && callerNames[callerKey]) || j.assignee?.full_name || null
      const src = j.caller_source === 'nurturing_team' ? ' · Team' : j.caller_source === 'volunteer' ? ' · Volunteer' : ''
      bucket.contacts.push({
        id: j.id,
        name: j.person?.full_name || 'Unknown',
        phone: j.person?.phone || '—',
        assigned: assignee ? assignee + src : '— unassigned —',
        last: lastTouch(calls),
        status,
      })
      if (assignee) {
        const k = (bucket.callers[assignee] ||= { name: assignee + src, assigned: 0, contacted: 0, responded: 0 })
        k.assigned += 1
        if (calls.some((c) => c.completed_at)) k.contacted += 1
        if (status === 'Replied' || status === 'Enrolled') k.responded += 1
      }
    }
    for (const c of Object.values(map)) {
      c.reach = c.contacts.length
      c.responded = c.contacts.filter((x) => x.status === 'Replied' || x.status === 'Enrolled').length
      c.enrolled = c.contacts.filter((x) => x.status === 'Enrolled').length
      c.responsePct = c.reach ? Math.round((c.responded / c.reach) * 100) + '%' : '0%'
      c.callerList = Object.values(c.callers).map((k) => ({
        ...k,
        rate: k.contacted ? Math.round((k.responded / k.contacted) * 100) + '%' : '—',
      }))
    }
    return map
  }, [campaigns, journeys, callsByJourney, callerNames])

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

  if (open) return <Detail c={open} onBack={() => setOpenId(null)} callFilter={callFilter} setCallFilter={setCallFilter} onToast={onToast} />

  return (
    <Pad>
      <p style={{ margin: '0 0 18px', fontSize: 13.5, color: 'var(--muted)', maxWidth: 560 }}>
        Pinpointed campaigns for volunteers and meditators — matched to insights so the right programme reaches the right cohort at the right time.
      </p>
      {(campaigns || []).length === 0 && (
        <div className="card" style={{ padding: 28, textAlign: 'center', color: 'var(--muted)', fontSize: 13 }}>
          No campaigns yet. Create one from the Dashboard insights or the Volunteers list.
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', gap: 16 }}>
        {(campaigns || []).map((c) => {
          const e = enriched[c.id]
          return (
            <div key={c.id} className="rowhover card" style={{ padding: 21, display: 'flex', flexDirection: 'column', cursor: 'pointer' }} onClick={() => setOpenId(c.id)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10, marginBottom: 13 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--ink)', lineHeight: 1.25 }}>{c.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 3 }}>{c.audience || c.goal || '—'}</div>
                </div>
                <span className="pill" style={CAMP_STATUS_PILL[c.status] || CAMP_STATUS_PILL.active}>
                  {c.status}
                </span>
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
  return (
    <div className="main-pad" style={{ padding: '26px 32px 60px', overflowY: 'auto' }}>
      {children}
    </div>
  )
}

function Detail({ c, onBack, callFilter, setCallFilter, onToast }) {
  const script = parseScript(c.script)
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
    .sort((a, b) => (ORDER[a.status] ?? 9) - (ORDER[b.status] ?? 9))

  return (
    <Pad>
      <div onClick={onBack} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: 'var(--orange)', cursor: 'pointer', marginBottom: 16 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M19 12H5M11 6l-6 6 6 6" />
        </svg>
        All campaigns
      </div>

      {/* header */}
      <div className="card" style={{ padding: 24, marginBottom: 22 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div style={{ minWidth: 0 }}>
            <h2 style={{ fontSize: 23, fontWeight: 600, margin: '0 0 4px' }}>{c.name}</h2>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{c.audience || c.goal || '—'}</div>
          </div>
          <span className="pill" style={CAMP_STATUS_PILL[c.status] || CAMP_STATUS_PILL.active}>
            {c.status}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 26, marginTop: 18, paddingTop: 18, borderTop: '1px solid #F2EBDD', flexWrap: 'wrap' }}>
          <Metric v={c.reach} label="reached" />
          <Metric v={c.responsePct} label="responded" color="#4E7C3F" />
          <Metric v={c.enrolled} label="enrolled" />
          <Metric v={c.callerList.length} label="callers" />
        </div>
      </div>

      {/* script + message */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 16, marginBottom: 24 }} className="dash-grid2">
        <div className="card" style={{ padding: '20px 22px' }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>Call script</h3>
          {script.length === 0 && <div style={{ fontSize: 13, color: 'var(--muted)' }}>No script set for this campaign yet.</div>}
          {script.map((s, i) => (
            <div key={i} style={{ display: 'flex', gap: 10, padding: '8px 0', borderBottom: '1px solid #F4EEE2' }}>
              <div style={{ width: 20, height: 20, borderRadius: '50%', background: '#F6E8D8', color: '#9C4A14', fontSize: 11, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 1 }}>
                {i + 1}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.5, color: 'var(--ink-soft)' }}>{s}</div>
            </div>
          ))}
        </div>
        <div className="card" style={{ padding: '20px 22px' }}>
          <h3 style={{ fontSize: 16, fontWeight: 600, margin: '0 0 12px' }}>Message template</h3>
          {c.message ? (
            <div>
              <span className="pill" style={pill('#E9F0EF', '#2F6E5E')}>
                WhatsApp / SMS
              </span>
              <p style={{ fontSize: 12.5, lineHeight: 1.55, color: 'var(--muted)', marginTop: 10 }}>{c.message}</p>
            </div>
          ) : (
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>No message template set.</div>
          )}
        </div>
      </div>

      {/* call list */}
      <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 3px' }}>Call list</h3>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--muted)' }}>Everyone in this cohort to be reached out to — and where each one stands.</p>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 14 }}>
        {chips.map((f) => {
          const on = callFilter === f.key
          const n = f.key === 'all' ? c.contacts.length : counts[f.key] || 0
          return (
            <button
              key={f.key}
              onClick={() => setCallFilter(f.key)}
              className="btn"
              style={{ padding: '7px 13px', fontSize: 12.5, borderRadius: 20, background: on ? '#241B14' : '#fff', color: on ? '#F6ECDC' : 'var(--ink-soft)', border: on ? 'none' : '1px solid var(--border)' }}
            >
              {f.label} <span style={{ opacity: 0.6 }}>{n}</span>
            </button>
          )
        })}
      </div>
      <div className="card" style={{ overflow: 'hidden', marginBottom: 28 }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 1.2fr 1.3fr 0.9fr 1fr', gap: 12, padding: '13px 22px', background: '#FAF4EA', borderBottom: '1px solid var(--border-soft)', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted-2)' }}>
          <span>Contact</span>
          <span>Phone</span>
          <span>Assigned to</span>
          <span>Last touch</span>
          <span>Status</span>
        </div>
        {shown.length === 0 && <div style={{ padding: 26, textAlign: 'center', fontSize: 13, color: 'var(--muted-2)' }}>No contacts in this status.</div>}
        {shown.map((p, i) => (
          <div key={p.id} className="rowhover" style={{ display: 'grid', gridTemplateColumns: '1.7fr 1.2fr 1.3fr 0.9fr 1fr', gap: 12, padding: '13px 22px', borderBottom: '1px solid #F4EEE2', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
              <div style={{ width: 32, height: 32, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 600, flexShrink: 0 }}>
                {initials(p.name)}
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{p.name}</div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{p.phone}</div>
            <div style={{ fontSize: 13, color: '#3A3024' }}>{p.assigned}</div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)' }}>{p.last}</div>
            <div>
              <span className="pill" style={STATUS_PILL[p.status]}>{p.status}</span>
            </div>
          </div>
        ))}
      </div>

      {/* callers */}
      <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 3px' }}>Callers</h3>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--muted)' }}>The volunteers calling &amp; messaging this cohort.</p>
      <div className="card" style={{ overflow: 'hidden' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1.7fr 0.9fr 0.9fr 0.9fr 0.9fr', gap: 12, padding: '13px 22px', background: '#FAF4EA', borderBottom: '1px solid var(--border-soft)', fontSize: 11, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--muted-2)' }}>
          <span>Caller</span>
          <span>Assigned</span>
          <span>Contacted</span>
          <span>Responded</span>
          <span>Reply rate</span>
        </div>
        {c.callerList.length === 0 && <div style={{ padding: 26, textAlign: 'center', fontSize: 13, color: 'var(--muted-2)' }}>No callers assigned yet.</div>}
        {c.callerList.map((k, i) => (
          <div key={k.name} className="rowhover" style={{ display: 'grid', gridTemplateColumns: '1.7fr 0.9fr 0.9fr 0.9fr 0.9fr', gap: 12, padding: '14px 22px', borderBottom: '1px solid #F4EEE2', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
              <div style={{ width: 34, height: 34, borderRadius: '50%', background: avatarFor(i + 2), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 600, flexShrink: 0 }}>
                {initials(k.name)}
              </div>
              <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{k.name}</div>
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#9C4A14' }}>{k.assigned}</div>
            <div style={{ fontSize: 13.5, color: '#3A3024' }}>{k.contacted}</div>
            <div style={{ fontSize: 13.5, color: '#3A3024' }}>{k.responded}</div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>{k.rate}</div>
          </div>
        ))}
      </div>
    </Pad>
  )
}
