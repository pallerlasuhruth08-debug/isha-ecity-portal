// "Who has NO nurturer" is an anti-join, and PostgREST cannot express one. Both
// people screens fake it by loading every covered person's id and excluding them
// with `.not('id', 'in', (...))` — which puts every id in the URL.
//
// That worked while coverage was 1 person. It stops working at a few hundred:
// PostgREST/Cloudflare reject the oversized URL, the query errors, and the list
// renders EMPTY — which on this particular filter reads as "nobody needs a
// nurturer". The better the centre gets at assigning, the sooner it would start
// lying in the most dangerous possible direction.
//
// So the filter refuses past a safe size instead, and says exactly what to do.
// The real fix is one line of SQL — a `people_without_nurturer` view — but a
// wrong answer must not be the failure mode in the meantime.
export const MAX_EXCLUDE_IDS = 300

export const excludeTooLarge = (ids) => Array.isArray(ids) && ids.length > MAX_EXCLUDE_IDS

export const EXCLUDE_TOO_LARGE_MESSAGE =
  `More than ${MAX_EXCLUDE_IDS} people now have a nurturer — good news, but too many to filter out from the browser. ` +
  'This filter needs a `people_without_nurturer` view in the database before it can be trusted again; until then it is switched off rather than showing a list that is quietly wrong.'

// "Never contacted by us" is the same anti-join with the same failure mode, and
// the same direction of danger: an empty list would read as "we have reached
// everybody". Today 183 volunteers have an attendance or a call, so it fits —
// but it grows every time attendance is captured, which is the point.
export const CONTACT_EXCLUDE_TOO_LARGE_MESSAGE =
  `We have now met or called more than ${MAX_EXCLUDE_IDS} people — too many to filter out from the browser. ` +
  'This filter needs a `people_never_contacted` view in the database before it can be trusted again; until then it is switched off rather than showing a list that is quietly wrong.'
