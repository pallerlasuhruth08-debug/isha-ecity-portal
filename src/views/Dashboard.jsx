import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { pill } from '../lib/ui'
import { Pad, ErrorCard } from '../components/View'
import KpiCard from '../components/KpiCard'
import { eventsNeedingAttention, groupPhases, fmtDay } from '../lib/planning'

// A count(*) helper — head:true keeps it cheap (no rows returned).
async function countRows(table, build = (q) => q) {
  const { count, error } = await build(
    supabase.from(table).select('*', { count: 'exact', head: true }),
  )
  if (error) throw error
  return count ?? 0
}

function monthStartISO() {
  const d = new Date()
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().slice(0, 10)
}
function weekStartISO() {
  const d = new Date()
  const day = (d.getDay() + 6) % 7 // Monday = 0
  const monday = new Date(d)
  monday.setDate(d.getDate() - day)
  return monday.toISOString().slice(0, 10)
}
function weekEndISO() {
  return new Date(new Date(weekStartISO()).getTime() + 6 * 86400000).toISOString().slice(0, 10)
}

// A worklist is read only if it fits on a screen. Past this, the rest is one tap
// away in the Event Hub — which is where you would go to act on them anyway.
const SHOW_EVENTS = 4

function daysAgoISO(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10)
}

export default function Dashboard({ me, onNavigate, onOpenList, onOpenEvent }) {
  // Greeting name = the REAL logged-in profile (never a hardcoded/persona name).
  // Falls back to the email local-part, then a bare greeting.
  const rawName = (me?.full_name || '').trim() || (me?.email ? me.email.split('@')[0] : '')
  const firstName = rawName.split(/\s+/)[0]

  const [kpis, setKpis] = useState(null)
  const [err, setErr] = useState(null)
  // Events whose preparation is slipping — ONE ROW PER EVENT, not one per phase.
  //
  // The first version of this shipped as a flat list of every flagged phase and was
  // an object lesson in optimising a component against the product: 56 rows, four
  // per event, for events as old as December 2025, pushed three screens of noise
  // above the actual people worklist. A list where everything is overdue is not a
  // signal. Now: finished events are dropped, phases roll up to their event, and
  // only the few most urgent are shown here — the rest live in the Event Hub, which
  // is where you would go to act on them anyway.
  const [attentionEvents, setAttentionEvents] = useState([])

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [
          activeVols, newThisMonth, inNurturing, activitiesWeek, meditators,
          quietVols, newIe, advanceNew, noPhone,
        ] = await Promise.all([
          countRows('people', (q) => q.eq('is_volunteer', true)),
          countRows('volunteer_profiles', (q) => q.gte('interest_date', monthStartISO())),
          // People who actually have a nurturer. This used to count `journeys` rows
          // with status='active' and call the result "In nurturing journey" — 6,954,
          // which was MORE than the 6,096 meditators and 1,285 volunteers on record,
          // because one person can hold several journeys. A number larger than the
          // population it describes teaches a coordinator to distrust the whole panel.
          countRows('nurturing_assignments', (q) => q.eq('active', true).not('nurturer_person_id', 'is', null)),
          // Bounded to THIS week at both ends. It was `>= monday` with no upper bound,
          // so every future activity ever scheduled counted as "this week".
          countRows('activities', (q) => q.gte('activity_date', weekStartISO()).lte('activity_date', weekEndISO()).is('archived_at', null)),
          countRows('people', (q) => q.eq('is_meditator', true)),
          // ---- the four numbers behind "Needs attention" — all live queries ----
          countRows('people', (q) => q.eq('is_volunteer', true).lt('last_active_date', daysAgoISO(90))),
          countRows('people', (q) => q.eq('is_meditator', true).gte('ie_date', daysAgoISO(60))),
          countRows('advanced_interest', (q) => q.eq('status', 'new')),
          countRows('people', (q) => q.eq('is_volunteer', true).is('phone', null)),
        ])
        if (!alive) return
        setKpis({ activeVols, newThisMonth, inNurturing, activitiesWeek, meditators, quietVols, newIe, advanceNew, noPhone })
      } catch (e) {
        if (alive) setErr(e.message || String(e))
      }
    })()
    return () => {
      alive = false
    }
  }, [])

  useEffect(() => {
    let alive = true
    ;(async () => {
      const [a, ph] = await Promise.all([
        supabase.from('activities').select('id, name, activity_date, start_date, end_date').is('archived_at', null),
        supabase.from('event_phases').select('activity_id, kind, sort_order, start_by, finish_by, started_at, completed_at'),
      ])
      if (!alive || a.error || ph.error) return
      setAttentionEvents(eventsNeedingAttention(a.data || [], groupPhases(ph.data)))
    })()
    return () => { alive = false }
  }, [])

  const loading = !kpis && !err
  const k = kpis || {}

  // Every row is a live count with a real destination. Nothing here is hardcoded —
  // a row only appears when its query actually returns people.
  const attention = [
    {
      key: 'quiet',
      n: k.quietVols,
      tag: 'VOLUNTEERS',
      title: `${k.quietVols} volunteers with no activity in 90+ days`,
      body: 'Worth a personal call from their nurturer before they drift further.',
      cta: 'Open these volunteers',
      to: 'volunteers', preset: { last: 'quiet' },
      tint: 'var(--pill-warm-bg)', ink: 'var(--pill-warm-fg)',
    },
    {
      key: 'newIe',
      n: k.newIe,
      tag: 'NEW MEDITATORS',
      title: `${k.newIe} finished Inner Engineering in the last 60 days`,
      body: 'Early contact is when a new meditator is most open to staying connected.',
      cta: 'Open these meditators',
      to: 'meditators', preset: { ieWindow: '60' },
      tint: 'var(--pill-orange-bg)', ink: 'var(--pill-orange-fg)',
    },
    {
      key: 'advance',
      n: k.advanceNew,
      tag: 'ADVANCE PROGRAMMES',
      title: `${k.advanceNew} advance-programme interests not yet contacted`,
      body: 'These people raised their hand and are still marked “new”.',
      cta: 'Open advance programmes',
      to: 'advance',
      tint: 'var(--pill-rust-bg)', ink: 'var(--pill-rust-fg)',
    },
    {
      key: 'noPhone',
      n: k.noPhone,
      tag: 'DATA',
      title: `${k.noPhone} volunteers have no phone number on record`,
      body: 'They cannot be reached by call or WhatsApp until this is filled in.',
      cta: 'Open these volunteers',
      to: 'volunteers', preset: { contact: 'no_phone' },
      tint: 'var(--neutral-bg)', ink: 'var(--neutral-fg)',
    },
    // The reason this card exists: with the KPI labels fixed, "People with a
    // nurturer" turned out to be 1 — in a database of 6,096 meditators and 1,285
    // volunteers. The old label counted `journeys` rows and read 6,954, which hid
    // the single most important fact about the product: its core loop is unused.
    //
    // Stated as a ratio rather than a scary absolute, and it links straight to the
    // list filtered to people who need one, where bulk assign already lives.
    ...(k.activeVols > 0 && k.inNurturing / k.activeVols < 0.25 ? [{
      key: 'nurturerGap',
      n: k.activeVols - k.inNurturing,
      tag: 'NURTURING',
      title: `Only ${k.inNurturing} of ${k.activeVols} volunteers has a nurturer`,
      body: 'Nurturing is what this centre runs on, and almost nobody is covered. Filter to the people who need one and assign in bulk.',
      cta: 'Open volunteers who need a nurturer',
      to: 'volunteers', preset: { nurt: 'needs' },
      tint: 'var(--pill-rust-bg)', ink: 'var(--pill-rust-fg)',
      unit: 'uncovered',
    }] : []),
  ].filter((r) => r.n > 0)

  return (
    <Pad>
      <h2 className="dash-greeting" style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px' }}>Namaskaram{firstName ? `, ${firstName}` : ''}</h2>
      <div className="mobile-hide" style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 22 }}>
        The work first, the numbers after.
      </div>

      {err && <ErrorCard>Couldn't load live counts: {err}</ErrorCard>}

      {/* Needs attention — every row is a live count, and only shows if it's real. */}
      <h3 style={{ fontSize: 'var(--fs-h2)', fontWeight: 600, margin: '0 0 6px' }}>Needs attention</h3>
      <div className="mobile-hide" style={{ fontSize: 'var(--fs-body)', color: 'var(--muted)', marginBottom: 14 }}>
        Counted live from your records right now. Opening a row takes you to that exact list, already filtered.
      </div>

      {loading && <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-body)' }}>Counting…</div>}

      {!loading && attention.length === 0 && attentionEvents.length === 0 && (
        <div className="card" style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-body)' }}>
          Nothing needs attention right now.
        </div>
      )}

      {/* Events whose preparation is slipping. Separate from the people rows because
          the unit of work is an EVENT, not a list of people — one click goes to that
          event's hub. Deliberately compact: at most SHOW_EVENTS rows, because a
          worklist that needs three screens of scrolling stops being read at all. */}
      {attentionEvents.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16, borderColor: 'var(--danger-border)', background: 'var(--danger-bg)' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--danger-fg)' }}>Event preparation slipping</div>
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--muted)' }}>
              {attentionEvents.length} upcoming {attentionEvents.length === 1 ? 'event' : 'events'}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {attentionEvents.slice(0, SHOW_EVENTS).map((r) => (
              <button key={r.event.id} className="rowhover" onClick={() => onOpenEvent?.(r.event.id)}
                style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 9, cursor: 'pointer', background: '#fff', border: '1px solid var(--danger-border)', textAlign: 'left', font: 'inherit', width: '100%' }}>
                <span className="pill" style={pill(r.overdue ? 'var(--danger-bg)' : 'var(--pill-orange-bg)', r.overdue ? 'var(--danger-fg)' : 'var(--pill-orange-fg)')}>
                  {r.overdue ? `${r.overdue} overdue` : `${r.atRisk} at risk`}
                </span>
                <span style={{ fontSize: 13.5, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.event.name}</span>
                {/* A recurring series puts two "Monthly Satsang" rows side by side.
                    Without its own date they are the same row twice and neither can
                    be acted on with any confidence. */}
                {(r.event.start_date || r.event.activity_date) && (
                  <span style={{ fontSize: 12, color: 'var(--muted)', whiteSpace: 'nowrap' }}>· {fmtDay(r.event.start_date || r.event.activity_date)}</span>
                )}
                {r.overdue > 0 && r.atRisk > 0 && (
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>· {r.atRisk} more at risk</span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted-2)', whiteSpace: 'nowrap' }}>
                  {r.earliest ? `due ${fmtDay(r.earliest)}` : ''}
                </span>
              </button>
            ))}
          </div>
          {attentionEvents.length > SHOW_EVENTS && (
            <button onClick={() => onNavigate('hub')}
              style={{ marginTop: 10, background: 'none', border: 'none', color: 'var(--danger-fg)', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}>
              {attentionEvents.length - SHOW_EVENTS} more in the Event Hub →
            </button>
          )}
        </div>
      )}

      <div className="dash-grid2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {!loading && attention.map((r) => (
          <div key={r.key} className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="pill" style={pill(r.tint, r.ink)}>{r.tag}</span>
              <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontWeight: 600 }}>
                {r.n} {r.unit || (r.n === 1 ? 'person' : 'people')}
              </span>
            </div>
            <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "'Newsreader',serif", color: 'var(--ink)' }}>
              {r.title}
            </div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--muted)', lineHeight: 1.5 }}>{r.body}</div>
            <button
              className="btn btn-primary"
              style={{ alignSelf: 'flex-start', marginTop: 2 }}
              onClick={() => (r.preset && onOpenList ? onOpenList(r.to, r.preset) : onNavigate(r.to))}
            >
              {r.cta}
            </button>
          </div>
        ))}
      </div>

      {/* The centre at a glance — deliberately BELOW the worklist. These numbers are
          orientation, not instruction; putting six of them above the fold made the
          landing screen a report when a coordinator needs it to be a to-do list.
          
          Every label here was rewritten to say what the query actually counts.
          "Active volunteers" counted every volunteer on record, active or not.
          "In nurturing journey" counted journey ROWS — 6,954, more than the whole
          database — and "Meditators in care" counted everyone flagged as a
          meditator, which is not care. Numbers that overstate the work being done
          are the same trust problem as the fake deltas this panel replaced; they
          are just harder to catch. "Volunteers quiet 90+ days" is gone from here
          because it is already a worklist card above, with a button that opens the
          list — a number you cannot act on next to the same number you can is
          noise. */}
      <h3 style={{ fontSize: 'var(--fs-h2)', fontWeight: 600, margin: '30px 0 14px' }}>The centre at a glance</h3>
      <div
        className="dash-grid"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}
      >
        <KpiCard
          loading={loading}
          icon={Icon.volunteers(19)}
          tint="var(--pill-orange-bg)"
          ink="var(--pill-orange-fg)"
          value={k.activeVols}
          label="Volunteers on record"
        />
        <KpiCard
          loading={loading}
          icon={Icon.interest(19)}
          tint="var(--info-bg)"
          ink="var(--info-fg)"
          value={k.newThisMonth}
          label="New this month"
        />
        <KpiCard
          loading={loading}
          icon={Icon.nurturing(19)}
          tint="var(--pill-rust-bg)"
          ink="var(--pill-rust-fg)"
          value={k.inNurturing}
          label="People with a nurturer"
        />
        <KpiCard
          loading={loading}
          icon={Icon.planning(19)}
          tint="var(--success-bg)"
          ink="var(--success-fg)"
          value={k.activitiesWeek}
          label="Activities this week"
        />
      </div>
      <div
        className="dash-grid2"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 30 }}
      >
        <KpiCard
          loading={loading}
          icon={Icon.meditators(19)}
          tint="var(--neutral-bg)"
          ink="var(--ink-soft)"
          value={k.meditators}
          label="Meditators on record"
        />
      </div>

    </Pad>
  )
}
