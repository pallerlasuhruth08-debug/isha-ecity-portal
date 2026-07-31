import { supabase } from './supabase'

// The catalogue itself lives in programCatalog.js (pure data, no imports) so the
// rule engine and the build-time view generator can read it without pulling in
// the Supabase client. Re-exported here so every existing import keeps working.
export { PROGRAMS, PROGRAM_BY_KEY, MIN_ROWS_TO_TRUST } from './programCatalog'

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
