// The programme catalogue — pure data, ZERO imports.
//
// Split out of programs.js so that anything needing to know what a programme is
// does not also drag in the Supabase client. `programs.js` imports it and
// re-exports it, so every existing import keeps working; `eligibility.js` and
// the build-time view generator import it directly.
//
// That matters for two reasons: the eligibility rule engine is now genuinely
// dependency-free (its tests run against the SHIPPED file rather than a doctored
// copy), and scripts/gen-eligibility-view.mjs can read the same catalogue at
// build time to emit SQL from it.

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
