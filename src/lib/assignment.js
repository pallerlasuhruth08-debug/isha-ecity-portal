// Splitting a cohort across several nurturers.
//
// WHY THIS EXISTS
// The centre has 10 nurturers and 7,381 people on record, and exactly one person
// has a nurturer. The bulk-assign dialog could only put EVERY selected person onto
// ONE nurturer — so the honest way to use it was 200 people onto one volunteer,
// which nobody would do, so nobody did anything. That is the whole reason coverage
// is 1.
//
// This is the missing primitive: take a cohort, take the nurturers, and split it
// so that each nurturer gets people near them and nobody gets an impossible pile.
//
// WHAT IT DELIBERATELY DOES NOT DO
// It does not try to reach 100% coverage. Ten nurturers cannot hold 7,381 people,
// and pretending otherwise by removing the cap would just move the failure from
// "nobody is assigned" to "everybody is assigned and nobody is contacted". When
// the cohort does not fit, the leftovers come back in `unassigned` and the UI says
// so out loud — the same refusal-rather-than-truncation rule the eligibility
// cohorts already follow.

export const DEFAULT_CAP = 25

/**
 * @param people     [{ id, pincode }] — the cohort to place
 * @param nurturers  [{ personId, full_name, pincode, load }] — `load` = people they already hold
 * @param opts.cap   max TOTAL people per nurturer, existing load included
 * @returns {
 *   plan: [{ nurturer, personIds, samePincode }],   // only nurturers who received someone
 *   unassigned: [personId],                          // nobody had room — never silently dropped
 *   capacity: number                                 // total free slots before we started
 * }
 */
export function distribute(people = [], nurturers = [], { cap = DEFAULT_CAP } = {}) {
  const state = nurturers.map((n) => ({
    nurturer: n,
    personIds: [],
    samePincode: 0,
    projected: Math.max(0, n.load || 0),
  }))
  const capacity = state.reduce((sum, s) => sum + Math.max(0, cap - s.projected), 0)

  // Fewest-projected-first, then by id — deterministic, so the same cohort and the
  // same roster always produce the same plan and a test can assert on it.
  const pick = (pool) => {
    let best = null
    for (const s of pool) {
      if (s.projected >= cap) continue
      if (!best) { best = s; continue }
      if (s.projected < best.projected) { best = s; continue }
      if (s.projected === best.projected && String(s.nurturer.personId) < String(best.nurturer.personId)) best = s
    }
    return best
  }

  // Place the people WITH a pincode first. Somebody with no pincode can go to
  // anyone, so letting them consume a local nurturer's last slot before their
  // neighbour is placed is a straightforwardly worse outcome.
  const withPin = people.filter((p) => p.pincode)
  const withoutPin = people.filter((p) => !p.pincode)

  for (const p of [...withPin, ...withoutPin]) {
    const local = p.pincode ? state.filter((s) => s.nurturer.pincode === p.pincode) : []
    const chosen = pick(local) || pick(state)
    if (!chosen) continue // everyone is full; falls through to `unassigned` below
    chosen.personIds.push(p.id)
    chosen.projected += 1
    if (p.pincode && chosen.nurturer.pincode === p.pincode) chosen.samePincode += 1
  }

  const placed = new Set(state.flatMap((s) => s.personIds))
  return {
    plan: state.filter((s) => s.personIds.length).map(({ nurturer, personIds, samePincode }) => ({ nurturer, personIds, samePincode })),
    unassigned: people.filter((p) => !placed.has(p.id)).map((p) => p.id),
    capacity,
  }
}

/** "6 people · 4 near them" — the one line that tells a coordinator if a plan is sane. */
export function describeShare(share) {
  const n = share.personIds.length
  const near = share.samePincode
  return `${n} ${n === 1 ? 'person' : 'people'}${near ? ` · ${near} near them` : ''}`
}
