// Reading a 24-team roster: what each row says, and what order the rows come in.
import assert from 'node:assert/strict'
import { teamStatus, sortTeams, summariseTeams, describeTeams, orderedDayLabels, SHORT, OVER, FULL } from '../src/lib/teams.js'

let pass = 0
let total = 0
const t = (name, fn) => {
  total++
  try { fn(); pass++; console.log('  ok  ' + name) }
  catch (e) { console.log('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1 }
}

const row = (heading, needed, filled) => ({ heading, volunteers_needed: needed, status: teamStatus(needed, filled) })

console.log('\nteams')

t('an exactly-staffed team is full', () => {
  const s = teamStatus(2, 2)
  assert.equal(s.state, FULL)
  assert.equal(s.label, '2/2 · full')
})

// The live roster had SEVEN of these and every one said "full": 16/15, 9/8, 7/6,
// 13/10, 12/10, 2/1, 2/1 — eleven people more than asked for, three seats from the
// three that were missing, and the screen said nothing.
t('an over-staffed team says how many over, not "full"', () => {
  const s = teamStatus(15, 16)
  assert.equal(s.state, OVER)
  assert.equal(s.label, '16/15 · 1 over')
  assert.doesNotMatch(s.label, /full/)
  assert.equal(teamStatus(10, 13).label, '13/10 · 3 over')
})

t('a short team says how many short', () => {
  const s = teamStatus(4, 3)
  assert.equal(s.state, SHORT)
  assert.equal(s.gap, -1)
  assert.equal(s.label, '3/4 · short 1')
})

t('a team that asked for nobody just counts heads', () => {
  assert.equal(teamStatus(0, 3).label, '3 on the team')
  assert.equal(teamStatus(null, 0).label, '0 on the team')
})

t('junk sizes do not produce NaN', () => {
  for (const s of [teamStatus(undefined, undefined), teamStatus('x', 'y'), teamStatus(-4, -2)]) {
    assert.ok(!/NaN/.test(s.label), s.label)
  }
})

// ── order ───────────────────────────────────────────────────────────────────
t('short teams come first, then over, then full', () => {
  const rows = sortTeams([row('AV', 1, 1), row('Kitchen', 10, 13), row('Annadanam', 4, 2), row('Hygiene', 4, 3)])
  assert.deepEqual(rows.map((r) => r.heading), ['Annadanam', 'Hygiene', 'Kitchen', 'AV'])
})

t('within short, the biggest hole first', () => {
  const rows = sortTeams([row('a', 4, 3), row('b', 6, 2), row('c', 3, 2)])
  assert.deepEqual(rows.map((r) => r.heading), ['b', 'a', 'c'])
})

t('within over, the biggest surplus first — that is where the spare people are', () => {
  const rows = sortTeams([row('a', 10, 11), row('b', 10, 13), row('c', 10, 12)])
  assert.deepEqual(rows.map((r) => r.heading), ['b', 'c', 'a'])
})

t('ties break by name, so a row never moves because another row changed', () => {
  const rows = sortTeams([row('Zebra', 2, 2), row('Apple', 2, 2), row('Mango', 2, 2)])
  assert.deepEqual(rows.map((r) => r.heading), ['Apple', 'Mango', 'Zebra'])
})

t('sorting does not mutate the input', () => {
  const input = [row('b', 2, 2), row('a', 4, 1)]
  const copy = input.map((r) => r.heading)
  sortTeams(input)
  assert.deepEqual(input.map((r) => r.heading), copy)
})

// ── the summary that saves reading 24 rows ──────────────────────────────────
t('the real Guru Pooja Training numbers', () => {
  // 24 teams; the two short ones and a representative sample of the over ones.
  const rows = [
    row('Hygiene & outside', 4, 3), row('Annadanam', 4, 2),
    row('Hall Setup', 15, 16), row('Chant support', 8, 9), row('Demo Support', 6, 7),
    row('Kitchen', 10, 13), row('Sunday class support', 10, 12),
    row('AV', 1, 1), row('parking', 1, 1),
  ]
  const s = summariseTeams(rows)
  assert.equal(s.teams, 9)
  assert.equal(s.shortTeams, 2)
  assert.equal(s.shortPeople, 3, 'one short 1 and one short 2')
  assert.equal(s.overTeams, 5)
  assert.equal(s.overPeople, 1 + 1 + 1 + 3 + 2)
  assert.equal(s.filled, rows.reduce((n, r) => n + (r.status.gap + r.volunteers_needed), 0))
})

t('describeTeams stays quiet when nothing is wrong', () => {
  assert.equal(describeTeams(summariseTeams([row('a', 2, 2)])), '1 team · 2 of 2 places filled')
  assert.equal(describeTeams(summariseTeams([])), 'No teams yet')
})

t('describeTeams names both problems when both exist', () => {
  const d = describeTeams(summariseTeams([row('a', 4, 2), row('b', 10, 13)]))
  assert.match(d, /1 short 2/)
  assert.match(d, /1 over by 3/)
})

// ── day chips ───────────────────────────────────────────────────────────────
const DAYS0 = ['2026-07-16', '2026-07-17', '2026-07-18', '2026-07-19'] // Day 0..3

t('day chips are ordered, so Day 0 stops appearing last', () => {
  // Real stored values: "hosting" had Day 1,2,3,0 and "kitchen material" had 1,0,3.
  assert.equal(orderedDayLabels(['2026-07-17', '2026-07-18', '2026-07-19', '2026-07-16'], DAYS0), 'Day 0, Day 1, Day 2, Day 3')
  assert.equal(orderedDayLabels(['2026-07-17', '2026-07-16', '2026-07-19'], DAYS0), 'Day 0, Day 1, Day 3')
})

t('no required days means all days', () => {
  assert.equal(orderedDayLabels([], DAYS0), 'Day 0, Day 1, Day 2, Day 3')
  assert.equal(orderedDayLabels(null, DAYS0), 'Day 0, Day 1, Day 2, Day 3')
  assert.equal(orderedDayLabels([], []), 'All days')
})

t('a day outside the event span is shown, not dropped', () => {
  const out = orderedDayLabels(['2026-07-17', '2026-09-01'], DAYS0, (d) => d)
  assert.match(out, /Day 1/)
  assert.match(out, /2026-09-01/, 'an out-of-span date must still be visible')
})

console.log(`\n${pass}/${total} passed`)
