import { supabase } from './supabase'
import { ELIGIBILITY_RULES, labelOf } from './eligibility'

// Smart lists — "who is ready for X" as a list filter.
//
// Reads public.person_eligibility, the view generated from ELIGIBILITY_RULES, so
// the cohort a coordinator filters by and the verdict shown on that person's
// profile come from the same rules. No second definition.
//
// ── The cap, and why it is a refusal rather than a truncation ────────────────
// A cohort is fetched as person ids and applied with `.in(...)`, matching how
// tags, events and skills already filter these lists. That is fine for an
// actionable cohort — 121 people ready for Samyama — and wrong for a broad one:
// 5,252 people are "eligible for Bhava Spandana", which is 80% of the database
// and not a call list by any definition. Silently returning the first 2,000
// would be worse than useless, because the screen would look like a finished
// list. Past the cap we return `tooBroad` and the UI says so out loud.
export const COHORT_CAP = 2000

// Only ladder programmes are offered. Events (EOE, Lap of the Master) and
// open-to-everyone modules carry the same verdict for thousands of people, so
// "eligible" there is a fact about the programme, not a cohort worth calling.
export const COHORT_PROGRAMMES = Object.entries(ELIGIBILITY_RULES)
  .filter(([, rule]) => !rule.kind && !rule.entry)
  .map(([key, rule]) => ({
    key,
    label: labelOf(key),
    // "ready soon" only exists where a rule has a timing clause; without one
    // there is no ready_on column to sort by.
    hasRipening: rule.requires.some((r) => r.minDaysBefore),
  }))

/**
 * → { ids } | { tooBroad: n } | { error }
 *
 * status 'eligible' — every prerequisite met, callable today.
 * status 'ripening' — blocked on nothing but time, soonest first. The
 *                     "call them in three weeks, not today" list.
 */
export async function eligibilityCohort(programmeKey, status) {
  if (!ELIGIBILITY_RULES[programmeKey]) return { error: `No eligibility rule for ${programmeKey}` }

  let q = supabase.from('person_eligibility').select('person_id', { count: 'exact' })
  q = status === 'ripening'
    ? q.not(`${programmeKey}_ready_on`, 'is', null).order(`${programmeKey}_ready_on`, { ascending: true })
    : q.eq(`${programmeKey}_status`, 'eligible')

  // One request: ask for CAP+1 rows with an exact count, so "too many" and
  // "here they are" are answered together rather than in two round trips.
  const { data, count, error } = await q.range(0, COHORT_CAP)
  if (error) return { error: error.message }
  if ((count || 0) > COHORT_CAP) return { tooBroad: count }
  return { ids: (data || []).map((r) => r.person_id) }
}
