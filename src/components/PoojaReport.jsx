import { useEffect, useState } from 'react'
import { Icon } from '../lib/icons'
import { pill } from '../lib/ui'
import { ErrorCard } from './View'
import KpiCard from './KpiCard'
import { POOJA_TYPES, fmtDate, poojaDashboardReport } from '../lib/poojaHosts'

// The Consecrated spaces report on the Dashboard — built for a role whose whole
// job is the pooja call list (a temple-offerings POC), and shown to anyone who
// holds the `poojas` section. Same shape as the rest of the Dashboard: the work
// first (one card per upcoming date, guests waiting), the numbers after.
export default function PoojaReport({ me, onNavigate }) {
  const [r, setR] = useState(null)
  const [err, setErr] = useState(null)

  // The POC's own centre is the list they actually work; admin / no centre / a
  // sentinel centre sees everything — same rule as the Poojas centre filter.
  const centreId = me?.center_id && !['all', 'unassigned'].includes(me.center_id) ? me.center_id : null

  useEffect(() => {
    let alive = true
    poojaDashboardReport({ centreId })
      .then((x) => alive && setR(x))
      .catch((e) => alive && setErr(e.message || String(e)))
    return () => { alive = false }
  }, [centreId])

  const loading = !r && !err
  const open = () => onNavigate('poojas')

  return (
    <>
      <h3 style={{ fontSize: 'var(--fs-h2)', fontWeight: 600, margin: '30px 0 6px' }}>Consecrated spaces</h3>
      <div className="mobile-hide" style={{ fontSize: 'var(--fs-body)', color: 'var(--muted)', marginBottom: 14 }}>
        Where the calling stands for the next date of each pooja{centreId ? ', for your centre' : ''}.
      </div>

      {err && <ErrorCard>Couldn't load the pooja report: {err}</ErrorCard>}
      {loading && <div style={{ padding: 'var(--space-8)', textAlign: 'center', color: 'var(--muted)', fontSize: 'var(--fs-body)' }}>Counting…</div>}

      {r && (
        <>
          <div className="dash-grid2" style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 16, marginBottom: 16 }}>
            {Object.entries(POOJA_TYPES).map(([type, meta]) => {
              const t = r.byType[type]
              const notCalled = t.eligible - t.called
              return (
                <div key={type} className="card" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span className="pill" style={pill('var(--pill-warm-bg)', 'var(--pill-warm-fg)')}>{meta.short.toUpperCase()}</span>
                    <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--muted)', fontWeight: 600 }}>
                      {t.date ? fmtDate(t.date) : 'no date imported'}
                    </span>
                  </div>
                  <div style={{ fontSize: 16, fontWeight: 600, fontFamily: "'Newsreader',serif", color: 'var(--ink)' }}>
                    {!t.date
                      ? `No upcoming ${meta.label} date on the calendar`
                      : t.eligible === 0
                        ? `No ${meta.short} holders to call`
                        : notCalled > 0
                          ? `${notCalled} of ${t.eligible} ${meta.short} holders still to ring`
                          : `All ${t.eligible} ${meta.short} holders have been rung`}
                  </div>
                  {t.date && t.eligible > 0 && (
                    <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--muted)', lineHeight: 1.6 }}>
                      {t.yes} said yes · {t.declined} declined · {t.noAnswer} no answer · {t.posted} pooja{t.posted === 1 ? '' : 's'} posted
                      {t.yesNoAddress > 0 && (
                        <div style={{ color: 'var(--pill-rust-fg)', fontWeight: 600 }}>
                          {t.yesNoAddress} said yes but {t.yesNoAddress === 1 ? 'has' : 'have'} no address on file — cannot be posted yet
                        </div>
                      )}
                    </div>
                  )}
                  {t.date && (
                    <button className="btn btn-primary" style={{ alignSelf: 'flex-start', marginTop: 2 }} onClick={open}>
                      Open the call list
                    </button>
                  )}
                </div>
              )
            })}
          </div>

          <div className="dash-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 28 }}>
            <KpiCard
              icon={Icon.interest(19)}
              tint={r.guestsWaiting > 0 ? 'var(--pill-rust-bg)' : 'var(--neutral-bg)'}
              ink={r.guestsWaiting > 0 ? 'var(--pill-rust-fg)' : 'var(--ink-soft)'}
              value={r.guestsWaiting}
              label="Guests waiting for a yes"
              badge={r.guestsWaiting > 0 ? 'answer today' : undefined}
              badgeStyle={pill('var(--pill-rust-bg)', 'var(--pill-rust-fg)')}
            />
            <KpiCard icon={Icon.poojas(19)} tint="var(--pill-orange-bg)" ink="var(--pill-orange-fg)" value={r.postedUpcoming} label="Poojas posted, upcoming" />
            <KpiCard
              icon={Icon.planning(19)}
              tint="var(--success-bg)"
              ink="var(--success-fg)"
              value={r.seatsLeft}
              label="Seats left across them"
              badge={r.postedEmpty > 0 ? `${r.postedEmpty} with no guests yet` : undefined}
              badgeStyle={pill('var(--pill-warm-bg)', 'var(--pill-warm-fg)')}
            />
            <KpiCard icon={Icon.volunteers(19)} tint="var(--neutral-bg)" ink="var(--ink-soft)" value={r.neverContacted} label="Holders never contacted" />
          </div>
        </>
      )}
    </>
  )
}
