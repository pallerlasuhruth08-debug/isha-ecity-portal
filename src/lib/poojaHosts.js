import { supabase } from './supabase'
import { checkMobile } from './phone'
import { istIso } from './poojaWrites'

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

  const { data: people, error } = await supabase.from('people')
    .select('id, full_name, phone, area, street, city, pincode')
    .eq(flag, true)
    .order('full_name', { ascending: true })
  if (error) throw error
  const rows = people || []
  if (!rows.length) return []

  const ids = rows.map((p) => p.id)
  const [{ data: outreach }, { data: listings }] = await Promise.all([
    supabase.from('pooja_host_outreach')
      .select('person_id, outcome, note, activity_id, decided_at')
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
export async function confirmHost({ date, type, person, area, seats, time, centerId, by }) {
  if (!area?.trim()) throw new Error('Area is required — it is what guests see instead of the address.')
  if (!(seats >= 1 && seats <= 200)) throw new Error('Seats must be between 1 and 200.')
  if (!person?.street?.trim()) throw new Error('No address on record for this host. Add the address first.')

  const label = POOJA_TYPES[type].label
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

  await recordOutreach({ date, type, personId: person.id, outcome: 'confirmed', activityId: activity.id, by })
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
