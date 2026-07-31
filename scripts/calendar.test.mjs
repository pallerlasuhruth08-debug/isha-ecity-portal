import assert from 'node:assert/strict'
import { allDayIcs, safeFilename } from '../src/lib/calendarFile.js'

let pass = 0
const t = (name, fn) => { fn(); pass++; console.log('  ok  ' + name) }
const NOW = new Date('2026-07-31T10:00:00Z')
const ics = (o) => allDayIcs({ now: NOW, ...o })

t('an all-day event ends the NEXT day — the boundary every hand-rolled .ics gets wrong', () => {
  const out = ics({ title: 'Mahashivratri', dateISO: '2026-08-02' })
  assert.match(out, /DTSTART;VALUE=DATE:20260802/)
  assert.match(out, /DTEND;VALUE=DATE:20260803/)   // exclusive end; same-day would render as zero-length
})

t('a month-end date rolls the year and month correctly', () => {
  assert.match(ics({ title: 'x', dateISO: '2026-12-31' }), /DTEND;VALUE=DATE:20270101/)
})

t('no date means no file, not a broken one', () => {
  assert.equal(ics({ title: 'x', dateISO: null }), null)
  assert.equal(ics({ title: 'x', dateISO: '' }), null)
})

t('commas and semicolons in an event name are escaped, not left to break the parse', () => {
  const out = ics({ title: 'Satsang, Bhajan; and Volunteering', dateISO: '2026-08-02' })
  assert.ok(out.includes('SUMMARY:Satsang\\, Bhajan\\; and Volunteering'), out)
})

t('a long event name is folded to 75 octets so clients do not drop the line', () => {
  const long = 'Ecstasy of Enlightenment with Sadhguru at the Electronic City centre, evening session'
  const out = ics({ title: long, dateISO: '2026-08-02' })
  for (const l of out.split('\r\n')) assert.ok(l.length <= 75, `line too long (${l.length}): ${l}`)
  // folded continuation lines start with a single space, per RFC 5545
  assert.match(out, /\r\n /)
})

t('the envelope is a complete VCALENDAR with CRLF line endings', () => {
  const out = ics({ title: 'x', dateISO: '2026-08-02' })
  assert.ok(out.startsWith('BEGIN:VCALENDAR\r\n'))
  assert.ok(out.endsWith('END:VCALENDAR'))
  assert.match(out, /BEGIN:VEVENT/)
  assert.match(out, /END:VEVENT/)
  assert.match(out, /UID:/)
  assert.match(out, /DTSTAMP:20260731T100000Z/)
})

t('filenames cannot escape into a path', () => {
  assert.equal(safeFilename('../../etc/passwd'), 'etcpasswd')
  assert.equal(safeFilename('Satsang & Bhajan'), 'Satsang-Bhajan')
  assert.equal(safeFilename(''), 'event')
  assert.equal(safeFilename(null), 'event')
})

console.log(`\n${pass}/${pass} passed`)
