import { supabase } from './supabase'
import { checkMobile } from './phone'
import { istIso, listPoojas } from './poojaWrites'
import { summariseUpcoming, hostingHistory as historyFromListings } from './poojaSummary'

// Host-side of pooja hosting: the dates Isha publishes, the holders eligible on
// each date, and what came back when a volunteer rang them.
//
// The dates are NOT computed. Sannidhi Pooja falls on every Monday plus purnima
// and amavasya; Yantra Pooja on purnima. Purnima and amavasya are lunar, so they
// are imported from Isha's own lunar calendar into `pooja_dates`. A date that is
// one day out sends guests to somebody's home on the wrong evening.

export const POOJA_TYPES = {
  sannidhi: { label: 'Sadhguru Sannidhi Pooja', short: 'Sannidhi', flag: 'has_sadhguru_sannidhi' },
  yantra: { label: 'Yantra Pooja', short: 'Yantra', flag: 'has_devi_yantra' },
}

const todayIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date())

export const fmtDate = (d) => (d
  ? new Date(d + 'T00:00:00').toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' })
  : '')

/**
 * Upcoming pooja dates, one row per date with the types that fall on it.
 * On a purnima both poojas land on the same day, which is why this groups
 * rather than returning a flat list.
 */
export async function listPoojaDates({ limit = 10 } = {}) {
  const { data, error } = await supabase.from('pooja_dates')
    .select('pooja_date, pooja_type')
    .gte('pooja_date', todayIso())
    .order('pooja_date', { ascending: true })
    .limit(limit * 2)
  if (error) throw error
  const byDate = new Map()
  for (const r of data || []) {
    if (!byDate.has(r.pooja_date)) byDate.set(r.pooja_date, { date: r.pooja_date, types: [] })
    byDate.get(r.pooja_date).types.push(r.pooja_type)
  }
  return [...byDate.values()].slice(0, limit)
}

/** How many dates are left in the table — the re-import warning depends on it. */
export async function datesRemaining() {
  const { data, error } = await supabase.from('pooja_dates')
    .select('pooja_type, pooja_date').gte('pooja_date', todayIso())
  if (error) throw error
  const out = {}
  for (const r of data || []) {
    out[r.pooja_type] = out[r.pooja_type] || { count: 0, last: r.pooja_date }
    out[r.pooja_type].count++
    if (r.pooja_date > out[r.pooja_type].last) out[r.pooja_type].last = r.pooja_date
  }
  return out
}

/**
 * Everyone who could host on this date, for one pooja type, with whatever the
 * volunteer already recorded and the pooja already posted (if any).
 *
 * Holders with no address come back first: those are the calls to make, because
 * a confirmed host with no address cannot be published to guests.
 */
export async function listHoldersFor(date, type) {
  const flag = POOJA_TYPES[type]?.flag
  if (!flag) throw new Error(`Unknown pooja type: ${type}`)

  const [{ data: people, error }, optedOut] = await Promise.all([
    supabase.from('people')
      .select('id, full_name, phone, area, street, city, pincode, center_id')
      .eq(flag, true)
      .order('full_name', { ascending: true }),
    listOptOuts(),
  ])
  if (error) throw error
  // Someone who asked not to be invited is off every future list — that is the
  // whole point of them having said so.
  return decorate((people || []).filter((p) => !optedOut.has(p.id)), date, type)
}

/** Everyone who asked not to be invited to host. */
export async function listOptOuts() {
  const { data, error } = await supabase.from('pooja_host_optout').select('person_id')
  if (error) throw error
  return new Set((data || []).map((r) => r.person_id))
}

/**
 * They would rather not host at all — ever, not just this date.
 *
 * Distinct from a "not this time" outcome on purpose: that is an answer about
 * one evening, this is an answer about being asked. Recording it as the former
 * is why people were being rung again a fortnight later.
 */
export async function optOutOfHosting(personId, { note = null, by = null } = {}) {
  const { error } = await supabase.from('pooja_host_optout').upsert({
    person_id: personId, note, decided_by: by, decided_at: new Date().toISOString(),
  }, { onConflict: 'person_id' })
  if (error) throw error
}

/** Put them back on the list — asked in error, or they changed their mind. */
export async function undoOptOut(personId) {
  const { error } = await supabase.from('pooja_host_optout').delete().eq('person_id', personId)
  if (error) throw error
}

/**
 * Everyone to ring for a date — ONE row per person, whatever falls that day.
 *
 * On a purnima both poojas land together. Listing them as two stacked sections
 * meant a person who holds a Sannidhi AND a yantra appeared twice, so a
 * volunteer rang the same home twice for the same evening. Merging by person
 * fixes that and makes "would you do both together?" askable in one call —
 * which is what actually happens on the phone.
 *
 * Each row carries `types`: the poojas THIS person could host on THIS date.
 */
export async function listHostsForDate(date, types) {
  return mergeByPerson(types, await Promise.all(types.map((t) => listHoldersFor(date, t))))
}

/** The same merge for the find-a-host box, so a search result behaves like a row. */
export async function searchHostsForDate(date, types, term) {
  return mergeByPerson(types, await Promise.all(types.map((t) => searchPeopleForHost(date, t, term))))
}

function mergeByPerson(types, lists) {
  const byId = new Map()
  types.forEach((t, i) => {
    for (const h of lists[i]) {
      const e = byId.get(h.id) || { ...h, types: [], outreachByType: {}, listingByType: {} }
      e.types.push(t)
      if (h.outreach) e.outreachByType[t] = h.outreach
      if (h.listing) e.listingByType[t] = h.listing
      byId.set(h.id, e)
    }
  })

  return [...byId.values()].map((e) => ({
    ...e,
    // Answered only when every pooja they could host that day has an answer.
    answered: e.types.every((t) => e.outreachByType[t] || e.listingByType[t]),
    posted: e.types.some((t) => e.listingByType[t]),
  })).sort((a, b) => {
    const rank = (x) => (x.posted ? 3 : x.answered ? 2 : x.hasAddress ? 1 : 0)
    return rank(a) - rank(b) || (a.full_name || '').localeCompare(b.full_name || '')
  })
}

/**
 * Find anyone by name or phone and treat them as a possible host.
 *
 * Holders are the shortlist, not the whole world: a home can host without the
 * Sannidhi being recorded in Ishangam, and until the holder extract has been run
 * the shortlist is empty. This keeps the screen usable in both cases.
 */
export async function searchPeopleForHost(date, type, term) {
  const q = (term || '').trim()
  if (q.length < 2) return []
  const digits = q.replace(/\D/g, '')
  const filter = digits.length >= 3
    ? `phone.ilike.%${digits}%,full_name.ilike.%${q}%`
    : `full_name.ilike.%${q}%`
  const { data, error } = await supabase.from('people')
    .select('id, full_name, phone, area, street, city, pincode, center_id')
    .or(filter)
    .order('full_name', { ascending: true })
    .limit(20)
  if (error) throw error
  return decorate(data || [], date, type)
}

// Attach this date's call outcome and any pooja already posted at that home.
async function decorate(rows, date, type) {
  if (!rows.length) return []
  const ids = rows.map((p) => p.id)
  const [{ data: outreach }, { data: listings }] = await Promise.all([
    supabase.from('pooja_host_outreach')
      .select('person_id, outcome, note, activity_id, decided_at, decided_by')
      .eq('pooja_date', date).eq('pooja_type', type).in('person_id', ids),
    supabase.from('pooja_listings')
      .select('activity_id, host_person_id, status, seats, area, starts_at')
      .in('host_person_id', ids),
  ])

  const byPerson = {}
  for (const o of outreach || []) byPerson[o.person_id] = o
  const listingFor = {}
  for (const l of listings || []) {
    // Only a listing whose IST date is this pooja date counts as "already posted".
    const istDay = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(l.starts_at))
    if (istDay === date) listingFor[l.host_person_id] = l
  }

  return rows.map((p) => ({
    ...p,
    address: [p.street, p.city].filter(Boolean).join(', ') || null,
    hasAddress: !!(p.street && p.street.trim()),
    outreach: byPerson[p.id] || null,
    listing: listingFor[p.id] || null,
  })).sort((a, b) => {
    // Not yet called first, then no-address, then the rest.
    const rank = (x) => (x.listing ? 3 : x.outreach ? 2 : x.hasAddress ? 1 : 0)
    return rank(a) - rank(b) || (a.full_name || '').localeCompare(b.full_name || '')
  })
}

/** Record the outcome of one call. Re-calling overwrites the earlier answer. */
export async function recordOutreach({ date, type, personId, outcome, note = null, activityId = null, by = null }) {
  const { error } = await supabase.from('pooja_host_outreach').upsert({
    pooja_date: date, pooja_type: type, person_id: personId,
    outcome, note, activity_id: activityId, decided_by: by, decided_at: new Date().toISOString(),
  }, { onConflict: 'pooja_date,pooja_type,person_id' })
  if (error) throw error
}

/**
 * A holder said yes: create the pooja at their home and mark the call confirmed.
 *
 * The private address comes from their person record. `area` is asked for
 * explicitly and never auto-filled from `people.area` — that column is free text
 * and some rows hold a full street address, which would publish someone's home
 * on the guest page.
 */
export async function confirmHost({ date, type, types, person, area, seats, time, centerId, by }) {
  // One host can take both poojas on a purnima. That is ONE evening at ONE
  // house, so it is one activity and one listing — posting it twice would put
  // the same home on the guest page twice and split its seats in half. The
  // outreach row is still written per type, because the calendar counts each
  // pooja separately and "who still needs a Yantra host" must stay answerable.
  const kinds = (types && types.length ? types : [type]).filter((t) => POOJA_TYPES[t])
  if (!kinds.length) throw new Error('Pick which pooja they said yes to.')
  if (!area?.trim()) throw new Error('Area is required — it is what guests see instead of the address.')
  if (!(seats >= 1 && seats <= 200)) throw new Error('Seats must be between 1 and 200.')
  if (!person?.street?.trim()) throw new Error('No address on record for this host. Add the address first.')

  const label = kinds.length > 1
    ? kinds.map((t) => POOJA_TYPES[t].short).join(' & ') + ' Pooja'
    : POOJA_TYPES[kinds[0]].label
  const first = (person.full_name || '').trim().split(/\s+/)[0] || 'a home'
  const startsAt = istIso(date, time || '18:00')

  const { data: activity, error: aErr } = await supabase.from('activities').insert({
    name: `${label} at ${first}'s home`,
    center_id: centerId,
    activity_date: date, start_date: date, end_date: date,
    activity_type: 'pooja', is_open: true, created_by: by || null,
  }).select('id').single()
  if (aErr) throw aErr

  let phone = null
  if (person.phone) { const p = checkMobile(person.phone); if (p.ok) phone = p.digits }

  const { error: lErr } = await supabase.from('pooja_listings').insert({
    activity_id: activity.id,
    starts_at: startsAt,
    seats,
    area: area.trim(),
    address: [person.street, person.city, person.pincode].filter(Boolean).join(', '),
    // Coarse only: a pincode covers thousands of homes and is what lets a guest
    // sort by "nearest". The street stays in `address`, which guests never see
    // until they are approved.
    pincode: person.pincode || null,
    host_phone: phone,
    host_person_id: person.id,
    center_id: centerId,
    created_by: by || null,
    status: 'open',
  })
  if (lErr) {
    await supabase.from('activities').delete().eq('id', activity.id)
    throw lErr
  }

  // Every pooja they agreed to points at the same activity.
  for (const t of kinds) {
    await recordOutreach({ date, type: t, personId: person.id, outcome: 'confirmed', activityId: activity.id, by })
  }
  return activity.id
}

/**
 * Fix a host's address. Writes to the PERSON, not to one listing, so it is
 * right everywhere afterwards — this is the "volunteer rings them and gets the
 * address" path, and that address is worth keeping.
 */
export async function updatePersonAddress(personId, { street, city, pincode }) {
  const patch = {}
  if (street !== undefined) patch.street = street?.trim() || null
  if (city !== undefined) patch.city = city?.trim() || null
  if (pincode !== undefined) patch.pincode = pincode?.trim() || null
  if (!Object.keys(patch).length) return
  const { error } = await supabase.from('people').update(patch).eq('id', personId)
  if (error) throw error
  // Put them on the map now, while there is exactly one address to look up.
  // The map used to do this itself for everybody at once, which meant a
  // volunteer had to sit on the map tab for two minutes and watch pins appear.
  // One address, one lookup, here, is the whole job.
  // A refused pin must not fail the save: the address is the thing worth keeping.
  try { await placeOnMap(personId, patch) } catch { /* the pin can wait */ }
}

// Photon (photon.komoot.io) — OpenStreetMap data, no API key, and the only
// third party any of this touches. Nominatim was tried first and is the wrong
// tool here: it could not match Bengaluru apartment names, has no Indian
// postcode data at all, answered several addresses with a street of the same
// name ten kilometres away, and rate-limited a one-off backfill of 96 addresses
// with a 429. Photon fuzzy-matches the complex name and takes a lat/lon bias,
// which is what these addresses actually need.
//
// It still cannot find every building, so the lookup falls back to the locality
// and records how far it got — `source` ending in `-area` is what tells the map
// to draw a circle instead of a pin.
const PHOTON = 'https://photon.komoot.io/api/?limit=1&lat=12.8452&lon=77.6602&q='

// Greater Bengaluru south. A hit outside this is the geocoder reaching for a
// same-named place elsewhere; better no pin than a wrong one.
const inBengaluru = (lat, lng) => lat > 12.55 && lat < 13.05 && lng > 77.4 && lng < 78

async function photonOne(q) {
  try {
    const r = await fetch(PHOTON + encodeURIComponent(q), { headers: { Accept: 'application/json' } })
    if (!r.ok) return null
    const f = (await r.json())?.features?.[0]
    if (!f) return null
    const [lng, lat] = f.geometry.coordinates
    return inBengaluru(lat, lng) ? { lat, lng } : null
  } catch { return null } // offline, or the geocoder is down — the address is still saved
}

// A door number on its own is not an address. "Flat 203, Bengaluru" still
// fuzzy-matches something within a kilometre, and that gets stored as a point —
// a pin on a stranger's building, indistinguishable from a real one. One wrong
// pin was survivable while addresses were placed one at a time; running this
// over the whole list makes it systematic.
const UNIT_WORD = /^(?:no|nos|flat|door|plot|site|villa|apt|apartment|house|block|wing|tower|floor|room|unit|sy|survey)$/i
const isUnitOnly = (t) => !(t || '').split(/[\s,./#-]+/)
  .some((w) => /^[a-z]{3,}$/i.test(w) && !UNIT_WORD.test(w))

/**
 * Place one person. `pointsOnly` refuses the city-level fallback: it is a 2.5km
 * guess, which is WIDER than the postal-area circle most of these people
 * already carry, so accepting it during a bulk run would make the map worse.
 * Throws if the write is refused — a silently discarded result is how an
 * earlier version of this appeared to work while doing nothing.
 */
export async function placeOnMap(personId, address, { pointsOnly = false } = {}) {
  const street = address?.street?.trim()
  const city = address?.city?.trim()
  if (!street && !city) return null
  const seg = (street || '').split(',').map((x) => x.trim()).filter(Boolean)
  const tries = [
    [[street, city, 'Bengaluru'].filter(Boolean).join(', '), 'photon'],
    [seg.length > 1 ? seg.slice(0, 2).join(', ') + ', Bengaluru' : null, 'photon'],
    [seg[0] && !isUnitOnly(seg[0]) ? seg[0] + ', Bengaluru' : null, 'photon'],
    [city ? city + ', Bengaluru' : null, 'photon-area'],
  ]
  for (const [q, source] of tries) {
    if (!q) continue
    if (pointsOnly && source.endsWith('-area')) continue
    const hit = await photonOne(q)
    if (!hit) continue
    // A named building is a point; a bare city fallback is a wide guess and has
    // to carry its width, or the map draws it as somebody's front door.
    const radius_m = source.endsWith('-area') ? 2500 : null
    const { error } = await supabase.from('person_geo').upsert({
      person_id: personId, lat: hit.lat, lng: hit.lng, source, radius_m, geocoded_at: new Date().toISOString(),
    }, { onConflict: 'person_id' })
    if (error) throw error
    return { ...hit, source, radius_m }
  }
  return null
}

/**
 * Ask the geocoder about everyone whose address has never been through it.
 *
 * Almost every holder on this map sits in a ward or postal-area circle not
 * because their address is vague but because nothing ever looked it up: the
 * street line was skipped and they were placed from the pincode. `placeOnMap`
 * only ever ran when a volunteer typed an address into the app, so every
 * imported address missed it. This is that missing pass.
 *
 * One request a second is Photon's usage policy — do not lower it. Anything the
 * geocoder cannot resolve to a building keeps the circle it already has, which
 * is why a miss is not an error here.
 */
export async function markAsked(personId) {
  // A miss, recorded. Only the timestamp moves: the ward or postal circle this
  // person already sits in is still the best thing known about them.
  const { error } = await supabase.from('person_geo')
    .update({ geocoded_at: new Date().toISOString() }).eq('person_id', personId)
  if (error) throw error
}

/** Remove a pin. An unplaced person is honest; a pin on the wrong house is not. */
export async function clearPin(personId) {
  const { error } = await supabase.from('person_geo').delete().eq('person_id', personId)
  if (error) throw error
}

export async function placeMissing(people, { onProgress, alive = () => true, gapMs = 1100 } = {}) {
  let placed = 0
  for (let i = 0; i < people.length; i++) {
    if (!alive()) break
    const p = people[i]
    let hit = null
    try { hit = await placeOnMap(p.id, p, { pointsOnly: true }) }
    catch (e) { throw new Error(`Could not save a pin for ${p.full_name}: ${e.message || e}`) }
    if (hit) placed++
    onProgress?.({ done: i + 1, total: people.length, placed, person: p, hit })
    if (i < people.length - 1 && alive()) await new Promise((r) => setTimeout(r, gapMs))
  }
  return placed
}

// A guest's private handle. Same shape the public RPC issues (32 hex), so a
// volunteer-added guest can look their seat up on the guest page like anyone else.
function newToken() {
  const b = new Uint8Array(16)
  crypto.getRandomValues(b)
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
}

/**
 * Add a guest the volunteer signed up over the phone. Approved immediately —
 * the volunteer just spoke to them, so there is nobody left to approve it.
 */
export async function addGuestByPhone(activityId, { name, phone, party = 1, by = null }) {
  const nm = (name || '').trim()
  if (!nm) throw new Error('Please enter their name.')
  const p = checkMobile(phone)
  if (!p.ok) throw new Error(p.reason)
  if (!(party >= 1 && party <= 3)) throw new Error('Party size must be 1 to 3.')

  const { data, error } = await supabase.from('pooja_requests').insert({
    activity_id: activityId, name: nm, phone: p.digits, party_size: party,
    status: 'approved', token: newToken(),
    decided_at: new Date().toISOString(), decided_by: by || null,
  }).select('id, token').single()
  if (error) throw error
  return data
}

/**
 * The Consecrated spaces report for the Dashboard: where the calling stands for
 * the NEXT date of each pooja type, plus the queue and the cold list.
 *
 * Next date only, not the month. Confirmation is per date (see the hosting
 * flow), so "how is the calling going" is a question about one evening; a
 * month of rows would be a plan, and the Dashboard is a worklist.
 *
 * `centreId` narrows holders and posted poojas to that centre; null shows all.
 * Reuses listHoldersFor / listPoojas rather than new queries so the numbers
 * here can never disagree with the screen the buttons open.
 */
export async function poojaDashboardReport({ centreId = null } = {}) {
  const inCentre = (row) => !centreId || row.center_id === centreId

  const dates = await listPoojaDates({ limit: 20 })
  const nextOf = (type) => dates.find((d) => d.types.includes(type))?.date || null
  const next = { sannidhi: nextOf('sannidhi'), yantra: nextOf('yantra') }

  const [holderLists, everCalled, poojas] = await Promise.all([
    Promise.all(Object.keys(POOJA_TYPES).map((t) => (next[t] ? listHoldersFor(next[t], t) : Promise.resolve([])))),
    supabase.from('pooja_host_outreach').select('person_id').then(({ data, error }) => {
      if (error) throw error
      return new Set((data || []).map((r) => r.person_id))
    }),
    listPoojas(),
  ])

  const byType = {}
  const everyHolder = new Map()
  Object.keys(POOJA_TYPES).forEach((t, i) => {
    const rows = holderLists[i].filter(inCentre)
    rows.forEach((r) => everyHolder.set(r.id, r))
    const outcome = (o) => rows.filter((r) => r.outreach?.outcome === o).length
    byType[t] = {
      date: next[t],
      eligible: rows.length,
      called: rows.filter((r) => r.outreach).length,
      yes: outcome('confirmed'),
      declined: outcome('declined'),
      noAnswer: outcome('no_answer'),
      posted: rows.filter((r) => r.listing).length,
      // A yes with no address on file cannot be published — it is a call to make.
      yesNoAddress: rows.filter((r) => r.outreach?.outcome === 'confirmed' && !r.hasAddress).length,
    }
  })

  const live = poojas.filter((p) => p.status !== 'cancelled' && inCentre(p))
  return {
    byType,
    neverContacted: [...everyHolder.values()].filter((h) => !everCalled.has(h.id)).length,
    guestsWaiting: live.reduce((n, p) => n + (p.pending_count || 0), 0),
    postedUpcoming: live.length,
    seatsLeft: live.reduce((n, p) => n + (p.seats_left || 0), 0),
    postedEmpty: live.filter((p) => !p.approved_headcount).length,
  }
}

// ── Who called, who hosted, what was said ─────────────────────────────────

/** Display names for profile ids — "Called by Priya", not a uuid. */
export async function callerNames(ids) {
  const want = [...new Set((ids || []).filter(Boolean))]
  if (!want.length) return {}
  const { data, error } = await supabase.from('profiles').select('id, full_name, email').in('id', want)
  if (error) throw error
  return Object.fromEntries((data || []).map((p) => [p.id, p.full_name || p.email || 'Someone']))
}

/**
 * { person_id: { count, last } } for everyone who has hosted before — the
 * "Hosted 3× · last 14 Jul" badge. One query for the whole call list.
 */
export async function hostingHistory(personIds) {
  const ids = [...new Set((personIds || []).filter(Boolean))]
  if (!ids.length) return {}
  const { data, error } = await supabase.from('pooja_listings')
    .select('host_person_id, starts_at, status')
    .in('host_person_id', ids)
    .lt('starts_at', new Date().toISOString())
  if (error) throw error
  return historyFromListings(data || [])
}

// Notes and help asks live in pooja_host_notes — one thread per person, every
// entry kept with its author. See supabase/migrations/20260903_pooja_host_notes.sql.
export const NOTE_KINDS = {
  note: { label: 'Note', help: false },
  help_setup: { label: 'Needs help setting up', help: true },
  help_materials: { label: 'Needs pooja materials', help: true },
  follow_up: { label: 'Needs a follow-up call', help: true },
  other: { label: 'Needs help — other', help: true },
}
const NOTE_COLS = 'id, person_id, kind, body, author_id, created_at, resolved_at, resolved_by'

export async function listHostNotes(personId) {
  const { data, error } = await supabase.from('pooja_host_notes')
    .select(NOTE_COLS).eq('person_id', personId).order('created_at', { ascending: false })
  if (error) throw error
  return data || []
}

export async function addHostNote(personId, { kind = 'note', body, by = null }) {
  const text = (body || '').trim()
  if (!text) throw new Error('Write something first.')
  if (!NOTE_KINDS[kind]) throw new Error(`Unknown note kind: ${kind}`)
  const { error } = await supabase.from('pooja_host_notes')
    .insert({ person_id: personId, kind, body: text, author_id: by })
  if (error) throw error
}

export async function resolveHostNote(id, { by = null, resolved = true } = {}) {
  const { error } = await supabase.from('pooja_host_notes')
    .update(resolved
      ? { resolved_at: new Date().toISOString(), resolved_by: by }
      : { resolved_at: null, resolved_by: null })
    .eq('id', id)
  if (error) throw error
}

/** Every unresolved help ask, with the person it is about. Oldest first. */
export async function listOpenHelp() {
  const { data, error } = await supabase.from('pooja_host_notes')
    .select(`${NOTE_COLS}, person:people(id, full_name, phone, center_id)`)
    .neq('kind', 'note').is('resolved_at', null)
    .order('created_at', { ascending: true })
  if (error) throw error
  return data || []
}

/** Open help asks per person, for the pill on the call-list row. */
export async function openHelpByPerson(personIds) {
  const ids = [...new Set((personIds || []).filter(Boolean))]
  if (!ids.length) return {}
  const { data, error } = await supabase.from('pooja_host_notes')
    .select('person_id, kind').in('person_id', ids).neq('kind', 'note').is('resolved_at', null)
  if (error) throw error
  const out = {}
  for (const r of data || []) (out[r.person_id] = out[r.person_id] || []).push(r.kind)
  return out
}

// ── The Upcoming tab ──────────────────────────────────────────────────────

/**
 * Every upcoming pooja date with the calling summarised — four queries for the
 * whole tab, not two per date. The arithmetic is in poojaSummary.js.
 *
 * `includePast` adds the dates that have already happened (from the listings
 * that exist for them), so "who hosted in July" is one switch away.
 */
export async function upcomingCallSummary({ centreId = null, includePast = false, limit = 12 } = {}) {
  const [dates, holders, outreach, poojas] = await Promise.all([
    listPoojaDates({ limit }),
    supabase.from('people')
      .select('id, center_id, has_sadhguru_sannidhi, has_devi_yantra')
      .or('has_sadhguru_sannidhi.eq.true,has_devi_yantra.eq.true')
      .then(async ({ data, error }) => {
        if (error) throw error
        const out = await listOptOuts()
        return (data || []).filter((p) => !out.has(p.id))
      }),
    supabase.from('pooja_host_outreach')
      .select('pooja_date, pooja_type, person_id, outcome')
      .gte('pooja_date', includePast ? '2000-01-01' : todayIso())
      .then(({ data, error }) => { if (error) throw error; return data || [] }),
    listPoojas({ includePast }),
  ])

  let allDates = dates
  if (includePast) {
    // Past dates come from what was actually posted, newest first, above the
    // upcoming ones. The calendar table only holds the future.
    const today = todayIso()
    const seen = new Set(dates.map((d) => d.date))
    const past = new Map()
    for (const p of poojas) {
      const d = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date(p.starts_at))
      if (d >= today || seen.has(d)) continue
      if (!past.has(d)) past.set(d, { date: d, types: [] })
    }
    for (const o of outreach) {
      if (o.pooja_date >= today || seen.has(o.pooja_date)) continue
      const e = past.get(o.pooja_date) || { date: o.pooja_date, types: [] }
      if (!e.types.includes(o.pooja_type)) e.types.push(o.pooja_type)
      past.set(o.pooja_date, e)
    }
    allDates = [...[...past.values()].sort((a, b) => (a.date < b.date ? 1 : -1)), ...dates]
  }

  return summariseUpcoming({ dates: allDates, holders, outreach, listings: poojas, centreId })
}
