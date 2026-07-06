import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Pad, ErrorCard, Loading, Empty } from '../components/View'
import { pill, initials, avatarFor } from '../lib/ui'
import { rangeLabel, groupPhases, phaseFlag, flaggedPhases, currentPhase, phaseTone, FLAG_META, PHASE_SHORT, fmtDay } from '../lib/planning'
import { ensureSeriesWindow } from '../lib/series'
import { fetchActivityTypes } from '../lib/activityTypes'
import EventList from '../components/EventList'
import { PlanningEvent } from './Planning'
import { Detail as AttendanceDetail, EventActions } from './Events'

// EVENT HUB — the home for events. The list surfaces overdue/at-risk phases across
// all events; opening one shows four LENSES over four separate tables joined by the
// event's id (Planning blocks, its Interest pool, its linked Campaigns, Attendance).
// Rows open their target directly — no intermediary "open" buttons.
export default function Hub({ me, isCoordinator, onToast, onOpenCampaign, onStartCampaign, onOpenInterestInbox, onCreateEvent, openEventId = null, onEventConsumed }) {
  const [events, setEvents] = useState(null)
  const [phasesByEvent, setPhasesByEvent] = useState({})
  const [err, setErr] = useState(null)
  const [openId, setOpenId] = useState(null)

  const load = useCallback(async () => {
    setErr(null)
    await ensureSeriesWindow().catch(() => {})
    const [a, p] = await Promise.all([
      supabase.from('activities').select('id, name, center_id, activity_date, start_date, end_date, series_id').is('archived_at', null).order('start_date', { ascending: true }),
      supabase.from('event_phases').select('activity_id, kind, label, sort_order, start_by, finish_by, started_at, completed_at'),
    ])
    if (a.error) { setErr(a.error.message); setEvents([]); return }
    setEvents(a.data || [])
    setPhasesByEvent(groupPhases(p.data))
  }, [])
  useEffect(() => { load() }, [load])

  // Open a specific event when routed here (calendar click, just-created event,
  // returning from a campaign sub-flow). This is what lets those flows land on the
  // event's HUB rather than the list / the wrong page.
  useEffect(() => {
    if (!openEventId || events === null) return
    if (events.some((e) => e.id === openEventId)) setOpenId(openEventId)
    onEventConsumed?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openEventId, events])

  if (err) return <Pad><ErrorCard>Couldn't load the hub: {err}</ErrorCard></Pad>
  if (!events) return <Pad><Loading label="Loading events…" /></Pad>

  if (openId) {
    const ev = events.find((e) => e.id === openId)
    if (!ev) { setOpenId(null); return null }
    return <EventHub ev={ev} me={me} isCoordinator={isCoordinator} onBack={() => setOpenId(null)} onOpenCampaign={onOpenCampaign} onStartCampaign={onStartCampaign} onOpenInterestInbox={onOpenInterestInbox} onToast={onToast} />
  }

  return (
    <Pad>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        <p style={{ margin: 0, fontSize: 13.5, color: 'var(--muted)', maxWidth: 520 }}>
          Every event and everything linked to it — planning, interest, campaigns and attendance. Overdue phases across all events surface up top.
        </p>
        {isCoordinator && onCreateEvent && (
          <button className="btn btn-primary" style={{ fontSize: 12.5, padding: '8px 14px' }} onClick={onCreateEvent}>＋ Create event</button>
        )}
      </div>
      <HubAttention events={events} phasesByEvent={phasesByEvent} onOpen={setOpenId} />
      <EventList events={events} phasesByEvent={phasesByEvent} onOpen={setOpenId} />
    </Pad>
  )
}

// Global "needs attention" — every OVERDUE / AT-RISK phase across all events, worst
// first. Clicking a row opens that event's hub. (Moved here from Planning, which is
// no longer a top-level tab.)
function HubAttention({ events, phasesByEvent, onOpen }) {
  const flagged = flaggedPhases(events, phasesByEvent)
  if (!flagged.length) return null
  return (
    <div className="card" style={{ padding: 16, marginBottom: 16, borderColor: '#EBC7BB', background: '#FDF3EF' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#B5391F" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" /><path d="M12 9v4M12 17h.01" /></svg>
        <div style={{ fontSize: 14, fontWeight: 600, color: '#8A2E18' }}>Needs attention</div>
        <span style={{ fontSize: 12, color: 'var(--muted)' }}>{flagged.length} phase{flagged.length > 1 ? 's' : ''} across all events</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {flagged.map(({ event, phase, flag }) => {
          const m = FLAG_META[flag]
          return (
            <div key={phase.activity_id + phase.kind} className="rowhover" onClick={() => onOpen(event.id)}
              style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, cursor: 'pointer', background: '#fff', border: '1px solid #F0DED6' }}>
              <span className="pill" style={{ background: m.bg, color: m.fg, fontSize: 10.5 }}>{m.label}</span>
              <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.name}</span>
              <span style={{ fontSize: 12, color: 'var(--muted)' }}>· {PHASE_SHORT[phase.kind] || phase.label}</span>
              <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted-2)', whiteSpace: 'nowrap' }}>
                {flag === 'overdue' ? `start by ${fmtDay(phase.start_by)}` : `finish by ${fmtDay(phase.finish_by)}`}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---- one event's hub: TABS, every one scoped to THIS event --------------------
function EventHub({ ev, me, isCoordinator, onBack, onOpenCampaign, onStartCampaign, onOpenInterestInbox, onToast }) {
  const [tab, setTab] = useState('planning')
  const [phases, setPhases] = useState([])
  const [types, setTypes] = useState([])
  const [reloadKey, setReloadKey] = useState(0)
  const reload = () => setReloadKey((k) => k + 1)

  useEffect(() => {
    let alive = true
    supabase.from('event_phases').select('kind, sort_order, start_by, finish_by, started_at, completed_at').eq('activity_id', ev.id).order('sort_order')
      .then(({ data }) => { if (alive) setPhases(data || []) })
    fetchActivityTypes().then((t) => { if (alive) setTypes(t || []) }).catch(() => {})
    return () => { alive = false }
  }, [ev.id])

  const cur = currentPhase(ev, phases)
  const flags = phases.map((p) => ({ kind: p.kind, flag: phaseFlag(p) })).filter((f) => f.flag)
  const TABS = [
    { k: 'planning', label: 'Planning' },
    { k: 'interest', label: 'Volunteer Interests' },
    { k: 'campaigns', label: 'Campaigns' },
    { k: 'attendance', label: 'Attendance' },
  ]

  return (
    <Pad>
      <button className="btn btn-ghost" style={{ fontSize: 13, marginBottom: 14 }} onClick={onBack}>← All events</button>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ minWidth: 0 }}>
          <h2 style={{ fontSize: 22, fontWeight: 600, margin: 0, fontFamily: "'Newsreader',serif" }}>
            {ev.name}{ev.series_id && <span title="Recurring occurrence" style={{ marginLeft: 8, fontSize: 15, color: 'var(--muted-2)' }}>↻</span>}
          </h2>
          <div style={{ fontSize: 13, color: 'var(--muted)', marginTop: 2 }}>{rangeLabel(ev.start_date || ev.activity_date, ev.end_date)} · {ev.center_id}</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
          <span className="pill" style={{ background: phaseTone(cur.kind).bg, color: phaseTone(cur.kind).fg }}>{cur.label}</span>
          <EventActions activity={ev} me={me} isCoordinator={isCoordinator} onToast={onToast} onChanged={reload} onDeleted={onBack} />
        </div>
      </div>

      {flags.length > 0 && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
          {flags.map((f) => (
            <span key={f.kind} className="pill" style={{ background: FLAG_META[f.flag].bg, color: FLAG_META[f.flag].fg, fontSize: 11.5 }}>{PHASE_SHORT[f.kind] || f.kind} · {FLAG_META[f.flag].label}</span>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', borderBottom: '1px solid var(--border)', marginBottom: 16 }}>
        {TABS.map((t) => (
          <button key={t.k} onClick={() => setTab(t.k)}
            style={{ padding: '9px 14px', fontSize: 13, fontWeight: 600, background: 'none', border: 'none', cursor: 'pointer', color: tab === t.k ? 'var(--ink)' : 'var(--muted)', borderBottom: tab === t.k ? '2px solid var(--orange)' : '2px solid transparent', marginBottom: -1 }}>
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'planning' && <PlanningEvent ev={ev} me={me} isCoordinator={isCoordinator} embedded onToast={onToast} onEventChanged={reload} />}
      {tab === 'interest' && <EventInterestTab ev={ev} isCoordinator={isCoordinator} onOpenInterestInbox={onOpenInterestInbox} />}
      {tab === 'campaigns' && <EventCampaignsTab ev={ev} isCoordinator={isCoordinator} onOpenCampaign={onOpenCampaign} onStartCampaign={onStartCampaign} />}
      {tab === 'attendance' && <AttendanceDetail activity={ev} me={me} isCoordinator={isCoordinator} types={types} embedded onToast={onToast} onActivityChanged={reload} />}
    </Pad>
  )
}

// Volunteer Interests tab — a READ-THROUGH of everyone who showed interest for THIS
// event. Import / scan / tag live in ONE place: the Interest Inbox. This tab links
// there (scoped to this event) rather than duplicating the importers.
function EventInterestTab({ ev, isCoordinator, onOpenInterestInbox }) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let alive = true
    supabase.from('event_interest')
      .select('id, source, created_at, person:people!event_interest_person_id_fkey(id, full_name, phone)')
      .eq('activity_id', ev.id).order('created_at', { ascending: false })
      .then(({ data }) => { if (alive) setRows(data || []) })
    return () => { alive = false }
  }, [ev.id])

  return (
    <div>
      {isCoordinator && (
        <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
          <button className="btn btn-ghost" style={{ fontSize: 12.5, padding: '8px 14px' }} onClick={() => onOpenInterestInbox?.(ev.id)}>Manage in interest inbox →</button>
          <span style={{ fontSize: 11.5, color: 'var(--muted-2)' }}>Add, scan or tag interest in the inbox — it opens scoped to this event.</span>
        </div>
      )}
      {!rows ? <Loading label="Loading interest…" /> : rows.length === 0 ? (
        <Empty label="No interests yet for this event." />
      ) : (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 12, color: 'var(--muted-2)', marginBottom: 8 }}>{rows.length} interested</div>
          {rows.map((r, i) => (
            <Row key={r.id} avatar={{ i, name: r.person?.full_name }} main={r.person?.full_name || 'Unknown'}
              side={<span style={{ fontSize: 11.5, color: 'var(--muted)' }}>{r.person?.phone || 'no phone'} · <SourcePill source={r.source} /></span>} />
          ))}
        </div>
      )}
    </div>
  )
}

// Linked Campaigns tab — ONLY campaigns for THIS event; create pre-attaches it.
function EventCampaignsTab({ ev, isCoordinator, onOpenCampaign, onStartCampaign }) {
  const [camps, setCamps] = useState(null)
  const [menu, setMenu] = useState(false)
  useEffect(() => {
    let alive = true
    supabase.from('campaigns').select('id, name, status, is_test, audience').eq('event_id', ev.id).order('created_at', { ascending: false })
      .then(({ data }) => { if (alive) setCamps(data || []) })
    return () => { alive = false }
  }, [ev.id])

  return (
    <div>
      {isCoordinator && (
        <div style={{ position: 'relative', marginBottom: 14 }}>
          <button className="btn btn-primary" style={{ fontSize: 12.5, padding: '8px 14px' }} onClick={() => setMenu((m) => !m)}>＋ Create campaign</button>
          {menu && (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setMenu(false)} />
              <div style={{ position: 'absolute', top: 40, left: 0, background: '#fff', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: 6, zIndex: 50, width: 230 }}>
                <div style={{ fontSize: 11, color: 'var(--muted-2)', padding: '4px 8px' }}>Pick who to call — you’ll select them next; they become the call list.</div>
                <div className="rowhover" style={{ padding: '9px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }} onClick={() => { setMenu(false); onStartCampaign && onStartCampaign(ev.id, ev.name, 'volunteer') }}>Recruit volunteers →</div>
                <div className="rowhover" style={{ padding: '9px 10px', borderRadius: 8, cursor: 'pointer', fontSize: 13, fontWeight: 600 }} onClick={() => { setMenu(false); onStartCampaign && onStartCampaign(ev.id, ev.name, 'meditator') }}>Invite meditators →</div>
              </div>
            </>
          )}
        </div>
      )}
      {!camps ? <Loading label="Loading campaigns…" /> : camps.length === 0 ? (
        <Empty label="No campaigns for this event yet." />
      ) : (
        <div className="card" style={{ padding: 16 }}>
          {camps.map((c) => (
            <Row key={c.id} onClick={() => onOpenCampaign && onOpenCampaign(c.id)}
              main={<>{c.name}{c.is_test && <span className="pill" style={{ ...pill('#F6E0CE', '#B5532F'), marginLeft: 6, fontSize: 10 }}>test</span>}</>}
              side={<span className="pill" style={statusPill(c.status)}>{c.status}</span>} />
          ))}
        </div>
      )}
    </div>
  )
}

function Row({ avatar, main, side, onClick }) {
  return (
    <div className={onClick ? 'rowhover' : undefined} onClick={onClick} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: '1px solid #F4EEE2', cursor: onClick ? 'pointer' : 'default' }}>
      {avatar && <div style={{ width: 28, height: 28, borderRadius: '50%', background: avatarFor(avatar.i), color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600, flexShrink: 0 }}>{initials(avatar.name || '?')}</div>}
      <div style={{ fontSize: 13, fontWeight: 500, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{main}</div>
      <div style={{ marginLeft: 'auto', flexShrink: 0 }}>{side}</div>
    </div>
  )
}

const SOURCE_TONE = { form: ['#E9F0EF', '#2F6E5E'], campaign: ['#F6E8D8', '#C2691F'], broadcast: ['#EAF2E5', '#4E7C3F'] }
function SourcePill({ source }) {
  const [bg, fg] = SOURCE_TONE[source] || ['#F1EADD', '#8C7E6B']
  return <span className="pill" style={{ background: bg, color: fg, fontSize: 10.5 }}>{source || 'other'}</span>
}
function statusPill(status) {
  const map = { active: ['#EAF2E5', '#4E7C3F'], paused: ['#FBEAD9', '#C28A2A'], done: ['#F1EADD', '#8C7E6B'] }
  const [bg, fg] = map[status] || map.active
  return { background: bg, color: fg }
}
