import { supabase } from './supabase'
import { checkMobile } from './phone'

// Coordinator write path for pooja hosting. The guest side never comes near this
// file — it uses the four public RPCs (see views/PublicPoojas.jsx). Everything
// here is straight table access, so the caller must be logged in and satisfy
// can_all(); RLS rejects everyone else and the anon key entirely.
//
// NEVER let `address` or `host_phone` reach an unauthenticated caller. They are
// released to a guest by pooja_my_request(token) alone, and only once that
// request is approved. See POOJA_INTEGRATION.md.

const LISTING_COLS = 'activity_id, starts_at, seats, area, landmark, bring_note, address, host_phone, host_person_id, status, center_id, pincode, created_at'

// The IST calendar date of a moment — NOT `toISOString().slice(0,10)`, which is
// the UTC date. India is +05:30, so a 4:30am pooja on the 6th is 23:00 UTC on
// the 5th, and the naive version files it under the wrong day. Early-morning
// poojas are the common case, so this matters more here than anywhere else in
// the app.
const IST_DATE = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' })
export const istDate = (ts) => IST_DATE.format(new Date(ts))

// A local `YYYY-MM-DD` + `HH:MM` from date/time inputs -> an IST-offset ISO
// string. Written explicitly rather than `new Date(d + 'T' + t)` because that
// parses in the BROWSER's zone, and a coordinator travelling would silently
// post the pooja at the wrong hour.
export const istIso = (dateStr, timeStr) => `${dateStr}T${(timeStr || '00:00').slice(0, 5)}:00+05:30`

/**
 * Create a pooja: one `activities` row (the event, which attendance already
 * knows how to use) plus one `pooja_listings` row (the hosting metadata).
 * Both or neither.
 */
export async function createPooja({ title, centerId, startsAt, seats, area, landmark, bringNote, address, hostPhone, hostPersonId, pincode, createdBy }) {
  if (!title?.trim()) throw new Error('The pooja needs a name.')
  if (!centerId) throw new Error('Pick a centre.')
  if (!area?.trim()) throw new Error('Area is required — it is what guests see instead of the address.')
  if (!startsAt) throw new Error('Pick a date and time.')
  if (!(seats >= 1 && seats <= 200)) throw new Error('Seats must be between 1 and 200.')

  // One phone definition for the whole app (lib/phone.js). A bare .slice(-10)
  // would accept a five-digit typo as a valid number.
  let phone = null
  if (hostPhone) {
    const p = checkMobile(hostPhone)
    if (!p.ok) throw new Error(`Host's number: ${p.reason}`)
    phone = p.digits
  }

  const day = istDate(startsAt)
  const { data: activity, error: aErr } = await supabase.from('activities').insert({
    name: title.trim(),
    center_id: centerId,
    activity_date: day,
    start_date: day,
    end_date: day,
    activity_type: 'pooja',
    description: bringNote?.trim() || null,
    is_open: true,
    created_by: createdBy || null,
  }).select('id').single()
  if (aErr) throw aErr

  const { data: listing, error: lErr } = await supabase.from('pooja_listings').insert({
    activity_id: activity.id,
    starts_at: startsAt,
    seats,
    area: area.trim(),
    landmark: landmark?.trim() || null,
    bring_note: bringNote?.trim() || null,
    address: address?.trim() || null,
    pincode: pincode?.trim() || null,
    host_phone: phone,
    host_person_id: hostPersonId || null,
    center_id: centerId,
    created_by: createdBy || null,
    status: 'open',
  }).select(LISTING_COLS).single()

  if (lErr) {
    // Don't leave an orphan activity behind. If this cleanup itself fails the
    // listing error is still what surfaces — an empty activity is recoverable,
    // a silent success is not.
    await supabase.from('activities').delete().eq('id', activity.id)
    throw lErr
  }
  return { ...listing, title: title.trim(), seats_left: seats }
}

/**
 * Every pooja for the coordinator screen, with seats remaining.
 *
 * seats_left is computed in ONE query rather than calling pooja_seats_left once
 * per listing. That RPC remains the canonical definition (and the only one the
 * seat-granting path uses); this is the same arithmetic — seats minus approved
 * party sizes — done in bulk for a read-only screen.
 */
export async function listPoojas({ includePast = false } = {}) {
  let q = supabase.from('pooja_listings')
    .select(`${LISTING_COLS}, activity:activities!pooja_listings_activity_id_fkey(name)`)
    .order('starts_at', { ascending: true })
  if (!includePast) q = q.gte('starts_at', new Date().toISOString())
  const { data, error } = await q
  if (error) throw error
  const rows = data || []
  if (!rows.length) return []

  const ids = rows.map((r) => r.activity_id)
  const { data: reqs, error: rErr } = await supabase.from('pooja_requests')
    .select('activity_id, party_size, status').in('activity_id', ids)
  if (rErr) throw rErr

  const taken = {}, pending = {}
  for (const r of reqs || []) {
    if (r.status === 'approved') taken[r.activity_id] = (taken[r.activity_id] || 0) + r.party_size
    if (r.status === 'requested') pending[r.activity_id] = (pending[r.activity_id] || 0) + 1
  }
  return rows.map((r) => ({
    ...r,
    title: r.activity?.name || '(untitled)',
    seats_left: Math.max(0, r.seats - (taken[r.activity_id] || 0)),
    approved_headcount: taken[r.activity_id] || 0,
    pending_count: pending[r.activity_id] || 0,
  }))
}

/** Requests for one pooja. Coordinators see name and phone — that IS the decision. */
export async function listRequests(activityId, { status = null } = {}) {
  let q = supabase.from('pooja_requests')
    .select('id, name, phone, party_size, status, created_at, decided_at, person_id')
    .eq('activity_id', activityId)
    .order('created_at', { ascending: true })
  if (status) q = q.eq('status', status)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

async function decide(requestId, status, decidedBy) {
  const { data, error } = await supabase.from('pooja_requests')
    .update({ status, decided_at: new Date().toISOString(), decided_by: decidedBy || null })
    .eq('id', requestId)
    .select('id, status, party_size, activity_id')
    .single()
  if (error) throw error
  return data
}

/**
 * Approve a request. This is what releases the address and the host's number to
 * that guest. It is the trust decision in this whole feature, not a formality —
 * the host is letting a stranger into their home.
 */
export const approveRequest = (requestId, decidedBy) => decide(requestId, 'approved', decidedBy)
export const declineRequest = (requestId, decidedBy) => decide(requestId, 'declined', decidedBy)

/**
 * Change the seat count. Raising is always fine. Lowering below the approved
 * headcount is refused on purpose: a human should decline specific guests rather
 * than have the system silently pick who loses a seat.
 */
export async function setSeats(activityId, seats) {
  if (!(seats >= 1 && seats <= 200)) throw new Error('Seats must be between 1 and 200.')
  const approved = await listRequests(activityId, { status: 'approved' })
  const taken = approved.reduce((n, r) => n + r.party_size, 0)
  if (seats < taken) throw new Error(`${taken} seat${taken === 1 ? ' is' : 's are'} already approved. Decline specific guests before lowering to ${seats}.`)
  return setListing(activityId, { seats })
}

async function setListing(activityId, patch) {
  const { data, error } = await supabase.from('pooja_listings')
    .update(patch).eq('activity_id', activityId).select(LISTING_COLS).single()
  if (error) throw error
  return data
}

/** Stop taking requests but keep the pooja on. */
export const closePooja = (activityId) => setListing(activityId, { status: 'closed' })
export const reopenPooja = (activityId) => setListing(activityId, { status: 'open' })
/**
 * Cancel the pooja. Approved guests will still turn up unless someone tells
 * them — the status change is a record, not a notification. Ring them.
 */
export const cancelPooja = (activityId) => setListing(activityId, { status: 'cancelled' })

/**
 * Who to expect. Day-of attendance goes through the EXISTING system — create an
 * attendance session against this activity_id and use the current check-in flow.
 * Do not build a second attendance path.
 */
export async function expectedGuests(activityId) {
  const approved = await listRequests(activityId, { status: 'approved' })
  return {
    parties: approved.length,
    headcount: approved.reduce((n, r) => n + r.party_size, 0),
    guests: approved,
  }
}
