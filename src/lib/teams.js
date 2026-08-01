// Reading a 24-team roster at a glance.
//
// WHAT WAS WRONG
// "Guru Pooja Training" has 24 teams and 86 people. Exactly TWO of them need a
// coordinator to do anything — Hygiene & outside (3 of 4) and Annadanam (2 of 4).
// They sat at rows 9 and 19 of 24, in cards visually identical to the other
// twenty-two, sorted by the order they happened to be created in.
//
// And SEVEN teams were over their asked-for size — 16/15, 9/8, 7/6, 13/10, 12/10,
// 2/1, 2/1 — every one of them labelled "full". Eleven people more than asked for,
// sitting three seats away from the three that are missing, and the screen said
// nothing. "Full" for a team that is over is not a rounding choice; it hides the
// one move that fixes the shortfall.
//
// So: say short, say over, and put the rows that need a decision first.

export const FULL = 'full'
export const SHORT = 'short'
export const OVER = 'over'

/** One team's staffing, in the words a coordinator would use. */
export function teamStatus(needed, filled) {
  const need = Math.max(0, Number(needed) || 0)
  const have = Math.max(0, Number(filled) || 0)
  const gap = have - need
  if (!need) return { state: FULL, gap: 0, label: `${have} on the team`, tone: 'neutral' }
  if (gap < 0) return { state: SHORT, gap, label: `${have}/${need} · short ${-gap}`, tone: 'warn' }
  if (gap > 0) return { state: OVER, gap, label: `${have}/${need} · ${gap} over`, tone: 'over' }
  return { state: FULL, gap: 0, label: `${have}/${need} · full`, tone: 'ok' }
}

// Short first (someone must act), then over (someone could act), then full. Within
// a group, by name — so the list is stable and a team does not move because another
// team changed.
const RANK = { [SHORT]: 0, [OVER]: 1, [FULL]: 2 }
export function sortTeams(rows) {
  return [...(rows || [])].sort((a, b) => {
    const r = RANK[a.status.state] - RANK[b.status.state]
    if (r) return r
    if (a.status.state === SHORT && a.status.gap !== b.status.gap) return a.status.gap - b.status.gap
    if (a.status.state === OVER && a.status.gap !== b.status.gap) return b.status.gap - a.status.gap
    return String(a.heading || '').localeCompare(String(b.heading || ''))
  })
}

/** The one line that saves reading twenty-four rows. */
export function summariseTeams(rows) {
  const list = rows || []
  let needed = 0, filled = 0, shortTeams = 0, shortPeople = 0, overTeams = 0, overPeople = 0
  for (const r of list) {
    needed += Math.max(0, Number(r.volunteers_needed) || 0)
    filled += r.status.gap + Math.max(0, Number(r.volunteers_needed) || 0)
    if (r.status.state === SHORT) { shortTeams++; shortPeople += -r.status.gap }
    if (r.status.state === OVER) { overTeams++; overPeople += r.status.gap }
  }
  return { teams: list.length, needed, filled, shortTeams, shortPeople, overTeams, overPeople }
}

export function describeTeams(s) {
  if (!s.teams) return 'No teams yet'
  const parts = [`${s.teams} team${s.teams === 1 ? '' : 's'}`, `${s.filled} of ${s.needed} places filled`]
  if (s.shortTeams) parts.push(`${s.shortTeams} short ${s.shortPeople}`)
  if (s.overTeams) parts.push(`${s.overTeams} over by ${s.overPeople}`)
  return parts.join(' · ')
}

// Day chips were rendered in whatever order `required_days` was stored, so real
// teams read "Day 1, Day 2, Day 3, Day 0" and "Day 1, Day 0, Day 3". Day 0 is the
// setup day BEFORE the event; it belongs first.
export function orderedDayLabels(requiredDays, dayList0, fmt = (d) => d) {
  const days = requiredDays && requiredDays.length ? requiredDays : dayList0
  const known = (days || []).filter((d) => dayList0.includes(d)).sort((a, b) => dayList0.indexOf(a) - dayList0.indexOf(b))
  const unknown = (days || []).filter((d) => !dayList0.includes(d)).sort()
  if (!known.length && !unknown.length) return 'All days'
  return [...known.map((d) => `Day ${dayList0.indexOf(d)}`), ...unknown.map(fmt)].join(', ')
}

export const TEAM_FILTERS = [
  { v: 'all', label: 'All' },
  { v: SHORT, label: 'Short' },
  { v: OVER, label: 'Over' },
]
