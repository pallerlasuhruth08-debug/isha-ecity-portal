import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { Icon } from '../lib/icons'
import { pill } from '../lib/ui'
import { Pad, ErrorCard } from '../components/View'
import KpiCard from '../components/KpiCard'
import PoojaReport from '../components/PoojaReport'

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

export default function Dashboard({ me, sections, isAdmin, onNavigate, onOpenList, onOpenEvent }) {
  // The Dashboard follows the role's SECTIONS, like the sidebar does. It used to
  // be one fixed screen of volunteer and meditator numbers, which was fine while
  // every role that could open it also held every people tab. A role built for
  // one job — a temple-offerings POC with only Consecrated spaces — would have
  // landed on ten counts about people he has no screen for, and if RLS hides
  // those tables from him, on an error card instead. So every count, card and
  // row here names the section it belongs to, and is only fetched and shown
  // when the role holds that section. Admin holds all of them.
  const has = (sec) => !!isAdmin || (sections || []).includes(sec)
  const secKey = (sections || []).join(',')
  // Any section the existing worklist and glance panels are about.
  const peopleRole = ['volunteers', 'meditators', 'advance', 'interest', 'nurturing', 'event_hub'].some(has)
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

  useEffect(() => {
    let alive = true
    // A count the role has no section for is not fetched — 0, not a request.
    const cnt = (sec, table, build) => (has(sec) ? countRows(table, build) : Promise.resolve(0))
    ;(async () => {
      try {
        const [
          activeVols, newThisMonth, inNurturing, activitiesWeek, meditators,
          quietVols, newIe, advanceNew, noPhone, untriaged,
        ] = await Promise.all([
          cnt('volunteers', 'people', (q) => q.eq('is_volunteer', true)),
          cnt('volunteers', 'volunteer_profiles', (q) => q.gte('interest_date', monthStartISO())),
          // People who actually have a nurturer. This used to count `journeys` rows
          // with status='active' and call the result "In nurturing journey" — 6,954,
          // which was MORE than the 6,096 meditators and 1,285 volunteers on record,
          // because one person can hold several journeys. A number larger than the
          // population it describes teaches a coordinator to distrust the whole panel.
          cnt('nurturing', 'nurturing_assignments', (q) => q.eq('active', true).not('nurturer_person_id', 'is', null)),
          // Bounded to THIS week at both ends. It was `>= monday` with no upper bound,
          // so every future activity ever scheduled counted as "this week".
          cnt('event_hub', 'activities', (q) => q.gte('activity_date', weekStartISO()).lte('activity_date', weekEndISO()).is('archived_at', null)),
          cnt('meditators', 'people', (q) => q.eq('is_meditator', true)),
          // ---- the four numbers behind "Needs attention" — all live queries ----
          cnt('volunteers', 'people', (q) => q.eq('is_volunteer', true).lt('last_active_date', daysAgoISO(90))),
          cnt('meditators', 'people', (q) => q.eq('is_meditator', true).gte('ie_date', daysAgoISO(60))),
          cnt('advance', 'advanced_interest', (q) => q.eq('status', 'new')),
          cnt('volunteers', 'people', (q) => q.eq('is_volunteer', true).is('phone', null)),
          // The largest untouched queue in the app, and it was nowhere on this screen.
          cnt('interest', 'interest_inbox_list', (q) => q.eq('status_bucket', 'interested')),
        ])
        if (!alive) return
        setKpis({ activeVols, newThisMonth, inNurturing, activitiesWeek, meditators, quietVols, newIe, advanceNew, noPhone, untriaged })
      } catch (e) {
        if (alive) setErr(e.message || String(e))
      }
    })()
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [secKey, isAdmin])


  const loading = !kpis && !err
  const k = kpis || {}

  // Every row is a live count with a real destination. Nothing here is hardcoded —
  // a row only appears when its query actually returns people.
  const attention = [
    {
      // 1,311 people raised their hand and are still sitting at "Interested". This
      // was the biggest backlog in the product and the landing screen said nothing
      // about it. It goes first: someone waiting for a reply outranks a report.
      key: 'untriaged', sec: 'interest',
      n: k.untriaged,
      tag: 'INTEREST INBOX',
      title: `${(k.untriaged || 0).toLocaleString('en-IN')} people offered to help and haven't been answered`,
      body: 'Every one of these is someone who volunteered and is still waiting. Triaging a row takes one tap.',
      cta: 'Open the interest inbox',
      to: 'interest',
      tint: 'var(--info-bg)', ink: 'var(--info-fg)',
    },
    {
      key: 'quiet', sec: 'volunteers',
      n: k.quietVols,
      tag: 'VOLUNTEERS',
      // Was "no activity in 90+ days", which read as "we have not spoken to them".
      // It counts `last_active_date` — the upstream Isha transaction date — and `lt`
      // drops NULL, so the ~1,150 volunteers with nothing in that column at all were
      // silently outside the number. The row now says what it counts and names the
      // door to the rest. See lib/engagement.js.
      title: `${k.quietVols} volunteers whose last Isha activity was 90+ days ago`,
      body: 'Worth a personal call from their nurturer before they drift further. Most volunteers have no activity date on record at all — the Isha activity filter on that screen has a “not on record” option for them.',
      cta: 'Open these volunteers',
      to: 'volunteers', preset: { last: 'quiet' },
      tint: 'var(--pill-warm-bg)', ink: 'var(--pill-warm-fg)',
    },
    {
      key: 'newIe', sec: 'meditators',
      n: k.newIe,
      tag: 'NEW MEDITATORS',
      title: `${k.newIe} finished Inner Engineering in the last 60 days`,
      body: 'Early contact is when a new meditator is most open to staying connected.',
      cta: 'Open these meditators',
      to: 'meditators', preset: { ieWindow: '60' },
      tint: 'var(--pill-orange-bg)', ink: 'var(--pill-orange-fg)',
    },
    {
      key: 'advance', sec: 'advance',
      n: k.advanceNew,
      tag: 'ADVANCE PROGRAMMES',
      title: `${k.advanceNew} advance-programme interests not yet contacted`,
      body: 'These people raised their hand and are still marked “new”.',
      cta: 'Open advance programmes',
      to: 'advance',
      tint: 'var(--pill-rust-bg)', ink: 'var(--pill-rust-fg)',
    },
    {
      key: 'noPhone', sec: 'volunteers',
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
      key: 'nurturerGap', sec: 'volunteers',
      n: k.activeVols - k.inNurturing,
      tag: 'NURTURING',
      title: `Only ${k.inNurturing} of ${k.activeVols} volunteers has a nurturer`,
      body: 'Nurturing is what this centre runs on, and almost nobody is covered. Filter to the people who need one and assign in bulk.',
      cta: 'Open volunteers who need a nurturer',
      to: 'volunteers', preset: { nurt: 'needs' },
      tint: 'var(--pill-rust-bg)', ink: 'var(--pill-rust-fg)',
      unit: 'uncovered',
    }] : []),
  ].filter((r) => has(r.sec) && r.n > 0)

  return (
    <Pad>
      <h2 className="dash-greeting" style={{ fontSize: 22, fontWeight: 600, margin: '0 0 4px' }}>Namaskaram{firstName ? `, ${firstName}` : ''}</h2>
      <div className="mobile-hide" style={{ fontSize: 14, color: 'var(--muted)', marginBottom: 22 }}>
        The work first, the numbers after.
      </div>

      {err && <ErrorCard>Couldn't load live counts: {err}</ErrorCard>}

      {/* Needs attention — every row is a live count, and only shows if it's real.
          The whole block goes when the role holds none of the people sections:
          "Nothing needs attention" would be a lie to someone whose queue lives
          in the pooja report below. */}
      {peopleRole && (<>
      <h3 style={{ fontSize: 'var(--fs-h2)', fontWeight: 600, margin: '0 0 6px' }}>Needs attention</h3>
      <div className="mobile-hide" style={{ fontSize: 'var(--fs-body)', color: 'var(--muted)', marginBottom: 14 }}>
        Counted live from your records right now. Opening a row takes you to that exact list, already filtered.
      </div>

      {loading && <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-body)' }}>Counting…</div>}

      {!loading && attention.length === 0 && (
        <div className="card" style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-body)' }}>
          Nothing needs attention right now.
        </div>
      )}

      {/* Events whose preparation is slipping. Separate from the people rows because
          the unit of work is an EVENT, not a list of people — one click goes to that
          event's hub. Deliberately compact: at most SHOW_EVENTS rows, because a
          worklist that needs three screens of scrolling stops being read at all. */}

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
      </>)}

      {has('poojas') && <PoojaReport me={me} onNavigate={onNavigate} />}

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
      {peopleRole && (<>
      <h3 style={{ fontSize: 'var(--fs-h2)', fontWeight: 600, margin: '30px 0 14px' }}>The centre at a glance</h3>
      <div
        className="dash-grid"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}
      >
        {has('volunteers') && <KpiCard
          loading={loading}
          icon={Icon.volunteers(19)}
          tint="var(--pill-orange-bg)"
          ink="var(--pill-orange-fg)"
          value={k.activeVols}
          label="Volunteers on record"
        />}
        {has('volunteers') && <KpiCard
          loading={loading}
          icon={Icon.interest(19)}
          tint="var(--info-bg)"
          ink="var(--info-fg)"
          value={k.newThisMonth}
          label="New this month"
        />}
        {has('nurturing') && <KpiCard
          loading={loading}
          icon={Icon.nurturing(19)}
          tint="var(--pill-rust-bg)"
          ink="var(--pill-rust-fg)"
          value={k.inNurturing}
          label="People with a nurturer"
        />}
        {has('event_hub') && <KpiCard
          loading={loading}
          icon={Icon.planning(19)}
          tint="var(--success-bg)"
          ink="var(--success-fg)"
          value={k.activitiesWeek}
          label="Activities this week"
        />}
      </div>
      {has('meditators') && <div
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
      </div>}
      </>)}

    </Pad>
  )
}
