import assert from 'node:assert/strict'
import { eligibility, programmeState, initiatedOn, impliedComplete, provingProgrammes, proves, ELIGIBILITY_RULES } from '../src/lib/eligibility.js'

const TODAY = new Date('2026-07-31')
let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name) }

// Base: everything Samyama needs except the timing clause.
const READY_BASE = { ie_date: '2020-01-01', bsp_date: '2021-01-01', yogasanas_date: '2022-06-01' }

// 1 — no IE at all
t('no IE: IE is the only eligible thing, BSP/Shoonya blocked on IE', () => {
  const e = eligibility({}, TODAY)
  assert.deepEqual(e.eligible.map((s) => s.key), ['ie'])
  const bsp = e.blocked.find((s) => s.key === 'bsp')
  assert.deepEqual(bsp.blockers.map((b) => b.key), ['ie'])
  assert.equal(bsp.readyOn, null)
})

// 2 — ieo_date is treated as equivalent to ie_date (forward compatibility)
t('ieo_date counts as Shambhavi Initiation, exactly like ie_date', () => {
  const viaIeo = eligibility({ ieo_date: '2024-01-10' }, TODAY)
  const viaIe = eligibility({ ie_date: '2024-01-10' }, TODAY)
  assert.deepEqual(viaIeo.eligible.map((s) => s.key), viaIe.eligible.map((s) => s.key))
  assert.equal(initiatedOn({ ieo_date: '2024-01-10' }).toISOString(), initiatedOn({ ie_date: '2024-01-10' }).toISOString())
})

// 3 — IE done: BSP and Shoonya open up, Samyama still blocked
t('IE done unlocks BSP + Shoonya + Guru Pooja, not Samyama', () => {
  const e = eligibility({ ie_date: '2023-05-01' }, TODAY)
  assert.deepEqual(e.eligible.map((s) => s.key).sort(), ['bsp', 'guru_pooja', 'shoonya'])
  const sam = e.blocked.find((s) => s.key === 'samyama')
  assert.deepEqual(sam.blockers.map((b) => b.key).sort(), ['bsp', 'shoonya', 'surya_kriya', 'yogasanas'])
  // The kriya requirement is presented as the alternative pair, not as Surya Kriya alone.
  assert.equal(sam.blockers.find((b) => b.key === 'surya_kriya').label, 'Surya Kriya or Shakti Chalana Kriya')
})

// 4 — Shoonya teaches Shakti Chalana Kriya, so shoonya_date satisfies the kriya clause
t('Shoonya alone satisfies the kriya requirement once 60 days have passed', () => {
  const p = { ...READY_BASE, shoonya_date: '2022-01-01' } // no surya_kriya at all
  assert.equal(programmeState(p, 'samyama', TODAY).status, 'eligible')
})

// 5 — a freshly-completed Shoonya is not yet enough: it must mature 60 days
t('Shoonya inside 60 days gives a future readyOn, not "eligible"', () => {
  const p = { ...READY_BASE, shoonya_date: '2026-07-01' }
  const s = programmeState(p, 'samyama', TODAY)
  assert.equal(s.status, 'blocked')
  assert.deepEqual(s.blockers.map((b) => b.reason), ['too_recent'])
  assert.equal(s.readyOn.toISOString().slice(0, 10), '2026-08-30') // 1 Jul + 60d
  assert.equal(eligibility(p, TODAY).ripening[0].key, 'samyama')
})

// 6 — anyOf takes the EARLIEST maturing route, not the latest
t('an old Shoonya beats a brand-new Surya Kriya — earliest route wins', () => {
  const p = { ...READY_BASE, shoonya_date: '2022-01-01', surya_kriya_date: '2026-07-29' }
  assert.equal(programmeState(p, 'samyama', TODAY).status, 'eligible')
})

// 7 — both routes immature: readyOn is the earlier of the two
t('both routes immature: readyOn is the earlier maturity date', () => {
  const p = { ...READY_BASE, shoonya_date: '2026-07-20', surya_kriya_date: '2026-07-01' }
  const s = programmeState(p, 'samyama', TODAY)
  assert.equal(s.readyOn.toISOString().slice(0, 10), '2026-08-30') // Surya Kriya matures first
})

// 8 — one day after the 60-day mark
t('one day after the 60-day mark Samyama is eligible', () => {
  const p = { ...READY_BASE, shoonya_date: '2026-07-01' }
  assert.equal(programmeState(p, 'samyama', new Date('2026-08-31')).status, 'eligible')
})

// 9 — completed programmes never re-offered; BSP is once in a lifetime
t('a completed programme is "done", never "eligible"', () => {
  const e = eligibility({ ie_date: '2020-01-01', bsp_date: '2021-03-03' }, TODAY)
  assert.equal(e.completed.find((s) => s.key === 'bsp').status, 'done')
  assert.ok(!e.eligible.some((s) => s.key === 'bsp'))
  assert.equal(programmeState({ bsp_date: '2021-03-03' }, 'bsp', TODAY).rule.onceInLifetime, true)
})

// 10 — no invented rules
t('programmes without a published prerequisite return no_rule and are excluded', () => {
  for (const k of ['surya_kriya', 'yogasanas']) {
    assert.equal(programmeState({ ie_date: '2020-01-01' }, k, TODAY).status, 'no_rule', k)
  }
  assert.ok(!eligibility({ ie_date: '2020-01-01' }, TODAY).states.some((s) => s.status === 'no_rule'))
})

// Production reality on 31 Jul 2026, straight from programme_coverage().
const TRACKED = new Map([
  ['ie', 5724], ['bsp', 649], ['shoonya', 517], ['samyama', 245],
  ['yogasanas', 0], ['surya_kriya', 0], ['guru_pooja', 0],
  ['eoe', 0], ['angamardhana', 0], ['lom', 0], ['bhutha_shuddhi', 0],
])

// 11 — an untracked prerequisite is "can't tell", never "not ready"
t('Yogasanas recorded for nobody makes Samyama indeterminate, not blocked', () => {
  const p = { ie_date: '2020-01-01', bsp_date: '2021-01-01', shoonya_date: '2022-01-01' }
  const s = programmeState(p, 'samyama', TODAY, TRACKED)
  assert.equal(s.status, 'indeterminate')
  assert.deepEqual(s.blockers.filter((b) => b.reason === 'untracked').map((b) => b.label), ['Yogasanas'])
  assert.equal(s.blockers.find((b) => b.reason === 'untracked').recordedFor, 0)
  const e = eligibility(p, TODAY, TRACKED)
  assert.deepEqual(e.indeterminate.map((s2) => s2.key), ['samyama'])
  assert.equal(e.blocked.length, 0)
  assert.equal(e.ripening.length, 0) // never surfaces as a call list
})

// 12 — tracked prerequisites are unaffected
t('IE-gated rungs still resolve normally when other columns are untracked', () => {
  const e = eligibility({ ie_date: '2023-05-01' }, TODAY, TRACKED)
  assert.deepEqual(e.eligible.map((s) => s.key).sort(), ['bsp', 'guru_pooja', 'shoonya'])
})

// 13 — EOE / Lap of the Master: events, gated only on IE, kept out of the ladder
t('IE opens both Sadhguru events, and they never enter the ladder', () => {
  const e = eligibility({ ie_date: '2023-05-01' }, TODAY, TRACKED)
  assert.deepEqual(e.eventsOpen.map((s) => s.key).sort(), ['eoe', 'lom'])
  assert.deepEqual(e.eventsOpen.map((s) => s.label).sort(), ['Ecstasy of Enlightenment', 'Lap of the Master'])
  // never mixed into the progression groupings
  for (const g of ['eligible', 'blocked', 'indeterminate', 'ripening', 'completed']) {
    assert.ok(!e[g].some((s) => s.key === 'eoe' || s.key === 'lom'), g)
  }
})

// 14 — events recur: attending once does not close them
t('a past EOE attendance keeps EOE open and reports the last date', () => {
  const e = eligibility({ ie_date: '2020-01-01', eoe_date: '2024-03-12' }, TODAY, TRACKED)
  const eoe = e.eventsOpen.find((s) => s.key === 'eoe')
  assert.equal(eoe.status, 'eligible')
  assert.equal(eoe.on.toISOString().slice(0, 10), '2024-03-12')
  assert.ok(!e.completed.some((s) => s.key === 'eoe')) // NOT "done"
})

// 15 — no IE, no events
t('without IE neither Sadhguru event is open', () => {
  assert.deepEqual(eligibility({}, TODAY, TRACKED).eventsOpen, [])
})

// 15b — the backfill cliff: the count threshold, not a boolean
t('one backfilled Yogasanas row does NOT flip 6,514 people to "not ready"', () => {
  const p = { ie_date: '2020-01-01', bsp_date: '2021-01-01', shoonya_date: '2022-01-01' }
  const oneRow = new Map([...TRACKED, ['yogasanas', 1]])
  const s1 = programmeState(p, 'samyama', TODAY, oneRow)
  assert.equal(s1.status, 'indeterminate', 'a single backfilled row must not be believed')
  assert.equal(s1.blockers.find((b) => b.reason === 'untracked').recordedFor, 1)
  // 24 is still not enough; 25 is
  assert.equal(programmeState(p, 'samyama', TODAY, new Map([...TRACKED, ['yogasanas', 24]])).status, 'indeterminate')
  const s3 = programmeState(p, 'samyama', TODAY, new Map([...TRACKED, ['yogasanas', 25]]))
  assert.equal(s3.status, 'blocked')
  assert.deepEqual(s3.blockers.map((b) => b.reason), ['missing'])
})

// 16 — Guru Pooja is gated on IE and IS a ladder rung
t('Guru Pooja joins the ladder behind IE', () => {
  assert.deepEqual(eligibility({ ie_date: '2023-05-01' }, TODAY, TRACKED).eligible.map((s) => s.key).sort(), ['bsp', 'guru_pooja', 'shoonya'])
  assert.deepEqual(eligibility({}, TODAY, TRACKED).blocked.find((s) => s.key === 'guru_pooja').blockers.map((b) => b.key), ['ie'])
})

// 17 — open-to-everyone modules are known, not unknown, and never render
t('Angamardhana and Bhutha Shuddhi are open to all and stay out of the ladder', () => {
  for (const k of ['angamardhana', 'bhutha_shuddhi']) {
    // NOT no_rule — we know the answer, and we know it for someone with no IE at all
    assert.equal(programmeState({}, k, TODAY, TRACKED).status, 'eligible', k)
    assert.equal(ELIGIBILITY_RULES[k].kind, 'open', k)
  }
  const e = eligibility({}, TODAY, TRACKED)
  for (const g of ['eligible', 'blocked', 'indeterminate', 'ripening', 'completed', 'eventsOpen']) {
    assert.ok(!e[g].some((s) => s.rule.kind === 'open'), g)
  }
})

// 18 — purity
t('eligibility does not mutate the person', () => {
  const p = { ie_date: '2020-01-01' }
  const before = JSON.stringify(p)
  eligibility(p, TODAY)
  assert.equal(JSON.stringify(p), before)
})


// ── Backward inference ──────────────────────────────────────────────────────
// 195 real people hold an advanced programme with no ie_date because the sync
// drops INNER_ENGINEERING. Their profiles said "needs Inner Engineering".

t('holding Bhava Spandana proves Inner Engineering, even with no ie_date', () => {
  const p = { bsp_date: '2021-03-01' }
  const ie = programmeState(p, 'ie', TODAY)
  assert.equal(ie.status, 'done')
  assert.equal(ie.impliedBy, 'bsp')
  assert.equal(ie.on, null, 'must not invent a date it does not have')
})

t('an inferred IE unblocks everything gated only on IE', () => {
  const e = eligibility({ bsp_date: '2021-03-01' }, TODAY)
  const keys = e.eligible.map((s) => s.key)
  assert.ok(keys.includes('shoonya'), 'Shoonya is gated on IE alone')
  assert.ok(keys.includes('guru_pooja'))
  assert.ok(!e.blocked.some((s) => s.blockers.some((b) => b.key === 'ie')), 'nothing may still be blocked on IE')
})

t('inference is transitive — Samyama proves BSP and Shoonya and IE', () => {
  const m = impliedComplete({ samyama_date: '2023-01-01' })
  assert.equal(m.get('ie'), 'samyama')
  assert.equal(m.get('bsp'), 'samyama')
  assert.equal(m.get('shoonya'), 'samyama')
})

// The honesty limits — these are the whole reason the feature is safe.
t('it never infers through anyOf: Samyama does not name Surya Kriya', () => {
  const m = impliedComplete({ samyama_date: '2023-01-01' })
  assert.equal(m.has('surya_kriya'), false, 'holding Samyama proves ONE of the kriyas, not which')
  assert.equal(m.has('shakti_chalana'), false)
})

t('an inferred prerequisite can never satisfy a timing clause', () => {
  // Samyama needs a kriya completed >=60 days before. Inference gives no date,
  // so this must stay unjudgeable rather than silently passing the clause.
  const st = programmeState({ bsp_date: '2021-03-01', yogasanas_date: '2022-01-01', shoonya_date: null }, 'samyama', TODAY)
  assert.notEqual(st.status, 'eligible', 'must not become eligible on a date we do not have')
})

t('a real date always wins over an inference', () => {
  const p = { ie_date: '2019-06-01', bsp_date: '2021-03-01' }
  const ie = programmeState(p, 'ie', TODAY)
  assert.equal(ie.on.toISOString().slice(0, 10), '2019-06-01')
  assert.equal(ie.impliedBy, undefined)
})

t('someone with nothing recorded infers nothing', () => {
  assert.equal(impliedComplete({}).size, 0)
  assert.equal(impliedComplete(null).size, 0)
  assert.equal(programmeState({}, 'ie', TODAY).status, 'eligible', 'a true newcomer is still eligible FOR ie')
})



// The generated SQL view imports `provingProgrammes` from here rather than
// reimplementing it, so a profile and a smart list can never disagree about
// the same person. These pin the shared definition.

t('provingProgrammes(ie) is every programme gated on IE', () => {
  const p = provingProgrammes('ie')
  for (const k of ['bsp', 'shoonya', 'samyama', 'guru_pooja', 'eoe', 'lom']) {
    assert.ok(p.includes(k), `${k} requires IE, so holding it proves IE`)
  }
  assert.ok(!p.includes('angamardhana'), 'open-to-everyone modules prove nothing')
  assert.ok(!p.includes('ie'))
})

t('nothing proves an anyOf alternative', () => {
  assert.equal(proves('samyama', 'surya_kriya'), false)
  assert.equal(provingProgrammes('surya_kriya').length, 0)
})

t('proof relation is consistent with what impliedComplete produces', () => {
  // The invariant the SQL generator relies on: for every programme, the set of
  // things holding it implies must be exactly the set of things that name it as
  // a prover. The universe includes requirement-only keys like `yogasanas`,
  // which have no rule of their own but can still be implied.
  const COL = { ie: 'ie_date', bsp: 'bsp_date', shoonya: 'shoonya_date', samyama: 'samyama_date',
    yogasanas: 'yogasanas_date', surya_kriya: 'surya_kriya_date', guru_pooja: 'guru_puja_date',
    eoe: 'eoe_date', lom: 'lom_date', angamardhana: 'angamardhana_date', bhutha_shuddhi: 'bhutha_shuddhi_date' }
  const universe = [...new Set([
    ...Object.keys(ELIGIBILITY_RULES),
    ...Object.values(ELIGIBILITY_RULES).flatMap((r) => r.requires.flatMap((q) => q.anyOf || [q.key])),
  ])].filter(Boolean)

  for (const key of Object.keys(ELIGIBILITY_RULES)) {
    if (!COL[key]) continue
    const implied = [...impliedComplete({ [COL[key]]: '2020-01-01' }).keys()].sort()
    const expected = universe.filter((t2) => provingProgrammes(t2).includes(key)).sort()
    assert.deepEqual(implied, expected, `holding ${key} must imply exactly ${expected.join(', ') || '(nothing)'}`)
  }
})

console.log(`\n${pass}/${pass} passed`)
