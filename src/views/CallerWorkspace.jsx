import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { pill, initials, avatarFor } from '../lib/ui'
import { Pad, ErrorCard, Loading, Empty } from '../components/View'

const OUTCOMES = [
  { key: 'answered', label: 'Answered' },
  { key: 'will_call_back', label: 'Will call back' },
  { key: 'not_reachable', label: 'Not reachable' },
]
const REACH_PILL = {
  answered: pill('#EAF2E5', '#4E7C3F'),
  will_call_back: pill('#FBEAD9', '#C28A2A'),
  not_reachable: pill('#FBE6E0', '#B5532F'),
  pending: pill('#F1EADD', '#8C7E6B'),
}

export default function CallerWorkspace({ myId, onToast }) {
  const [journeys, setJourneys] = useState(null)
  const [callsByJ, setCallsByJ] = useState({})
  const [err, setErr] = useState(null)
  const [openCampaign, setOpenCampaign] = useState(null)
  const [logFor, setLogFor] = useState(null) // journey being logged
  const [outcome, setOutcome] = useState('answered')
  const [remarks, setRemarks] = useState('')
  const [busy, setBusy] = useState(false)

  async function load() {
    if (!myId) {
      setErr('No profile id — sign in to see your assigned calls.')
      return
    }
    try {
      const { data: js, error } = await supabase
        .from('journeys')
        .select('id, campaign_id, person:people!journeys_person_id_fkey(full_name, phone), campaign:campaigns!journeys_campaign_id_fkey(id, name, audience, goal)')
        .eq('assigned_to', myId)
        .not('campaign_id', 'is', null)
        .limit(1000)
      if (error) throw error
      const ids = (js || []).map((j) => j.id)
      let calls = []
      if (ids.length) {
        const { data: cs, error: e2 } = await supabase
          .from('calls')
          .select('id, journey_id, call_no, due_date, completed_at, reachability, remarks')
          .in('journey_id', ids)
          .order('call_no', { ascending: true })
        if (e2) throw e2
        calls = cs || []
      }
      const byJ = {}
      for (const c of calls) (byJ[c.journey_id] ||= []).push(c)
      setJourneys(js || [])
      setCallsByJ(byJ)
    } catch (e) {
      setErr(e.message || String(e))
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId])

  // Group journeys by campaign, with assigned/remaining/done tallies.
  const campaigns = useMemo(() => {
    const map = {}
    for (const j of journeys || []) {
      const c = j.campaign
      if (!c) continue
      const g = (map[c.id] ||= { id: c.id, name: c.name, audience: c.audience || c.goal || '', journeys: [], assigned: 0, remaining: 0, done: 0 })
      const calls = callsByJ[j.id] || []
      const anyDone = calls.some((x) => x.completed_at)
      g.journeys.push(j)
      g.assigned += 1
      if (anyDone) g.done += 1
      else g.remaining += 1
    }
    return Object.values(map)
  }, [journeys, callsByJ])

  const totals = useMemo(
    () => campaigns.reduce((a, c) => ({ assigned: a.assigned + c.assigned, remaining: a.remaining + c.remaining }), { assigned: 0, remaining: 0 }),
    [campaigns],
  )

  function pendingCall(journeyId) {
    const calls = (callsByJ[journeyId] || []).filter((c) => !c.completed_at).sort((a, b) => a.call_no - b.call_no)
    return calls[0] || null
  }

  async function saveLog() {
    if (!logFor) return
    setBusy(true)
    try {
      const pend = pendingCall(logFor.id)
      const payload = { completed_at: new Date().toISOString(), reachability: outcome, remarks: remarks || null, logged_by: myId }
      if (pend) {
        const { error } = await supabase.from('calls').update(payload).eq('id', pend.id)
        if (error) throw error
      } else {
        const existing = callsByJ[logFor.id] || []
        const nextNo = existing.reduce((m, c) => Math.max(m, c.call_no), 0) + 1
        const { error } = await supabase.from('calls').insert({ journey_id: logFor.id, call_no: nextNo, due_date: new Date().toISOString().slice(0, 10), ...payload })
        if (error) throw error
      }
      onToast(`Call with ${logFor.person?.full_name || 'contact'} logged.`)
      setLogFor(null)
      setRemarks('')
      setOutcome('answered')
      load()
    } catch (e) {
      onToast('Could not log call: ' + (e.message || e))
    } finally {
      setBusy(false)
    }
  }

  const loading = !journeys && !err
  if (loading) return <Pad><Loading label="Loading your call lists…" /></Pad>
  if (err) return <Pad><ErrorCard>{err}</ErrorCard></Pad>

  // ---- campaign workspace ----
  if (openCampaign) {
    const c = campaigns.find((x) => x.id === openCampaign)
    if (!c) return <Pad><Empty label="Campaign not found." /></Pad>
    return (
      <Pad>
        <div onClick={() => setOpenCampaign(null)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: 'var(--orange)', cursor: 'pointer', marginBottom: 16 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M11 6l-6 6 6 6" /></svg>
          My campaigns
        </div>
        <div className="card" style={{ padding: 22, marginBottom: 18, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 14, flexWrap: 'wrap' }}>
          <div>
            <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px' }}>{c.name}</h2>
            <div style={{ fontSize: 13, color: 'var(--muted)' }}>{c.audience}</div>
          </div>
          <div style={{ display: 'flex', gap: 22 }}>
            <Stat v={c.assigned} label="assigned to me" color="#9C4A14" />
            <Stat v={c.remaining} label="to call" color="#C2691F" />
            <Stat v={c.done} label="done" color="#4E7C3F" />
          </div>
        </div>

        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.2fr 1fr 1fr', gap: 12, padding: '13px 20px', background: 'var(--panel)', borderBottom: '1px solid var(--border)', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700 }}>
            <span>Contact</span>
            <span>Phone</span>
            <span>Last outcome</span>
            <span>Action</span>
          </div>
          {c.journeys.map((j, i) => {
            const calls = callsByJ[j.id] || []
            const done = calls.filter((x) => x.completed_at).sort((a, b) => new Date(b.completed_at) - new Date(a.completed_at))[0]
            return (
              <div key={j.id} className="rowhover" style={{ display: 'grid', gridTemplateColumns: '1.8fr 1.2fr 1fr 1fr', gap: 12, padding: '13px 20px', borderBottom: '1px solid #F1E9DB', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 600 }}>{initials(j.person?.full_name || '?')}</div>
                  <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{j.person?.full_name || 'Unknown'}</div>
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{j.person?.phone || '—'}</div>
                <div><span className="pill" style={REACH_PILL[done?.reachability || 'pending']}>{done ? done.reachability.replace('_', ' ') : 'to call'}</span></div>
                <div>
                  <button className="btn btn-ghost" style={{ padding: '6px 11px', fontSize: 12 }} onClick={() => { setLogFor(j); setOutcome('answered'); setRemarks('') }}>
                    Log call
                  </button>
                </div>
              </div>
            )
          })}
        </div>

        {logFor && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(40,25,15,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100, padding: 20 }} onClick={() => setLogFor(null)}>
            <div className="card" style={{ width: 420, maxWidth: '100%', padding: 24, boxShadow: 'var(--shadow-lg)' }} onClick={(e) => e.stopPropagation()}>
              <h3 style={{ fontSize: 18, fontWeight: 600, margin: '0 0 4px' }}>Log call</h3>
              <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 16 }}>{logFor.person?.full_name} · {logFor.person?.phone || '—'}</div>
              <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                {OUTCOMES.map((o) => (
                  <button key={o.key} onClick={() => setOutcome(o.key)} className="btn" style={{ padding: '8px 13px', fontSize: 12.5, background: outcome === o.key ? '#241B14' : '#fff', color: outcome === o.key ? '#F6ECDC' : 'var(--ink-soft)', border: outcome === o.key ? 'none' : '1px solid var(--border)' }}>
                    {o.label}
                  </button>
                ))}
              </div>
              <textarea value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder="Remarks (optional)…" rows={3} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 12px', fontSize: 13, fontFamily: 'inherit', outline: 'none', resize: 'vertical', marginBottom: 16 }} />
              <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
                <button className="btn btn-ghost" onClick={() => setLogFor(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={busy} onClick={saveLog}>{busy ? 'Saving…' : 'Save call'}</button>
              </div>
            </div>
          </div>
        )}
      </Pad>
    )
  }

  // ---- caller home ----
  return (
    <Pad>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
        <div>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px' }}>My campaigns</h2>
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)' }}>The campaigns you're calling for, and how many calls are assigned to you.</p>
        </div>
        <div style={{ display: 'flex', gap: 24 }}>
          <Stat v={totals.assigned} label="calls assigned" color="#9C4A14" />
          <Stat v={totals.remaining} label="still to call" color="#C2691F" />
        </div>
      </div>

      {campaigns.length === 0 && <Empty label="No calls assigned to you yet." />}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(320px,1fr))', gap: 16 }}>
        {campaigns.map((c) => (
          <div key={c.id} className="rowhover card" style={{ padding: 21, cursor: 'pointer' }} onClick={() => setOpenCampaign(c.id)}>
            <div style={{ fontSize: 15.5, fontWeight: 600, marginBottom: 3 }}>{c.name}</div>
            <div style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 14 }}>{c.audience}</div>
            <div style={{ display: 'flex', gap: 22, paddingTop: 14, borderTop: '1px solid #F2EBDD' }}>
              <Stat v={c.assigned} label="assigned" color="#9C4A14" small />
              <Stat v={c.remaining} label="to call" color="#C2691F" small />
              <Stat v={c.done} label="done" color="#4E7C3F" small />
            </div>
          </div>
        ))}
      </div>
    </Pad>
  )
}

function Stat({ v, label, color, small }) {
  return (
    <div>
      <div style={{ fontFamily: "'Newsreader',serif", fontSize: small ? 22 : 26, fontWeight: 600, lineHeight: 1, color: color || 'var(--ink)' }}>{v}</div>
      <div style={{ fontSize: 11, color: 'var(--muted-2)', marginTop: 3 }}>{label}</div>
    </div>
  )
}
