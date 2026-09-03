// Pure arithmetic for the Upcoming tab — no Supabase import, so it can be run
// under node by scripts/poojaSummary.test.mjs. poojaHosts.upcomingCallSummary()
// fetches the four inputs and hands them here.

export const HOLDER_FLAG = { sannidhi: 'has_sadhguru_sannidhi', yantra: 'has_devi_yantra' }

const IST_DAY = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' })
export const istDay = (ts) => IST_DAY.format(new Date(ts))

/**
 * One row per pooja date: who could host, how the calling went, what got posted.
 *
 * @param dates     [{ date, types }] from listPoojaDates (upcoming, ascending)
 * @param holders   people rows with the two holder flags, center_id, street; opt-outs
 *                  already removed
 * @param outreach  pooja_host_outreach rows { pooja_date, pooja_type, person_id, outcome }
 * @param listings  pooja_listings rows { activity_id, host_person_id, starts_at, status, center_id }
 * @param centreId  narrow holders and listings to one centre; null = all
 */
export function summariseUpcoming({ dates, holders, outreach, listings, centreId = null }) {
  const inCentre = (r) => !centreId || r.center_id === centreId
  const people = holders.filter(inCentre)

  const outreachBy = new Map() // `${date}|${type}` -> Map(person -> outcome)
  for (const o of outreach) {
    const k = `${o.pooja_date}|${o.pooja_type}`
    if (!outreachBy.has(k)) outreachBy.set(k, new Map())
    outreachBy.get(k).set(o.person_id, o.outcome)
  }
  const listingsByDay = new Map() // date -> listings (not cancelled, in centre)
  for (const l of listings) {
    if (l.status === 'cancelled' || !inCentre(l)) continue
    const d = istDay(l.starts_at)
    if (!listingsByDay.has(d)) listingsByDay.set(d, [])
    listingsByDay.get(d).push(l)
  }

  return dates.map(({ date, types }) => {
    const posted = listingsByDay.get(date) || []
    const postedHosts = new Set(posted.map((l) => l.host_person_id).filter(Boolean))
    const byType = {}
    for (const t of types) {
      const eligible = people.filter((p) => p[HOLDER_FLAG[t]])
      const answers = outreachBy.get(`${date}|${t}`) || new Map()
      const n = (outcome) => eligible.filter((p) => answers.get(p.id) === outcome).length
      byType[t] = {
        eligible: eligible.length,
        called: eligible.filter((p) => answers.has(p.id) || postedHosts.has(p.id)).length,
        yes: n('confirmed'),
        declined: n('declined'),
        noAnswer: n('no_answer'),
      }
    }
    const tot = (k) => types.reduce((s, t) => s + byType[t][k], 0)
    return {
      date, types, byType,
      eligible: tot('eligible'), called: tot('called'), yes: tot('yes'),
      declined: tot('declined'), noAnswer: tot('noAnswer'),
      posted,
      guestsWaiting: posted.reduce((s, l) => s + (l.pending_count || 0), 0),
    }
  })
}

/**
 * Hosting history per person from their past, non-cancelled listings:
 * { [person_id]: { count, last } } where `last` is the IST date of the most recent.
 */
export function hostingHistory(listings, { now = new Date() } = {}) {
  const out = {}
  for (const l of listings) {
    if (!l.host_person_id || l.status === 'cancelled') continue
    if (new Date(l.starts_at) >= now) continue
    const d = istDay(l.starts_at)
    const h = out[l.host_person_id] || (out[l.host_person_id] = { count: 0, last: null })
    h.count++
    if (!h.last || d > h.last) h.last = d
  }
  return out
}
