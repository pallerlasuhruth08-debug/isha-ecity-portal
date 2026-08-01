// Event readiness: the staffing count a list row shows.
import assert from 'node:assert/strict'
import { teamFill, deriveStage, stageTone, eventIsOver } from '../src/lib/planning.js'

let pass = 0
let total = 0
const t = (name, fn) => {
  total++
  try { fn(); pass++; console.log('  ok  ' + name) }
  catch (e) { console.log('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1 }
}

const TODAY = '2026-08-01'

console.log('\nreadiness')

// ── staffing ────────────────────────────────────────────────────────────────
const bl = (id, needed, archived = null) => ({ id, volunteers_needed: needed, archived_at: archived })
const asg = (block_id, person_id, status = 'assigned') => ({ block_id, person_id, status })

t('no teams reads as zero, not as full', () => {
  assert.deepEqual(teamFill([], []), { teams: 0, needed: 0, filled: 0 })
})

t('needed counts each team once, not once per day', () => {
  const f = teamFill([bl('a', 5), bl('b', 3)], [])
  assert.equal(f.teams, 2)
  assert.equal(f.needed, 8)
  assert.equal(f.filled, 0)
})

t('one person on two teams counts twice — they are doing two jobs', () => {
  const f = teamFill([bl('a', 5), bl('b', 3)], [asg('a', 'p1'), asg('b', 'p1')])
  assert.equal(f.filled, 2)
})

t('the same person assigned twice to one team counts once', () => {
  const f = teamFill([bl('a', 5)], [asg('a', 'p1'), asg('a', 'p1')])
  assert.equal(f.filled, 1)
})

t('no-show and dropped vacate the slot; show and involved hold it', () => {
  const f = teamFill([bl('a', 9)], [
    asg('a', 'p1', 'assigned'), asg('a', 'p2', 'show'), asg('a', 'p3', 'involved'),
    asg('a', 'p4', 'no_show'), asg('a', 'p5', 'dropped'),
  ])
  assert.equal(f.filled, 3)
})

t('assignments to archived or unknown teams are ignored', () => {
  const f = teamFill([bl('a', 5), bl('gone', 5, '2026-01-01')], [asg('a', 'p1'), asg('gone', 'p2'), asg('ghost', 'p3')])
  assert.equal(f.teams, 1)
  assert.equal(f.needed, 5)
  assert.equal(f.filled, 1)
})

t('a missing volunteers_needed is 0, never NaN', () => {
  const f = teamFill([{ id: 'a' }, { id: 'b', volunteers_needed: null }], [])
  assert.equal(f.needed, 0)
  assert.ok(Number.isFinite(f.needed))
})


// ── stage, which replaced the phase model ───────────────────────────────────
t('an event stage comes from its dates alone', () => {
  assert.equal(deriveStage('2026-08-10', '2026-08-12', TODAY), 'Upcoming')
  assert.equal(deriveStage('2026-08-01', '2026-08-01', TODAY), 'Day-of')
  assert.equal(deriveStage('2026-07-01', '2026-07-02', TODAY), 'Done')
})

t('every stage has a tone, and an unknown one does not crash the calendar', () => {
  for (const st of ['Upcoming', 'Day-of', 'Done']) assert.ok(stageTone(st).bg && stageTone(st).fg)
  assert.deepEqual(stageTone('nonsense'), stageTone('Upcoming'))
})

t('a finished event is over', () => {
  assert.equal(eventIsOver({ end_date: '2026-07-31' }, TODAY), true)
  assert.equal(eventIsOver({ end_date: '2026-08-01' }, TODAY), false)
})

console.log(`\n${pass}/${total} passed`)
