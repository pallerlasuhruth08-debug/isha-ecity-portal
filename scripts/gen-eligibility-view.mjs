#!/usr/bin/env node
// Emits the SQL for public.person_eligibility from ELIGIBILITY_RULES.
//
//   node scripts/gen-eligibility-view.mjs > /tmp/person_eligibility.sql
//
// WHY GENERATE IT
// The rules already exist once, in src/lib/eligibility.js, and the profile reads
// them there. The moment a smart list needs "everyone eligible for Samyama" as a
// server-side filter, the same chain has to exist in SQL too — and two
// hand-maintained copies of a prerequisite chain will drift, silently, in the
// direction of whichever one someone remembered to update. So the SQL is a build
// artefact of the JS, not a translation of it. Change a rule in one place, re-run
// this, apply the migration.
//
// SHAPE: ONE ROW PER PERSON, one column per programme status.
// The first draft was long-format — one row per (person, programme), 58,635 rows
// for 6,515 people. That optimises for analytical queries nobody here runs. Every
// real consumer is a LIST OF PEOPLE (Volunteers, Meditators) that wants
// "…and eligible for Samyama" as one more filter, and PostgREST filters columns,
// not joined rows. Wide makes that `.eq('samyama_status','eligible')`; long would
// need a subquery per filter and nine table scans per refresh. Wide it is.
//
// `completed_on` is deliberately absent: those dates are already on `people`.
// A view that repeats its source columns is a second copy waiting to disagree.
//
// The generated SQL is verbose. Nobody edits it; it is checked by running it.

import { ELIGIBILITY_RULES, provingProgrammes } from '../src/lib/eligibility.js'
import { PROGRAM_BY_KEY, MIN_ROWS_TO_TRUST } from '../src/lib/programCatalog.js'

// Columns that genuinely exist on public.people, verified against the live
// schema. `ieo_date` is deliberately ABSENT: the rule engine coalesces it with
// ie_date so it keeps working the day an Ishangam sync introduces it, but SQL
// referencing a column that does not exist would not compile, so it is skipped
// here and the generator says so in the header. When the column lands, add it.
const DB_COLUMNS = new Set([
  'ie_date', 'bsp_date', 'shoonya_date', 'samyama_date', 'yogasanas_date',
  'surya_kriya_date', 'guru_puja_date', 'eoe_date', 'angamardhana_date',
  'lom_date', 'bhutha_shuddhi_date',
])

const skipped = []
const colOf = (key) => {
  const col = PROGRAM_BY_KEY[key]?.col
  if (!col) throw new Error(`No column for programme key "${key}" — catalogue and rules disagree.`)
  if (!DB_COLUMNS.has(col)) { skipped.push(col); return null }
  return col
}

// A requirement resolves to one or more date columns; any of them satisfies it.
const colsFor = (req) => (req.anyOf || [req.key]).map(colOf).filter(Boolean)
const keysFor = (req) => req.anyOf || [req.key]

// ── Backward inference, same rule as impliedComplete() in the engine ─────────
// Holding a programme proves its prerequisites happened, so a missing date is
// not a missing completion. Without this the view would say "blocked on IE" for
// the 195 people whose ie_date the sync drops, while the profile — which now
// infers — says "done". The two must never disagree; that is the whole reason
// this file is generated rather than written.
//
// Inference never crosses an `anyOf`: holding Samyama proves ONE of Surya Kriya
// or Shakti Chalana Kriya happened, and naming either would be a fabrication.
// `provingProgrammes` is imported from the engine, not reimplemented here — two
// copies of "what proves what" would be exactly the drift this file exists to
// prevent.

/** Date columns of programmes whose presence proves `key` was completed. */
const proofColsFor = (key) => provingProgrammes(key).map(colOf).filter(Boolean)

/** Proof columns for any alternative of a requirement, minus its own columns. */
const proofColsForReq = (req) => {
  const own = new Set(colsFor(req))
  return [...new Set(keysFor(req).flatMap(proofColsFor))].filter((c) => !own.has(c))
}

const anyPresent = (cols) => cols.map((c) => `p.${c} is not null`).join(' or ')
const allAbsent = (cols) => cols.map((c) => `p.${c} is null`).join(' and ')

// "Nobody records this" — every alternative is below the trust floor. `ie` is
// exempt: it is the entry point and is always meaningful.
const untrackedExpr = (req) => {
  const keys = keysFor(req).filter((k) => k !== 'ie')
  if (!keys.length) return null
  return keys.map((k) => `coalesce(cov.${k}, 0) < ${MIN_ROWS_TO_TRUST}`).join(' and ')
}

// Earliest maturity across alternatives — the first route to open wins.
const maturityExpr = (req, cols) => {
  const terms = cols.map((c) => `(p.${c} + interval '${req.minDaysBefore} days')`)
  return terms.length === 1 ? terms[0] : `least(${terms.join(', ')})`
}

function programmeColumns(key, rule) {
  const selfCol = colOf(key)
  if (!selfCol) return null

  const reqs = rule.requires.filter((r) => colsFor(r).length > 0)

  // A requirement is unmet when NEITHER its own date NOR any proof of it is
  // present, or when a timing clause has not matured yet. Proof satisfies the
  // requirement but carries no date, so it can only clear the untimed half.
  const unmet = reqs.map((r) => {
    const cols = colsFor(r)
    const proof = proofColsForReq(r)
    const absent = proof.length
      ? `((${allAbsent(cols)}) and (${allAbsent(proof)}))`
      : `(${allAbsent(cols)})`
    if (!r.minDaysBefore) return absent
    return `(${absent} or ${maturityExpr(r, cols)} > now())`
  })

  // Indeterminate: either the requirement is absent for this person AND
  // unrecorded for everyone, or it is PROVEN but undated while a timing clause
  // needs to know when. Both are "cannot tell", and must not be claimed.
  const indeterminate = reqs
    .map((r) => {
      const parts = []
      const u = untrackedExpr(r)
      const proof = proofColsForReq(r)
      if (u) {
        const noProof = proof.length ? ` and (${allAbsent(proof)})` : ''
        parts.push(`((${allAbsent(colsFor(r))})${noProof} and (${u}))`)
      }
      if (r.minDaysBefore && proof.length) {
        parts.push(`((${allAbsent(colsFor(r))}) and (${anyPresent(proof)}))`)
      }
      return parts.length ? `(${parts.join(' or ')})` : null
    })
    .filter(Boolean)

  const selfProof = proofColsFor(key)
  const doneClause = rule.repeatable
    ? null
    : `when p.${selfCol} is not null${selfProof.length ? ` or ${anyPresent(selfProof)}` : ''} then 'done'`
  const clauses = [
    doneClause,
    indeterminate.length ? `when ${indeterminate.join(' or ')} then 'indeterminate'` : null,
    unmet.length ? `when ${unmet.join(' or ')} then 'blocked'` : null,
  ].filter(Boolean)

  const cols = [`  case
${clauses.map((c) => '    ' + c).join('\n')}
    else 'eligible'
  end as ${key}_status`]

  // ready_on exists only for rules with a timing clause, and is set ONLY while
  // the person is still waiting. Once maturity passes they are simply eligible,
  // and a ready_on in the past would read as a missed deadline rather than a
  // cleared one — the JS engine leaves it null for the same reason.
  const timed = reqs.filter((r) => r.minDaysBefore)
  if (timed.length) {
    const nonTimedUnmet = reqs.filter((r) => !r.minDaysBefore).map((r) => `(${allAbsent(colsFor(r))})`)
    const timedPresent = timed.map((r) => `(${anyPresent(colsFor(r))})`)
    const maturity = `greatest(${timed.map((r) => maturityExpr(r, colsFor(r))).join(', ')})`
    cols.push(`  case when not (${nonTimedUnmet.length ? nonTimedUnmet.join(' or ') : 'false'})
         and ${timedPresent.join(' and ')}
         and ${maturity} > now()
    then ${maturity}::date else null end as ${key}_ready_on`)
  }
  return cols
}

const columns = Object.entries(ELIGIBILITY_RULES)
  .map(([key, rule]) => programmeColumns(key, rule))
  .filter(Boolean)
  .flat()

const covCols = [...new Set(Object.values(ELIGIBILITY_RULES).flatMap((r) => r.requires.flatMap(keysFor)))]
  .filter((k) => k !== 'ie')

const header = `-- ============================================================================
-- GENERATED FILE — DO NOT EDIT
-- Produced by scripts/gen-eligibility-view.mjs from ELIGIBILITY_RULES in
-- src/lib/eligibility.js. Edit the rules, re-run the generator, re-apply.
--
-- ONE ROW PER PERSON. <programme>_status mirrors programmeState() exactly:
-- done | eligible | blocked | indeterminate. <programme>_ready_on appears only
-- for rules with a timing clause, and only while the person is still waiting.
--
-- security_invoker = on, so RLS on \`people\` applies to whoever queries the
-- view — a coordinator sees eligibility only for people they can already see.
-- programme_coverage() inside is SECURITY DEFINER on purpose: coverage is a
-- property of the dataset, not of the caller.
${skipped.length ? `--\n-- Skipped columns (not in the live schema): ${[...new Set(skipped)].join(', ')}\n-- The JS engine still honours them; add them here when they exist.` : ''}
-- ============================================================================

create or replace view public.person_eligibility with (security_invoker = on) as
with cov as (
  select
${covCols.map((k) => `    max(n) filter (where programme_key = '${k}') as ${k}`).join(',\n')}
  from public.programme_coverage()
)
`

process.stdout.write(
  header +
  'select\n  p.id as person_id,\n' +
  columns.join(',\n') +
  '\nfrom people p cross join cov;\n'
)
