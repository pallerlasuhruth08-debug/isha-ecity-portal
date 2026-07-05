import { useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { initials, avatarFor } from '../lib/ui'
import { Pad, ErrorCard, Loading, Empty } from '../components/View'
import { statusOf, pillFor, fmtWhen, DEFAULT_OUTCOME } from '../lib/calllog'
import { fillTemplate } from '../lib/phone'
import ReachButtons from '../components/ReachButtons'
import CallLogDialog from '../components/CallLogDialog'
import CampaignScriptPanel from '../components/CampaignScriptPanel'

export default function CallerWorkspace({ me, onToast }) {
  const myId = me?.id
  const myName = me?.full_name || ''
  const [journeys, setJourneys] = useState(null)
  const [logsByJ, setLogsByJ] = useState({}) // journey_id -> [call_logs] newest-first
  const [actorNames, setActorNames] = useState({}) // profile.id -> full_name
  const [err, setErr] = useState(null)
  const [openCampaign, setOpenCampaign] = useState(null)
  const [logFor, setLogFor] = useState(null) // journey being logged

  // Option B: tapping Call arms a return-prompt. When the caller comes back to the
  // tab (visible after it went hidden for the dialer), auto-open the log dialog.
  const [armed, setArmed] = useState(null)
  const wentHiddenRef = useRef(false)
  useEffect(() => {
    function onVis() {
      if (document.visibilityState === 'hidden') {
        if (armed) wentHiddenRef.current = true
      } else if (document.visibilityState === 'visible') {
        if (armed && wentHiddenRef.current) {
          setLogFor(armed)
          setArmed(null)
          wentHiddenRef.current = false
        }
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [armed])

  async function load() {
    if (!myId) {
      setErr('No profile id — sign in to see your assigned calls.')
      return
    }
    try {
      const { data: js, error } = await supabase
        .from('journeys')
        .select('id, person_id, campaign_id, status, person:people!journeys_person_id_fkey(full_name, phone), campaign:campaigns!journeys_campaign_id_fkey(id, name, audience, goal, script, whatsapp_template, sms_template, is_test)')
        .eq('assigned_to', myId)
        .not('campaign_id', 'is', null)
        .neq('status', 'dropped')
        .limit(1000)
      if (error) throw error
      const ids = (js || []).map((j) => j.id)
      let logs = []
      if (ids.length) {
        const { data: ls, error: e2 } = await supabase
          .from('call_logs')
          .select('id, journey_id, reachability, remarks, logged_at, logged_by')
          .in('journey_id', ids)
          .order('logged_at', { ascending: false })
        if (e2) throw e2
        logs = ls || []
      }
      const byJ = {}
      for (const l of logs) (byJ[l.journey_id] ||= []).push(l)
      // Resolve logged_by -> name so history shows who actually logged each call.
      const actorIds = [...new Set(logs.map((l) => l.logged_by).filter(Boolean))]
      const names = {}
      if (actorIds.length) {
        const { data: profs } = await supabase.from('profiles').select('id, full_name').in('id', actorIds)
        for (const p of profs || []) names[p.id] = p.full_name
      }
      setJourneys(js || [])
      setLogsByJ(byJ)
      setActorNames(names)
    } catch (e) {
      setErr(e.message || String(e))
    }
  }
  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myId])

  const campaigns = useMemo(() => {
    const map = {}
    for (const j of journeys || []) {
      const c = j.campaign
      if (!c || c.is_test) continue // test campaigns never appear in a caller's real worklist
      const g = (map[c.id] ||= { ...c, audience: c.audience || c.goal || '', journeys: [], assigned: 0, toCall: 0, logged: 0 })
      const logs = logsByJ[j.id] || []
      g.journeys.push(j)
      g.assigned += 1
      if (logs.length) g.logged += 1
      else g.toCall += 1
    }
    return Object.values(map)
  }, [journeys, logsByJ])

  const totals = useMemo(
    () => campaigns.reduce((a, c) => ({ assigned: a.assigned + c.assigned, toCall: a.toCall + c.toCall }), { assigned: 0, toCall: 0 }),
    [campaigns],
  )

  const loading = !journeys && !err
  if (loading) return <Pad><Loading label="Loading your call lists…" /></Pad>
  if (err) return <Pad><ErrorCard>{err}</ErrorCard></Pad>

  // ---- campaign call list ----
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
            <Stat v={c.toCall} label="to call" color="#C2691F" />
            <Stat v={c.logged} label="logged" color="#4E7C3F" />
          </div>
        </div>

        {/* Callers see the coordinator's current script + message templates (read-only). */}
        <CampaignScriptPanel campaign={c} />

        <div className="card" style={{ overflow: 'hidden' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 260px 90px', gap: 12, padding: '13px 20px', background: 'var(--panel)', borderBottom: '1px solid var(--border)', fontSize: 10.5, letterSpacing: '.08em', textTransform: 'uppercase', color: 'var(--muted-2)', fontWeight: 700 }}>
            <span>Contact</span>
            <span>Status</span>
            <span>Reach out</span>
            <span>Log</span>
          </div>
          {c.journeys.map((j, i) => {
            const logs = logsByJ[j.id] || []
            const status = statusOf(logs)
            const phone = j.person?.phone
            const last = logs[0]
            const name = j.person?.full_name || 'Unknown'
            return (
              <div key={j.id} className="rowhover" style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr 260px 90px', gap: 12, padding: '13px 20px', borderBottom: '1px solid #F1E9DB', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
                  <div style={{ width: 32, height: 32, borderRadius: '50%', background: avatarFor(i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11.5, fontWeight: 600, flexShrink: 0 }}>{initials(name)}</div>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 13.5, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{name}</div>
                    <div style={{ fontSize: 12, color: phone ? 'var(--ink-soft)' : 'var(--muted-2)' }}>{phone || 'no phone on record'}</div>
                  </div>
                </div>
                <div>
                  <span className="pill" style={pillFor(status)}>{status}</span>
                  {last && <div style={{ fontSize: 10.5, color: 'var(--muted-2)', marginTop: 4 }}>{logs.length} log{logs.length > 1 ? 's' : ''} · {fmtWhen(last.logged_at)} · by {actorNames[last.logged_by] || '—'}</div>}
                </div>
                <ReachButtons
                  phone={phone}
                  smsText={fillTemplate(c.sms_template, { name, myName })}
                  waText={fillTemplate(c.whatsapp_template, { name, myName })}
                  onArm={() => { setArmed(j); wentHiddenRef.current = false }}
                />
                <div>
                  <button className="btn btn-ghost" style={{ padding: '6px 11px', fontSize: 12 }} onClick={() => setLogFor(j)}>Log</button>
                </div>
              </div>
            )
          })}
          {c.journeys.length === 0 && <div style={{ padding: 22 }}><Empty label="No one assigned in this campaign." /></div>}
        </div>

        {logFor && (
          <CallLogDialog
            journey={logFor}
            logs={logsByJ[logFor.id] || []}
            actorNames={actorNames}
            myId={myId}
            onClose={() => setLogFor(null)}
            onSaved={load}
            onToast={onToast}
          />
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
          <Stat v={totals.toCall} label="still to call" color="#C2691F" />
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
              <Stat v={c.toCall} label="to call" color="#C2691F" small />
              <Stat v={c.logged} label="logged" color="#4E7C3F" small />
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
