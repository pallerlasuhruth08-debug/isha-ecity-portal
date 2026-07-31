import assert from 'node:assert/strict'
import { eventsNeedingAttention, eventIsOver } from '../src/lib/planning.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name) }
const TODAY = '2026-07-31'

const ev = (id, name, start, end) => ({ id, name, start_date: start, end_date: end || start })
const ph = (id, kind, startBy, extra = {}) => ({ activity_id: id, kind, start_by: startBy, ...extra })

t('a finished event is not "overdue" — it is over', () => {
  // The bug this exists to prevent: "IE - 2 day (Dec 2025)" shouting "start by 29 Nov" in July.
  const events = [ev('past', 'IE - 2 day (Dec 2025)', '2025-12-01', '2025-12-02')]
  const phases = { past: [ph('past', 'pre_far', '2025-11-29'), ph('past', 'post', '2025-12-22')] }
  assert.equal(eventsNeedingAttention(events, phases, TODAY).length, 0)
  assert.equal(eventIsOver(events[0], TODAY), true)
})

t('an event ending TODAY is still live — the boundary is strictly past', () => {
  assert.equal(eventIsOver(ev('x', 'x', '2026-07-30', TODAY), TODAY), false)
  assert.equal(eventIsOver(ev('x', 'x', '2026-07-29', '2026-07-30'), TODAY), true)
})

t('four late phases on one event become ONE row, not four', () => {
  const events = [ev('gp', 'Guru Purnima', '2026-08-10')]
  const phases = { gp: ['pre_far', 'pre_near', 'day_of', 'post'].map((k, i) => ph('gp', k, `2026-07-0${i + 1}`)) }
  const out = eventsNeedingAttention(events, phases, TODAY)
  assert.equal(out.length, 1)
  assert.equal(out[0].count, 4)
  assert.equal(out[0].overdue, 4)
})

t('the row carries the SOONEST date anyone is late against', () => {
  const events = [ev('gp', 'Guru Purnima', '2026-08-10')]
  const phases = { gp: [ph('gp', 'day_of', '2026-07-29'), ph('gp', 'pre_far', '2026-07-08')] }
  assert.equal(eventsNeedingAttention(events, phases, TODAY)[0].earliest, '2026-07-08')
})

t('overdue events sort above at-risk ones', () => {
  const events = [ev('risk', 'At risk', '2026-08-20'), ev('late', 'Overdue', '2026-08-25')]
  const phases = {
    // started but finishing imminently -> at_risk; never started and past start_by -> overdue
    risk: [ph('risk', 'pre_far', '2026-07-01', { started_at: '2026-07-01', finish_by: '2026-08-01' })],
    late: [ph('late', 'pre_far', '2026-07-10')],
  }
  const out = eventsNeedingAttention(events, phases, TODAY)
  assert.equal(out[0].event.name, 'Overdue')
  assert.equal(out[0].overdue, 1)
  assert.equal(out[1].atRisk, 1)
})

t('a completed phase is not flagged, so a prepared event never appears', () => {
  const events = [ev('ok', 'All done', '2026-08-10')]
  const phases = { ok: [ph('ok', 'pre_far', '2026-07-01', { started_at: '2026-07-01', completed_at: '2026-07-05' })] }
  assert.deepEqual(eventsNeedingAttention(events, phases, TODAY), [])
})

t('an event with no phases at all is silent, not "0 overdue"', () => {
  assert.deepEqual(eventsNeedingAttention([ev('bare', 'Bare', '2026-08-10')], {}, TODAY), [])
})

console.log(`\n${pass}/${pass} passed`)
