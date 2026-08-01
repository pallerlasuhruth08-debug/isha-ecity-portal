// The two sessions every event gets, and the rules about when NOT to make them.
import assert from 'node:assert/strict'
import { planSessions, describePlan, sessionTitle, AUTO_SESSIONS } from '../src/lib/eventSessions.js'

let pass = 0
let total = 0
const t = (name, fn) => {
  total++
  try { fn(); pass++; console.log('  ok  ' + name) }
  catch (e) { console.log('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1 }
}

const TYPES = [
  { id: 'hall', label: 'hall setup', kind: 'volunteer', active: true },
  { id: 'class', label: 'class support', kind: 'volunteer', active: true },
  { id: 'sat', label: 'satsang', kind: 'meditator', active: true },
]
const ev = (o) => ({ id: 'e1', center_id: 'ecity', start_date: '2026-08-01', end_date: '2026-08-01', ...o })
const dates = (rows, id) => rows.filter((r) => r.activity_type_id === id).map((r) => r.session_date)

console.log('\nsessions')

t('a one-day event gets hall setup the day before and one class support', () => {
  const { rows, skipped } = planSessions(ev(), TYPES)
  assert.equal(skipped.length, 0)
  assert.equal(rows.length, 2)
  assert.deepEqual(dates(rows, 'hall'), ['2026-07-31'])
  assert.deepEqual(dates(rows, 'class'), ['2026-08-01'])
})

// Every hall session in the live data is dated the day BEFORE: Shambhavi meetup
// 26 Jul → 25 Jul, Shakti chalana review 1 Aug → 31 Jul, IE 28 Mar → 27 Mar.
t('hall setup lands on Day 0 even across a month boundary', () => {
  const { rows } = planSessions(ev({ start_date: '2026-03-01', end_date: '2026-03-01' }), TYPES)
  assert.deepEqual(dates(rows, 'hall'), ['2026-02-28'])
})

t('class support is one session per event day', () => {
  const { rows } = planSessions(ev({ start_date: '2026-08-20', end_date: '2026-08-23' }), TYPES)
  assert.deepEqual(dates(rows, 'class'), ['2026-08-20', '2026-08-21', '2026-08-22', '2026-08-23'])
  assert.deepEqual(dates(rows, 'hall'), ['2026-08-19'], 'hall setup stays a single session')
  assert.equal(rows.length, 5)
})

t('an event with only activity_date still works', () => {
  const { rows } = planSessions({ id: 'e1', center_id: 'ecity', activity_date: '2026-08-05' }, TYPES)
  assert.deepEqual(dates(rows, 'hall'), ['2026-08-04'])
  assert.deepEqual(dates(rows, 'class'), ['2026-08-05'])
})

t('rows carry everything attendance_sessions needs', () => {
  const { rows } = planSessions(ev(), TYPES, 'user-1')
  for (const r of rows) {
    assert.equal(r.activity_id, 'e1')
    assert.equal(r.center_id, 'ecity')
    assert.equal(r.type, 'volunteer', 'these are volunteer sessions, not participant ones')
    assert.equal(r.created_by, 'user-1')
    assert.ok(r.activity_type_id && r.session_date && r.title)
  }
})

t('titles match the format the session form already generates', () => {
  assert.equal(sessionTitle('class support', '2026-08-02'), 'class support — 2 Aug')
  const { rows } = planSessions(ev(), TYPES)
  assert.ok(rows.some((r) => r.title === 'hall setup — 31 Jul'))
})

// ── the refusals ────────────────────────────────────────────────────────────
t('a missing activity type is SKIPPED and named, never invented', () => {
  const { rows, skipped } = planSessions(ev(), [TYPES[1]])
  assert.deepEqual(skipped, ['hall setup'])
  assert.equal(rows.length, 1, 'class support still gets made')
  // activity_types sits behind every filter, report and smart list. A typo'd
  // duplicate there costs far more than a missing session.
  assert.ok(!rows.some((r) => r.activity_type_id == null))
})

t('an archived type counts as missing', () => {
  const { skipped } = planSessions(ev(), [{ ...TYPES[0], active: false }, TYPES[1]])
  assert.deepEqual(skipped, ['hall setup'])
})

t('a meditator-kind type of the same name is not used', () => {
  const { skipped } = planSessions(ev(), [{ id: 'x', label: 'hall setup', kind: 'meditator', active: true }, TYPES[1]])
  assert.deepEqual(skipped, ['hall setup'])
})

t('label matching ignores case and stray spaces', () => {
  const { rows, skipped } = planSessions(ev(), [{ id: 'h', label: '  Hall Setup ', kind: 'volunteer', active: true }, TYPES[1]])
  assert.equal(skipped.length, 0)
  assert.ok(rows.some((r) => r.activity_type_id === 'h'))
  assert.ok(rows.some((r) => r.title === 'Hall Setup — 31 Jul'), 'the stored label is used verbatim in the title')
})

t('no id or no date means no sessions, not a crash', () => {
  assert.deepEqual(planSessions(null, TYPES).rows, [])
  assert.deepEqual(planSessions({ id: 'e1' }, TYPES).rows, [])
  assert.deepEqual(planSessions(ev(), []).rows, [])
})

t('describePlan says what was made and what was not', () => {
  assert.equal(describePlan(planSessions(ev(), TYPES)), '2 attendance sessions ready')
  assert.match(describePlan(planSessions(ev(), [TYPES[1]])), /1 attendance session ready · hall setup skipped/)
  assert.match(describePlan(planSessions(ev(), [])), /hall setup and class support skipped/)
})

t('the spec is the two types the centre actually uses', () => {
  assert.deepEqual(AUTO_SESSIONS.map((s) => s.label), ['hall setup', 'class support'])
  assert.equal(AUTO_SESSIONS.find((s) => s.label === 'hall setup').on, 'setup')
  assert.equal(AUTO_SESSIONS.find((s) => s.label === 'class support').on, 'each_day')
})

console.log(`\n${pass}/${total} passed`)
