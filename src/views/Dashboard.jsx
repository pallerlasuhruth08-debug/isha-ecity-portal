import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { pill } from '../lib/ui'
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

// Insight-led recommended actions — ported from the design's recommendations engine.
const RECS = [
  {
    tag: 'NEW MEDITATORS',
    count: '63 people',
    title: '63 IE graduates from June not yet contacted',
    body: 'Reaching out within 2 weeks makes them 3× more likely to keep a daily practice.',
    tint: '#F6E8D8',
    ink: '#C2691F',
    track: 'new',
  },
  {
    tag: 'MEDITATORS',
    count: '28 people',
    title: '28 finished Shoonya last month — no check-in',
    body: 'Early care in the first month roughly doubles retention into daily sadhana.',
    tint: '#E9F0EF',
    ink: '#2F6E5E',
    track: 'meditators',
  },
  {
    tag: 'ADVANCE PROGRAMMES',
    count: '17 people',
    title: '17 BSP-interested meditators ready to register',
    body: 'They marked interest 2+ months ago — a nudge now converts best before the cohort fills.',
    tint: '#F3E3D2',
    ink: '#9C4A14',
    track: 'advance',
  },
  {
    tag: 'VOLUNTEERS',
    count: '12 people',
    title: '12 active volunteers quiet for 30+ days',
    body: 'A personal call from their nurturer lifts re-engagement roughly 3×.',
    tint: '#FBEAD9',
    ink: '#C28A2A',
    track: 'volunteer',
  },
]

const TRACK_TABS = [
  { key: 'all', label: 'All tracks' },
  { key: 'new', label: 'New meditators' },
  { key: 'advance', label: 'Advance programmes' },
  { key: 'volunteer', label: 'Volunteer nurturing' },
]

export default function Dashboard({ onToast, onNavigate }) {
  const [kpis, setKpis] = useState(null)
  const [err, setErr] = useState(null)
  const [track, setTrack] = useState('all')

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [activeVols, newThisMonth, inNurturing, activitiesWeek, meditators] = await Promise.all([
          countRows('people', (q) => q.eq('is_volunteer', true)),
          countRows('volunteer_profiles', (q) => q.gte('interest_date', monthStartISO())),
          countRows('journeys', (q) => q.eq('status', 'active')),
          countRows('activities', (q) => q.gte('activity_date', weekStartISO())),
          countRows('people', (q) => q.eq('is_meditator', true)),
        ])
        if (!alive) return
        setKpis({ activeVols, newThisMonth, inNurturing, activitiesWeek, meditators, ivr: 7 })
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
  const shownRecs = track === 'all' ? RECS : RECS.filter((r) => r.track === track)

  return (
    <div className="main-pad" style={{ padding: '26px 32px 60px', overflowY: 'auto' }}>
      <h2 style={{ fontSize: 25, fontWeight: 600, margin: '0 0 4px' }}>Good morning, Meera</h2>
      <div style={{ fontSize: 13.5, color: 'var(--muted)', marginBottom: 22 }}>
        Here's what's moving across the center today.
      </div>

      {err && (
        <div
          className="card"
          style={{ padding: 14, marginBottom: 18, borderColor: '#E7C9B8', background: '#FBEEE6', color: '#9C4A14', fontSize: 13 }}
        >
          Couldn't load live counts: {err}
        </div>
      )}

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
          badge="+12"
          badgeStyle={pill('#EAF2E5', '#4E7C3F')}
        />
        <KpiCard
          loading={loading}
          icon={Icon.interest(19)}
          tint="#E9F0EF"
          ink="#2F6E5E"
          value={k.newThisMonth}
          label="New this month"
          badge="new"
          badgeStyle={pill('#FBEAD9', '#C28A2A')}
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
          badge="+24"
          badgeStyle={pill('#EAF2E5', '#4E7C3F')}
        />
        <KpiCard
          loading={loading}
          icon={Icon.phone(19)}
          tint="#FBE6E0"
          ink="#B5532F"
          value={k.ivr}
          label="IVR callbacks"
          badge="pending"
          badgeStyle={pill('#FBEAD9', '#C28A2A')}
        />
      </div>

      {/* Recommended actions */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 6 }}>
        <h3 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Recommended actions</h3>
        <span className="pill" style={pill('#F1EADD', '#8C7E6B')}>
          AUTO-INSIGHT
        </span>
      </div>
      <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 14 }}>
        Where care and outreach will do the most — across new meditators, advance programmes and
        volunteer nurturing. Turn any one into a campaign.
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {TRACK_TABS.map((t) => {
          const on = t.key === track
          return (
            <button
              key={t.key}
              onClick={() => setTrack(t.key)}
              className="btn"
              style={{
                padding: '8px 14px',
                fontSize: 12.5,
                borderRadius: 20,
                background: on ? '#241B14' : '#fff',
                color: on ? '#F6ECDC' : 'var(--ink-soft)',
                border: on ? 'none' : '1px solid var(--border)',
              }}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <div className="dash-grid2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16 }}>
        {shownRecs.map((r, i) => (
          <div key={i} className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className="pill" style={pill(r.tint, r.ink)}>
                {r.tag}
              </span>
              <span style={{ fontSize: 12, color: 'var(--muted)', fontWeight: 600 }}>{r.count}</span>
            </div>
            <div style={{ fontSize: 15, fontWeight: 600, fontFamily: "'Newsreader',serif", color: 'var(--ink)' }}>
              {r.title}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--muted)', lineHeight: 1.5 }}>{r.body}</div>
            <button
              className="btn btn-primary"
              style={{ alignSelf: 'flex-start', marginTop: 2 }}
              onClick={() => {
                onNavigate('campaigns')
                onToast('Starting a campaign from this insight…')
              }}
            >
              Create campaign
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
