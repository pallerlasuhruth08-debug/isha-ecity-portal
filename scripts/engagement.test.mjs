// Contact recency: the buckets, the labels, and the two NULL holes that made the
// old "quiet" list look finished at 50 people out of 1,286.
import assert from 'node:assert/strict'
import {
  contactState, ishaActivityLabel, applyIshaActivity, daysSince, daysAgoISO,
  ISHA_ACTIVITY_OPTIONS, CONTACT_OPTIONS, NEVER, RECENT, FADING, QUIET,
} from '../src/lib/engagement.js'

let pass = 0
const t = (name, fn) => {
  try { fn(); pass++; console.log('  ok  ' + name) }
  catch (e) { console.log('FAIL  ' + name + '\n      ' + e.message); process.exitCode = 1 }
}

const TODAY = new Date('2026-08-01T00:00:00Z')
const daysBefore = (n) => new Date(TODAY.getTime() - n * 86400000).toISOString()

console.log('\nengagement')

t('no attendance and no call is NEVER, in words', () => {
  const s = contactState({}, TODAY)
  assert.equal(s.bucket, NEVER)
  assert.equal(s.label, 'Never contacted')
  assert.equal(s.at, null)
  // The whole point: it must not render as an em-dash next to a real date.
  assert.equal(s.tone, 'warn')
})

t('undefined argument is the same as no contact', () => {
  assert.equal(contactState(undefined, TODAY).bucket, NEVER)
})

t('buckets are 0-30 recent, 31-90 fading, 91+ quiet', () => {
  assert.equal(contactState({ metAt: daysBefore(0) }, TODAY).bucket, RECENT)
  assert.equal(contactState({ metAt: daysBefore(30) }, TODAY).bucket, RECENT)
  assert.equal(contactState({ metAt: daysBefore(31) }, TODAY).bucket, FADING)
  assert.equal(contactState({ metAt: daysBefore(90) }, TODAY).bucket, FADING)
  assert.equal(contactState({ metAt: daysBefore(91) }, TODAY).bucket, QUIET)
})

t('the most recent of a visit and a call wins', () => {
  const s = contactState({ metAt: daysBefore(40), calledAt: daysBefore(3) }, TODAY)
  assert.equal(s.how, 'Called')
  assert.equal(s.days, 3)
  const s2 = contactState({ metAt: daysBefore(3), calledAt: daysBefore(40) }, TODAY)
  assert.equal(s2.how, 'Met')
})

t('a visit and a call on the same day reads as Met', () => {
  const same = daysBefore(5)
  assert.equal(contactState({ metAt: same, calledAt: same }, TODAY).how, 'Met')
})

t('only a call still counts as contact', () => {
  const s = contactState({ calledAt: daysBefore(12) }, TODAY)
  assert.equal(s.bucket, RECENT)
  assert.equal(s.label, 'Called 12 days ago')
})

t('labels are human at every scale', () => {
  assert.equal(contactState({ metAt: daysBefore(0) }, TODAY).label, 'Met today')
  assert.equal(contactState({ metAt: daysBefore(1) }, TODAY).label, 'Met yesterday')
  assert.equal(contactState({ metAt: daysBefore(12) }, TODAY).label, 'Met 12 days ago')
  assert.equal(contactState({ metAt: daysBefore(45) }, TODAY).label, 'Met last month')
  assert.equal(contactState({ metAt: daysBefore(150) }, TODAY).label, 'Met 5 months ago')
  // Real data: one volunteer's last recorded attendance is 14 months old.
  assert.equal(contactState({ metAt: daysBefore(425) }, TODAY).label, 'Met 14 months ago')
  assert.equal(contactState({ metAt: daysBefore(1200) }, TODAY).label, 'Met 3+ years ago')
})

t('a quiet contact is flagged, a recent one is not', () => {
  assert.equal(contactState({ metAt: daysBefore(200) }, TODAY).tone, 'warn')
  assert.equal(contactState({ metAt: daysBefore(10) }, TODAY).tone, 'ok')
})

t('Isha activity is never described as contact', () => {
  const label = ishaActivityLabel(daysBefore(10), TODAY)
  assert.match(label, /Isha activity/)
  assert.doesNotMatch(label, /Met|Called|Seen|contacted/i)
  assert.equal(ishaActivityLabel(null, TODAY), 'No Isha activity on record')
})

t('daysSince tolerates junk', () => {
  assert.equal(daysSince(null), null)
  assert.equal(daysSince(''), null)
  assert.equal(daysSince('not a date'), null)
})

// ── The bug this file exists for ──────────────────────────────────────────────
// A fake query builder that records the operators applied to it.
const fakeQ = () => {
  const calls = []
  const q = {
    calls,
    gte: (c, v) => (calls.push(['gte', c, v]), q),
    lt: (c, v) => (calls.push(['lt', c, v]), q),
    is: (c, v) => (calls.push(['is', c, v]), q),
  }
  return q
}

t('"quiet" uses lt, which excludes NULL - so "none" must exist to reach them', () => {
  const quiet = applyIshaActivity(fakeQ(), 'quiet', 'last_active_date', TODAY)
  assert.deepEqual(quiet.calls, [['lt', 'last_active_date', '2026-05-03']])
  // The old screen offered ONLY the three lt/gte options. 1,154 of 1,286
  // volunteers have last_active_date NULL, so they matched none of them and
  // could not be listed at all. This option is the whole fix.
  const none = applyIshaActivity(fakeQ(), 'none', 'last_active_date', TODAY)
  assert.deepEqual(none.calls, [['is', 'last_active_date', null]])
  assert.ok(ISHA_ACTIVITY_OPTIONS.some((o) => o.v === 'none'), 'the NULL option must be offered')
})

t('30 and 90 day windows are inclusive lower bounds', () => {
  assert.deepEqual(applyIshaActivity(fakeQ(), '30', 'last_active_date', TODAY).calls, [['gte', 'last_active_date', '2026-07-02']])
  assert.deepEqual(applyIshaActivity(fakeQ(), '90', 'last_active_date', TODAY).calls, [['gte', 'last_active_date', '2026-05-03']])
})

t('an unknown or empty value applies nothing', () => {
  assert.deepEqual(applyIshaActivity(fakeQ(), '', 'last_active_date', TODAY).calls, [])
  assert.deepEqual(applyIshaActivity(fakeQ(), 'wat', 'last_active_date', TODAY).calls, [])
})

t('every offered option is actually implemented', () => {
  for (const o of ISHA_ACTIVITY_OPTIONS) {
    assert.ok(applyIshaActivity(fakeQ(), o.v, 'last_active_date', TODAY).calls.length === 1, `${o.v} applies no filter`)
  }
})

t('option labels never claim the transaction date is our contact', () => {
  for (const o of ISHA_ACTIVITY_OPTIONS) assert.doesNotMatch(o.label, /\b(Active|Seen|Met|Called|contact)\b/i, o.label)
  for (const o of CONTACT_OPTIONS) assert.match(o.label, /met|call|contact/i, o.label)
})

t('daysAgoISO is a plain date, not a timestamp', () => {
  assert.equal(daysAgoISO(90, TODAY), '2026-05-03')
  assert.match(daysAgoISO(1, TODAY), /^\d{4}-\d{2}-\d{2}$/)
})

console.log(`\n${pass}/${pass} passed`)
