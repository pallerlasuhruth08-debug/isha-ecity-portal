import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { pill } from '../lib/ui'
import { Pad, ErrorCard } from '../components/View'
import KpiCard from '../components/KpiCard'
import { flaggedPhases, groupPhases, PHASE_SHORT, FLAG_META, fmtDay } from '../lib/planning'

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
  // Overdue / at-risk event phases across EVERY event. This list existed already,
  // buried in the Planning screen — which is only reachable per-event from a hub,
  // so the one view that answered "what is slipping anywhere?" could only be found
  // by someone who already knew where to look. It belongs on the worklist.
  const [flagged, setFlagged] = useState([])

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
          countRows('journeys', (q) => q.eq('status', 'active')),
          countRows('activities', (q) => q.gte('activity_date', weekStartISO())),
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
        supabase.from('activities').select('id, name').is('archived_at', null),
        supabase.from('event_phases').select('activity_id, kind, sort_order, start_by, finish_by, started_at, completed_at'),
      ])
      if (!alive || a.error || ph.error) return
      setFlagged(flaggedPhases(a.data || [], groupPhases(ph.data)))
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

      {!loading && attention.length === 0 && flagged.length === 0 && (
        <div className="card" style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-body)' }}>
          Nothing needs attention right now.
        </div>
      )}

      {/* Event phases that are slipping. Separate from the people rows above because
          the unit of work is an EVENT, not a list of people — one click goes straight
          to that event's hub rather than to a filtered list. */}
      {flagged.length > 0 && (
        <div className="card" style={{ padding: 16, marginBottom: 16, borderColor: 'var(--danger-border)', background: 'var(--danger-bg)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 'var(--fs-body)', fontWeight: 600, color: 'var(--danger-fg)' }}>Event preparation slipping</div>
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--muted)' }}>
              {flagged.length} phase{flagged.length > 1 ? 's' : ''} across all events
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {flagged.map(({ event, phase, flag }) => {
              const m = FLAG_META[flag]
              return (
                <button key={phase.activity_id + phase.kind} className="rowhover" onClick={() => onOpenEvent?.(event.id)}
                  style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 9, cursor: 'pointer', background: '#fff', border: '1px solid var(--danger-border)', textAlign: 'left', font: 'inherit', width: '100%' }}>
                  <span className="pill" style={pill(m.bg, m.fg)}>{m.label}</span>
                  <span style={{ fontSize: 13, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{event.name}</span>
                  <span style={{ fontSize: 12, color: 'var(--muted)' }}>· {PHASE_SHORT[phase.kind] || phase.kind}</span>
                  <span style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--muted-2)', whiteSpace: 'nowrap' }}>
                    {flag === 'overdue' ? `start by ${fmtDay(phase.start_by)}` : `finish by ${fmtDay(phase.finish_by)}`}
                  </span>
                </button>
              )
            })}
          </div>
        </div>
      )}

      <div className="dash-grid2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {!loading && attention.map((r) => (
          <div key={r.key} className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="pill" style={pill(r.tint, r.ink)}>{r.tag}</span>
              <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontWeight: 600 }}>
                {r.n} {r.n === 1 ? 'person' : 'people'}
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
          landing screen a report when a coordinator needs it to be a to-do list. */}
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
          label="Active volunteers"
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
          label="In nurturing journey"
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
          label="Meditators in care"
        />
        <KpiCard
          loading={loading}
          icon={Icon.phone(19)}
          tint="var(--danger-bg)"
          ink="var(--danger-fg)"
          value={k.quietVols}
          label="Volunteers quiet 90+ days"
        />
      </div>

    </Pad>
  )
}
