// Event readiness: the roll-up a list row can say, and the staffing count behind it.
import assert from 'node:assert/strict'
import { phaseSummary, teamFill, phaseFlag, PHASE_SHORT, currentPhase } from '../src/lib/planning.js'

let pass = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log('  ok  ' + name) }
  catch (e) { console.log('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1 }
}

const TODAY = '2026-08-01'
const ph = (o) => ({ kind: 'pre_far', start_by: null, finish_by: null, started_at: null, completed_at: null, ...o })

console.log('\nreadiness')

t('no phases is not a problem, it is silence', () => {
  const s = phaseSummary([], TODAY)
  assert.deepEqual(s, { overdue: 0, atRisk: 0, worst: null, nextDue: null })
  assert.equal(phaseSummary(null, TODAY).worst, null)
})

t('a phase past its start date and never started is overdue', () => {
  const s = phaseSummary([ph({ start_by: '2026-07-11' }), ph({ start_by: '2026-07-25' })], TODAY)
  assert.equal(s.overdue, 2)
  assert.equal(s.worst, 'overdue')
})

// The whole reason this pass exists: 104 phase rows in the live database, 0 with
// started_at or completed_at set, because nothing in the app could write them. The
// Dashboard's "preparation slipping" panel was an alarm nobody could switch off.
t('marking a phase started clears overdue', () => {
  const p = ph({ start_by: '2026-07-11' })
  assert.equal(phaseFlag(p, TODAY), 'overdue')
  assert.equal(phaseFlag({ ...p, started_at: '2026-07-12T00:00:00Z' }, TODAY), null)
})

t('marking a phase done clears every flag, including at-risk', () => {
  const p = ph({ start_by: '2026-07-11', finish_by: '2026-08-02', started_at: '2026-07-12T00:00:00Z' })
  assert.equal(phaseFlag(p, TODAY), 'at_risk')
  assert.equal(phaseFlag({ ...p, completed_at: '2026-08-01T00:00:00Z' }, TODAY), null)
})

t('a started phase with a near finish date is at risk, not overdue', () => {
  const s = phaseSummary([ph({ start_by: '2026-07-11', finish_by: '2026-08-02', started_at: '2026-07-12T00:00:00Z' })], TODAY)
  assert.equal(s.overdue, 0)
  assert.equal(s.atRisk, 1)
  assert.equal(s.worst, 'at_risk')
})

t('overdue outranks at-risk', () => {
  const s = phaseSummary([
    ph({ start_by: '2026-07-11', finish_by: '2026-08-02', started_at: '2026-07-12T00:00:00Z' }),
    ph({ start_by: '2026-07-25' }),
  ], TODAY)
  assert.equal(s.worst, 'overdue')
})

t('nextDue is the earliest incomplete start date', () => {
  const s = phaseSummary([
    ph({ start_by: '2026-09-01' }),
    ph({ start_by: '2026-07-11', completed_at: '2026-07-12T00:00:00Z' }),
    ph({ start_by: '2026-08-15' }),
  ], TODAY)
  assert.equal(s.nextDue, '2026-08-15', 'a completed phase is not still due')
})

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

// ── vocabulary ──────────────────────────────────────────────────────────────
t('phase names are words a coordinator would use', () => {
  for (const v of Object.values(PHASE_SHORT)) {
    assert.doesNotMatch(v, /pre[-_]|_/i, `"${v}" is schema jargon`)
  }
  assert.equal(PHASE_SHORT.pre_far, 'Early prep')
  assert.equal(PHASE_SHORT.day_of, 'Event days')
})

t('currentPhase speaks the same vocabulary', () => {
  const ev = { start_date: '2026-08-01', end_date: '2026-08-01' }
  const phases = [
    { kind: 'pre_far', sort_order: 0, start_by: '2026-07-11', finish_by: '2026-07-24' },
    { kind: 'day_of', sort_order: 1, start_by: '2026-08-01', finish_by: '2026-08-01' },
  ]
  assert.equal(currentPhase(ev, phases, TODAY).label, 'Event days')
})

console.log(`\n${pass}/${pass} passed`)
