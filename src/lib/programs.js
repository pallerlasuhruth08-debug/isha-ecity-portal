import { supabase } from './supabase'

// Single source of truth for programme filters. Each maps to a date column on
// people (and volunteer_list). Shown DYNAMICALLY via programsWithData() — a
// programme only appears once someone actually has that date, so programmes with
// no data yet (e.g. newly-added ones awaiting an Ishangam sync) never clutter the
// filter or read as "does nothing".
export const PROGRAMS = [
  { key: 'ie', label: 'Inner Engineering', col: 'ie_date', chip: 'IE' },
  { key: 'bsp', label: 'Bhava Spandana', col: 'bsp_date', chip: 'BSP' },
  { key: 'shoonya', label: 'Shoonya', col: 'shoonya_date', chip: 'Shoonya' },
  { key: 'samyama', label: 'Samyama', col: 'samyama_date', chip: 'Samyama' },
  { key: 'yogasanas', label: 'Yogasanas', col: 'yogasanas_date', chip: 'Yogasanas' },
  { key: 'surya_kriya', label: 'Surya Kriya', col: 'surya_kriya_date', chip: 'Surya Kriya' },
  { key: 'guru_pooja', label: 'Guru Pooja', col: 'guru_puja_date', chip: 'Guru Pooja' },
  { key: 'eoe', label: 'Ecstasy of Enlightenment', col: 'eoe_date', chip: 'EOE' },
  { key: 'angamardhana', label: 'Angamardhana', col: 'angamardhana_date', chip: 'Angamardhana' },
  { key: 'lom', label: 'Lap of the Master', col: 'lom_date', chip: 'LOM' },
  { key: 'bhutha_shuddhi', label: 'Bhutha Shuddhi', col: 'bhutha_shuddhi_date', chip: 'Bhutha Shuddhi' },
]

export const PROGRAM_BY_KEY = Object.fromEntries(PROGRAMS.map((p) => [p.key, p]))

// How many people must have a programme recorded before a BLANK cell may be
// read as "they haven't done it" rather than "we don't record this".
//
// Absolute, not a percentage — and that distinction is the whole point. Samyama
// is a real, synced programme held by 245 of 6,515 people (3.8%); Shoonya 8%,
// BSP 10%. A percentage floor of any useful size would mark genuinely small
// programmes as untracked forever. 25 sits an order of magnitude below the
// smallest real programme and an order of magnitude above a stray test record,
// so it survives the first minutes of an Ishangam backfill instead of being
// tripped by them.
export const MIN_ROWS_TO_TRUST = 25

// { programme key -> how many people have that date }. Aggregate counts only.
export async function programmeCoverage() {
  const { data, error } = await supabase.rpc('programme_coverage')
  if (error || !data) return null // null = "unknown", callers fall back to trusting nothing
  return new Map(data.map((r) => [r.programme_key, Number(r.n) || 0]))
}

// Two different questions, deliberately two different thresholds:
//
//   here, n > 0                    — should this appear in a filter dropdown?
//                                    One person is reason enough to be able to
//                                    filter for them.
//   eligibility.js, n >= MIN_ROWS_TO_TRUST
//                                  — may a blank cell be read as a real "no"?
//                                    Much stricter, because being wrong here
//                                    states a falsehood about everyone.
export async function programsWithData(coverage) {
  const cov = coverage || (await programmeCoverage())
  if (!cov) return new Set(['ie', 'bsp', 'shoonya', 'samyama'])
  return new Set([...cov].filter(([, n]) => n > 0).map(([k]) => k))
}
