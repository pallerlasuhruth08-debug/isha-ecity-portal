import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { pill } from '../lib/ui'
import { Pad, ErrorCard } from '../components/View'
import KpiCard from '../components/KpiCard'

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

export default function Dashboard({ me, onNavigate }) {
  // Greeting name = the REAL logged-in profile (never a hardcoded/persona name).
  // Falls back to the email local-part, then a bare greeting.
  const rawName = (me?.full_name || '').trim() || (me?.email ? me.email.split('@')[0] : '')
  const firstName = rawName.split(/\s+/)[0]

  const [kpis, setKpis] = useState(null)
  const [err, setErr] = useState(null)

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
      cta: 'Open volunteers',
      to: 'volunteers',
      tint: 'var(--pill-warm-bg)', ink: 'var(--pill-warm-fg)',
    },
    {
      key: 'newIe',
      n: k.newIe,
      tag: 'NEW MEDITATORS',
      title: `${k.newIe} finished Inner Engineering in the last 60 days`,
      body: 'Early contact is when a new meditator is most open to staying connected.',
      cta: 'Open meditators',
      to: 'meditators',
      tint: 'var(--pill-orange-bg)', ink: 'var(--pill-orange-fg)',
    },
    {
      key: 'advance',
      n: k.advanceNew,
      tag: 'ADVANCE PROGRAMMES',
      title: `${k.advanceNew} advance-programme interests not yet contacted`,
      body: 'These people raised their hand and are still marked “new”.',
      cta: 'Open advance',
      to: 'advance',
      tint: 'var(--pill-rust-bg)', ink: 'var(--pill-rust-fg)',
    },
    {
      key: 'noPhone',
      n: k.noPhone,
      tag: 'DATA',
      title: `${k.noPhone} volunteers have no phone number on record`,
      body: 'They cannot be reached by call or WhatsApp until this is filled in.',
      cta: 'Open volunteers',
      to: 'volunteers',
      tint: 'var(--neutral-bg)', ink: 'var(--neutral-fg)',
    },
  ].filter((r) => r.n > 0)

  return (
    <Pad>
      <h2 className="dash-greeting" style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px' }}>Namaskaram{firstName ? `, ${firstName}` : ''}</h2>
      <div className="mobile-hide" style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 22 }}>
        Here's what's moving across the center today.
      </div>

      {err && <ErrorCard>Couldn't load live counts: {err}</ErrorCard>}

      {/* KPI grid */}
      <div
        className="dash-grid"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}
      >
        <KpiCard
          loading={loading}
          icon={Icon.volunteers(19)}
          tint="#F6E8D8"
          ink="#C2691F"
          value={k.activeVols}
          label="Active volunteers"
        />
        <KpiCard
          loading={loading}
          icon={Icon.interest(19)}
          tint="#E9F0EF"
          ink="#2F6E5E"
          value={k.newThisMonth}
          label="New this month"
        />
        <KpiCard
          loading={loading}
          icon={Icon.nurturing(19)}
          tint="#F3E3D2"
          ink="#9C4A14"
          value={k.inNurturing}
          label="In nurturing journey"
        />
        <KpiCard
          loading={loading}
          icon={Icon.planning(19)}
          tint="#EAF2E5"
          ink="#4E7C3F"
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
          tint="#F1EADD"
          ink="#7A5230"
          value={k.meditators}
          label="Meditators in care"
        />
        <KpiCard
          loading={loading}
          icon={Icon.phone(19)}
          tint="#FBE6E0"
          ink="#B5532F"
          value={k.quietVols}
          label="Volunteers quiet 90+ days"
        />
      </div>

      {/* Needs attention — every row is a live count, and only shows if it's real. */}
      <h3 style={{ fontSize: 'var(--fs-h2)', fontWeight: 600, margin: '0 0 6px' }}>Needs attention</h3>
      <div className="mobile-hide" style={{ fontSize: 'var(--fs-body)', color: 'var(--muted)', marginBottom: 14 }}>
        Counted live from your records right now. Open a list to act on it.
      </div>

      {loading && <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-body)' }}>Counting…</div>}

      {!loading && attention.length === 0 && (
        <div className="card" style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-body)' }}>
          Nothing needs attention right now.
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
              onClick={() => onNavigate(r.to)}
            >
              {r.cta}
            </button>
          </div>
        ))}
      </div>
    </Pad>
  )
}
