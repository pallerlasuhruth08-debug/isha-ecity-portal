import assert from 'node:assert/strict'
import { summariseUpcoming, hostingHistory } from '../src/lib/poojaSummary.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name) }

const holders = [
  { id: 'a', has_sadhguru_sannidhi: true, has_devi_yantra: false, center_id: 'ect' },
  { id: 'b', has_sadhguru_sannidhi: true, has_devi_yantra: true, center_id: 'ect' },
  { id: 'c', has_sadhguru_sannidhi: false, has_devi_yantra: true, center_id: 'hsr' },
  { id: 'd', has_sadhguru_sannidhi: true, has_devi_yantra: false, center_id: 'hsr' },
]
const dates = [
  { date: '2026-09-07', types: ['sannidhi'] },
  { date: '2026-09-10', types: ['sannidhi', 'yantra'] }, // purnima
]
const outreach = [
  { pooja_date: '2026-09-07', pooja_type: 'sannidhi', person_id: 'a', outcome: 'confirmed' },
  { pooja_date: '2026-09-07', pooja_type: 'sannidhi', person_id: 'b', outcome: 'declined' },
  { pooja_date: '2026-09-07', pooja_type: 'sannidhi', person_id: 'd', outcome: 'no_answer' },
  { pooja_date: '2026-09-10', pooja_type: 'yantra', person_id: 'c', outcome: 'confirmed' },
]
// 4:30am IST on the 7th is the 6th in UTC — the date must be read in IST.
const listings = [
  { activity_id: 'L1', host_person_id: 'a', starts_at: '2026-09-06T23:00:00Z', status: 'open', center_id: 'ect', pending_count: 2 },
  { activity_id: 'L2', host_person_id: 'c', starts_at: '2026-09-10T12:30:00Z', status: 'cancelled', center_id: 'hsr', pending_count: 1 },
  { activity_id: 'L3', host_person_id: 'b', starts_at: '2026-09-10T12:30:00Z', status: 'open', center_id: 'ect', pending_count: 0 },
]

t('counts per date and type, all centres', () => {
  const [d7, d10] = summariseUpcoming({ dates, holders, outreach, listings })
  assert.equal(d7.eligible, 3)                      // a, b, d hold sannidhi
  assert.deepEqual([d7.yes, d7.declined, d7.noAnswer, d7.called], [1, 1, 1, 3])
  assert.equal(d7.posted.length, 1)                 // L1, filed under the 7th in IST
  assert.equal(d7.guestsWaiting, 2)
  assert.equal(d10.byType.sannidhi.eligible, 3)
  assert.equal(d10.byType.yantra.eligible, 2)       // b, c
  assert.equal(d10.byType.yantra.yes, 1)
  assert.equal(d10.posted.length, 1)                // L2 cancelled, dropped
})

t('a posted host counts as called even without an outreach row', () => {
  const [, d10] = summariseUpcoming({ dates, holders, outreach, listings })
  // b has no outreach on the 10th but L3 is at b's home that day.
  assert.equal(d10.byType.sannidhi.called, 1)
})

t('centre filter narrows holders and listings', () => {
  const [d7, d10] = summariseUpcoming({ dates, holders, outreach, listings, centreId: 'hsr' })
  assert.equal(d7.eligible, 1)                      // d only
  assert.equal(d7.noAnswer, 1)
  assert.equal(d7.posted.length, 0)                 // L1 is ect
  assert.equal(d10.byType.yantra.eligible, 1)       // c
})

t('hosting history counts past non-cancelled listings, newest date kept', () => {
  const past = [
    { host_person_id: 'a', starts_at: '2026-06-01T12:30:00Z', status: 'closed' },
    { host_person_id: 'a', starts_at: '2026-07-14T12:30:00Z', status: 'closed' },
    { host_person_id: 'a', starts_at: '2026-08-01T12:30:00Z', status: 'cancelled' },
    { host_person_id: 'b', starts_at: '2099-01-01T12:30:00Z', status: 'open' },   // future
    { host_person_id: null, starts_at: '2026-05-01T12:30:00Z', status: 'closed' }, // hand-posted, no host
  ]
  const h = hostingHistory(past, { now: new Date('2026-09-03T00:00:00Z') })
  assert.deepEqual(h.a, { count: 2, last: '2026-07-14' })
  assert.equal(h.b, undefined)
  assert.equal(Object.keys(h).length, 1)
})

console.log(`${pass} passed`)
