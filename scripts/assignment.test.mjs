import assert from 'node:assert/strict'
import { distribute, DEFAULT_CAP, describeShare } from '../src/lib/assignment.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name) }

const nur = (id, pincode, load = 0) => ({ personId: id, full_name: id, pincode, load })
const ppl = (n, pincode, prefix = 'p') => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, pincode }))
const total = (r) => r.plan.reduce((s, x) => s + x.personIds.length, 0)

t('a cohort is SPLIT across nurturers, not piled on one', () => {
  // The bug this whole module exists to fix: 200 people onto a single volunteer.
  const r = distribute(ppl(9, '560100'), [nur('a', '560100'), nur('b', '560100'), nur('c', '560100')], { cap: 100 })
  assert.equal(r.plan.length, 3)
  assert.deepEqual(r.plan.map((s) => s.personIds.length), [3, 3, 3])
})

t('people go to a nurturer in their own pincode when one has room', () => {
  const people = [...ppl(2, '560100', 'x'), ...ppl(2, '562106', 'y')]
  const r = distribute(people, [nur('north', '560100'), nur('south', '562106')], { cap: 10 })
  const north = r.plan.find((s) => s.nurturer.personId === 'north')
  const south = r.plan.find((s) => s.nurturer.personId === 'south')
  assert.deepEqual(north.personIds.sort(), ['x0', 'x1'])
  assert.deepEqual(south.personIds.sort(), ['y0', 'y1'])
  assert.equal(north.samePincode, 2)
})

t('a full local nurturer spills over rather than blocking the person', () => {
  const r = distribute(ppl(3, '560100'), [nur('local', '560100', 2), nur('far', '999999')], { cap: 3 })
  const local = r.plan.find((s) => s.nurturer.personId === 'local')
  const far = r.plan.find((s) => s.nurturer.personId === 'far')
  assert.equal(local.personIds.length, 1)   // one slot left, uses it
  assert.equal(far.personIds.length, 2)     // the rest spill
  assert.deepEqual(r.unassigned, [])
})

t('existing load counts toward the cap — a full nurturer gets nobody', () => {
  const r = distribute(ppl(2, '560100'), [nur('busy', '560100', DEFAULT_CAP), nur('free', '560100', 0)], {})
  assert.equal(r.plan.length, 1)
  assert.equal(r.plan[0].nurturer.personId, 'free')
})

// The refusal rule: a cohort that does not fit must come back, not vanish.
t('leftovers are RETURNED, never silently dropped', () => {
  const r = distribute(ppl(10, '560100'), [nur('a', '560100')], { cap: 4 })
  assert.equal(total(r), 4)
  assert.equal(r.unassigned.length, 6)
  assert.equal(total(r) + r.unassigned.length, 10)
})

t('with no nurturers at all, everyone comes back unassigned', () => {
  const r = distribute(ppl(3, '560100'), [], { cap: 10 })
  assert.deepEqual(r.plan, [])
  assert.equal(r.unassigned.length, 3)
  assert.equal(r.capacity, 0)
})

t('capacity is reported BEFORE placing, so the UI can warn up front', () => {
  const r = distribute([], [nur('a', 'x', 20), nur('b', 'y', 0)], { cap: 25 })
  assert.equal(r.capacity, 5 + 25)
})

t('people with no pincode are placed, and placed LAST', () => {
  // A pincode-less person taking the local nurturer's last slot ahead of a
  // neighbour is strictly worse, so they wait.
  const people = [{ id: 'nopin', pincode: null }, { id: 'local', pincode: '560100' }]
  const r = distribute(people, [nur('n', '560100')], { cap: 1 })
  assert.deepEqual(r.plan[0].personIds, ['local'])
  assert.deepEqual(r.unassigned, ['nopin'])
})

t('the split is balanced, not first-come — the least loaded nurturer goes first', () => {
  const r = distribute(ppl(4, '560100'), [nur('a', '560100', 3), nur('b', '560100', 0)], { cap: 10 })
  const a = r.plan.find((s) => s.nurturer.personId === 'a')
  const b = r.plan.find((s) => s.nurturer.personId === 'b')
  assert.equal(b.personIds.length, 3)  // b catches up first
  assert.equal(a.personIds.length, 1)
})

t('the same cohort and roster always produce the same plan', () => {
  const people = ppl(7, '560100')
  const roster = [nur('a', '560100'), nur('b', '560100'), nur('c', '560100')]
  assert.deepEqual(distribute(people, roster, { cap: 9 }), distribute(people, roster, { cap: 9 }))
})

t('nobody is assigned twice', () => {
  const r = distribute(ppl(20, '560100'), [nur('a', '560100'), nur('b', '560100')], { cap: 25 })
  const all = r.plan.flatMap((s) => s.personIds)
  assert.equal(new Set(all).size, all.length)
})

t('describeShare says how many and how many are local', () => {
  assert.equal(describeShare({ personIds: ['a', 'b'], samePincode: 2 }), '2 people · 2 near them')
  assert.equal(describeShare({ personIds: ['a'], samePincode: 0 }), '1 person')
})

console.log(`\n${pass}/${pass} passed`)
