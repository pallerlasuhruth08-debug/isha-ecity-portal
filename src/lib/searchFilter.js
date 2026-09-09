// Build a well-formed PostgREST .or() for a multi-field ILIKE search.
//
// PostgREST uses ',' as the .or() separator and '()' for grouping, and %/_ are
// LIKE wildcards — so an UNescaped user term containing those characters produces
// a malformed filter that PostgREST rejects, and the error (which echoes the
// filter fragment) leaks to the UI. We strip the syntax-breaking characters and
// keep the rest, then build one clean ilike clause per field.
const BREAKERS = /[,()"'\\*%_]/g

export function sanitizeSearch(term) {
  return (term || '').replace(BREAKERS, ' ').replace(/\s+/g, ' ').trim()
}

// Returns a ready-to-pass .or() string, or null when the term is empty.
export function multiFieldOr(term, fields) {
  const t = sanitizeSearch(term)
  if (!t) return null
  return fields.map((f) => `${f}.ilike.%${t}%`).join(',')
}

// Canonical people-record search fields, phone-keyed like everywhere else.
// street/city/area are the address: `street` is filled for 91% of records and
// `area` for only 4%, so searching all three is what makes an address term
// actually find someone. volunteer_list carries the same four columns, so this
// one list serves the Volunteers and Meditators screens alike.
export const PEOPLE_SEARCH_FIELDS = [
  'full_name', 'phone', 'email', 'pincode', 'street', 'city', 'area',
]
