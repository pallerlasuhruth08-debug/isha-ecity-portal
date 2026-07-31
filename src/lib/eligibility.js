import { PROGRAM_BY_KEY, MIN_ROWS_TO_TRUST } from './programs'

// ── What this is ────────────────────────────────────────────────────────────
// Isha's advanced-programme prerequisites are a PUBLISHED chain over programme
// dates we already store on `people` / `volunteer_list`. So "who is ready for
// Samyama" is a computation, not a judgement call. This module is that
// computation and nothing else: pure functions, no I/O, no writes.
//
// ── Source of truth ─────────────────────────────────────────────────────────
// `ie_date` = Shambhavi Initiation completed. It is authoritative; when Ishangam
// gives an ie_date we trust it. `ieo_date` (the same milestone, completed
// online) is treated as EQUIVALENT — not as a separate, weaker thing. It does
// not exist in the database today, so `initiatedOn()` simply coalesces the two
// and keeps working the day an Ishangam sync introduces it. There is
// deliberately no `shambhavi_date` and no online/in-person distinction anywhere
// in this file.
//
// ── Honesty rule ────────────────────────────────────────────────────────────
// A programme gets a rule here ONLY if the prerequisite is published. Everything
// else returns status 'no_rule' and is excluded from every derived list. We do
// not guess prerequisites — a fabricated eligibility rule is worse than none,
// because it sends a real volunteer to make a real phone call.

// Programme keys whose date column doubles as "the same milestone".
const IE_KEYS = ['ie', 'ieo']

/** Date a person's Shambhavi Initiation was completed, or null. */
export function initiatedOn(person) {
  if (!person) return null
  for (const k of IE_KEYS) {
    const col = PROGRAM_BY_KEY[k]?.col || `${k}_date`
    if (person[col]) return new Date(person[col])
  }
  return null
}

/** Date a person completed `key`, or null. `ie` resolves via initiatedOn(). */
export function completedOn(person, key) {
  if (!person) return null
  if (key === 'ie') return initiatedOn(person)
  const col = PROGRAM_BY_KEY[key]?.col
  if (!col) return null
  return person[col] ? new Date(person[col]) : null
}

// ── Rules ───────────────────────────────────────────────────────────────────
// A requirement is either
//   { key, minDaysBefore? }                    — this exact programme, or
//   { anyOf: [key…], label, minDaysBefore? }   — any one of these satisfies it
//
// minDaysBefore means the prerequisite must have been completed at least that
// many days ago, so the person is not merely qualified but qualified *yet*.
// That is what turns "eligible" into "eligible on 12 Sep" and stops premature
// calls. For anyOf, the EARLIEST qualifying alternative wins — a person is ready
// as soon as any one route matures, not when the last one does.
export const ELIGIBILITY_RULES = {
  ie: {
    entry: true,
    requires: [],
    note: 'The entry point. Everything else is gated on it.',
  },
  bsp: {
    requires: [{ key: 'ie' }],
    onceInLifetime: true,
    note: 'Bhava Spandana is attended once in a lifetime — never offer it again.',
  },
  shoonya: {
    requires: [{ key: 'ie' }],
  },
  samyama: {
    requires: [
      { key: 'ie' },
      // Samyama accepts Surya Kriya OR Shakti Chalana Kriya, practised for 60+
      // days. Shakti Chalana Kriya has no column of its own — and does not need
      // one: the Shoonya programme teaches it (alongside Surya Shakti and
      // Shoonya meditation), so `shoonya_date` IS the date it was learned.
      // Whichever of the two matured first makes the person ready.
      { anyOf: ['surya_kriya', 'shoonya'], label: 'Surya Kriya or Shakti Chalana Kriya', minDaysBefore: 60 },
      { key: 'yogasanas' },
      { key: 'bsp' },
      { key: 'shoonya' },
    ],
  },
  guru_pooja: {
    requires: [{ key: 'ie' }],
  },
  // Hatha yoga modules with NO prerequisite — confirmed, not assumed. `kind: 'open'`
  // is different from 'no_rule': we know the answer, and the answer is "anyone".
  // They stay out of the ladder for the same reason the events do — a verdict that
  // is identical for all 6,515 people is a fact about the programme, not about the
  // person, and putting it on every profile is noise wearing the costume of insight.
  angamardhana: { kind: 'open', requires: [], note: 'No prerequisite — open to everyone.' },
  bhutha_shuddhi: { kind: 'open', requires: [], note: 'No prerequisite — open to everyone.' },
  // Ecstasy of Enlightenment and Lap of the Master are rare, in-person EVENTS
  // with Sadhguru (scheduled and registered through IPRS) — not rungs on the
  // sadhana ladder. Three things follow, and they are why `kind: 'event'` exists:
  //
  //   · They RECUR, so attending is not finishing (`repeatable`). eoe_date /
  //     lom_date mean "last attended", never "done".
  //   · IE is the only gate, so "eligible" is true for ~5,724 people — a fact
  //     that belongs to an audience query, not to anybody's profile.
  //   · They only happen ONCE IN A WHILE. Standing eligibility is therefore
  //     meaningless most of the time: the real question is never "could this
  //     person attend an EOE?" but "an EOE has been announced — who can come?"
  //
  // So these rules render NOTHING on a profile by design. They exist so that
  // eligibility().eventsOpen can build the invitation list on the day an event
  // is actually scheduled.
  eoe: {
    kind: 'event', repeatable: true, requires: [{ key: 'ie' }],
    note: 'Rare in-person event with Sadhguru. IE is the only requirement; scheduled via IPRS.',
  },
  lom: {
    kind: 'event', repeatable: true, requires: [{ key: 'ie' }],
    note: 'Rare in-person event with Sadhguru. IE is the only requirement; scheduled via IPRS.',
  },
}

const DAY = 86400000
const addDays = (d, n) => new Date(d.getTime() + n * DAY)

export function labelOf(key) {
  return PROGRAM_BY_KEY[key]?.label || key
}

/**
 * State of one programme for one person.
 *
 * status: 'done' | 'eligible' | 'blocked' | 'indeterminate' | 'no_rule'
 * blockers: [{ key, label, reason: 'missing' | 'too_recent' | 'untracked', readyOn }]
 * readyOn:  Date | null — set only when every blocker is 'too_recent', i.e. the
 *           person needs nothing more than time.
 *
 * `coverage` is Map(programme key -> how many people have that date), from
 * programmeCoverage(). It exists because a blank column is not the same fact as
 * a blank cell: `yogasanas_date` is empty for all 6,515 people, so "needs
 * Yogasanas" would be asserted about everyone on evidence that does not exist.
 *
 * It is a COUNT rather than a boolean on purpose. "Does any row have this?" is
 * true after the Ishangam backfill writes its first row, which would flip all
 * 6,514 remaining people from "can't tell" to "not ready" — fixing the data
 * would be what breaks the verdict. Requiring MIN_ROWS_TO_TRUST removes that
 * cliff, and the count travels with the blocker so the screen can show it and
 * be argued with.
 *
 * Pass null to assume everything is tracked.
 */
export function programmeState(person, key, today = new Date(), coverage = null) {
  const done = completedOn(person, key)
  const rule = ELIGIBILITY_RULES[key]
  if (!rule) return { key, label: labelOf(key), status: 'no_rule', on: null, blockers: [], readyOn: null, rule: null }
  // A repeatable event stays open after attendance — carry the last date through
  // and keep evaluating. Only a one-time programme is finished by doing it.
  if (done && !rule.repeatable) return { key, label: labelOf(key), status: 'done', on: done, blockers: [], readyOn: null, rule }
  const lastOn = rule.repeatable ? done : null

  const rowsFor = (k) => (coverage ? coverage.get(k) ?? 0 : Infinity)
  const isTracked = (k) => k === 'ie' || rowsFor(k) >= MIN_ROWS_TO_TRUST
  const blockers = []
  for (const req of rule.requires) {
    const keys = req.anyOf || [req.key]
    const label = req.label || labelOf(req.key)
    const dates = keys.map((k) => completedOn(person, k)).filter(Boolean)
    if (dates.length === 0) {
      // Absent because they haven't done it, or absent because nobody records it?
      const known = keys.some(isTracked)
      const recordedFor = coverage ? Math.max(...keys.map(rowsFor)) : null
      blockers.push({ key: keys[0], label, reason: known ? 'missing' : 'untracked', readyOn: null, recordedFor })
      continue
    }
    if (req.minDaysBefore) {
      // Earliest maturity across the alternatives — the first route to open wins.
      const readyOn = new Date(Math.min(...dates.map((d) => addDays(d, req.minDaysBefore).getTime())))
      if (readyOn > today) blockers.push({ key: keys[0], label, reason: 'too_recent', readyOn, minDaysBefore: req.minDaysBefore })
    }
  }

  const base = { key, label: labelOf(key), on: lastOn, rule }
  if (blockers.length === 0) return { ...base, status: 'eligible', blockers: [], readyOn: null }
  if (blockers.some((b) => b.reason === 'untracked')) return { ...base, status: 'indeterminate', blockers, readyOn: null }

  const allTimeOnly = blockers.every((b) => b.reason === 'too_recent')
  const readyOn = allTimeOnly ? new Date(Math.max(...blockers.map((b) => b.readyOn.getTime()))) : null
  return { ...base, status: 'blocked', blockers, readyOn }
}

/** Every programme that has a rule, evaluated for one person. */
export function eligibility(person, today = new Date(), coverage = null) {
  const states = Object.keys(ELIGIBILITY_RULES).map((k) => programmeState(person, k, today, coverage))
  // The ladder is the sadhana progression — only things whose answer DIFFERS
  // between people. Rare events (EOE, Lap of the Master) and open-to-everyone
  // hatha modules are excluded: their verdict is the same for everyone, so it is
  // a fact about the programme, not a step anyone is working towards.
  const ladder = states.filter((s) => !s.rule.kind)
  return {
    states,
    completed: ladder.filter((s) => s.status === 'done'),
    eligible: ladder.filter((s) => s.status === 'eligible'),
    blocked: ladder.filter((s) => s.status === 'blocked'),
    // Cannot be judged: a prerequisite nobody records. Never a call list.
    indeterminate: ladder.filter((s) => s.status === 'indeterminate'),
    // Needs only time — the "call them in 3 weeks, not now" cohort.
    ripening: ladder.filter((s) => s.status === 'blocked' && s.readyOn).sort((a, b) => a.readyOn - b.readyOn),
    // Recurring events they may be invited to, regardless of past attendance.
    eventsOpen: states.filter((s) => s.rule.kind === 'event' && s.status === 'eligible'),
  }
}
