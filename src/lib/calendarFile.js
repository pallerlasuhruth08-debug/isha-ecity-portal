// A downloadable .ics for a single all-day event.
//
// WHY .ics AND NOT A GOOGLE CALENDAR LINK
// A Google link excludes everyone on an iPhone using Apple Calendar, which at a
// centre in Bengaluru is a large share of the people we are asking to show up.
// An .ics blob is offered to the calendar app on both iOS and Android, and opens
// in Outlook and Apple Calendar on a desktop.
//
// WHY ALL-DAY
// `activities` has a date but no start time and no venue column. Inventing a 9am
// start or a location we do not hold would put a wrong time in someone's calendar,
// which is worse than no entry at all. The event is written as an all-day entry and
// the description says plainly that a coordinator will confirm the timing.

const pad = (n) => String(n).padStart(2, '0')
const stamp = (d) => `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`
const dayStamp = (iso) => String(iso).slice(0, 10).replace(/-/g, '')

// RFC 5545: escape, then fold to 75 octets. Long event names are common and an
// unfolded line is silently dropped by some calendar clients.
function line(name, value) {
  const escaped = String(value).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
  const full = `${name}:${escaped}`
  if (full.length <= 75) return full
  const out = [full.slice(0, 75)]
  let rest = full.slice(75)
  while (rest.length > 74) { out.push(' ' + rest.slice(0, 74)); rest = rest.slice(74) }
  if (rest) out.push(' ' + rest)
  return out.join('\r\n')
}

/** @param dateISO 'YYYY-MM-DD'. Returns the .ics text, or null if there is no date. */
export function allDayIcs({ title, dateISO, description = '', uid, now = new Date() }) {
  if (!dateISO) return null
  const start = dayStamp(dateISO)
  const end = dayStamp(new Date(new Date(`${String(dateISO).slice(0, 10)}T00:00:00Z`).getTime() + 86400000).toISOString())
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Isha Electronic City//Volunteer Care//EN',
    'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT',
    line('UID', uid || `${start}-${title}@isha-ecity`),
    line('DTSTAMP', stamp(now)),
    `DTSTART;VALUE=DATE:${start}`,
    `DTEND;VALUE=DATE:${end}`,
    line('SUMMARY', title),
    description ? line('DESCRIPTION', description) : null,
    'END:VEVENT',
    'END:VCALENDAR',
  ].filter(Boolean).join('\r\n')
}

export function downloadIcs(ics, filename = 'event.ics') {
  const url = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }))
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export const safeFilename = (s) => String(s || 'event').replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '-').slice(0, 60) || 'event'
