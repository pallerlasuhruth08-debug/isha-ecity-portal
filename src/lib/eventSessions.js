import { eventDays, dayBefore, fmtDay } from './planning.js'

// The two attendance sessions every event needs, created with the event.
//
// WHY
// 55 attendance sessions exist across 34 events, and the two most-used volunteer
// types are `hall setup` (13) and `class support` (13) — hand-made one event at a
// time, in a form that asks for a kind, a type, a date and a title before it will
// save. That is four decisions repeated for something that is the same every time.
//
// The dates come from what the centre already does, not from an invention:
//   hall setup     → Shambhavi meetup 26 Jul → session 25 Jul
//                    Shakti chalana review 1 Aug → 31 Jul
//                    IE - 2 day (Mar 2026) starting 28 Mar → 27 Mar
//                    Every hall session on record is the DAY BEFORE the event.
//                    The app already calls that Day 0 (`eventDaysWithSetup`).
//   class support  → on the event day. One per day, so a 3-day programme gets
//                    three, which is the part nobody wanted to do by hand.
//
// WHAT IT DELIBERATELY DOES NOT DO
// It never creates an activity_type. If `hall setup` or `class support` is missing
// or archived, that session is REPORTED as skipped rather than silently invented —
// activity_types is a shared taxonomy behind every filter, report and smart list,
// and a typo'd duplicate there is far more expensive than a missing session.

export const AUTO_SESSIONS = [
  { label: 'hall setup', on: 'setup' },
  { label: 'class support', on: 'each_day' },
]

/** Titles match what the session form already generates: "class support — 2 Aug". */
export const sessionTitle = (label, dateISO) => `${String(label).trim()} — ${fmtDay(dateISO)}`

/**
 * @param ev     { id, start_date, activity_date, end_date, center_id }
 * @param types  activity_types rows [{ id, label, kind, active }]
 * @returns { rows, skipped } — rows are ready to insert into attendance_sessions
 */
export function planSessions(ev, types = [], createdBy = null) {
  const start = ev?.start_date || ev?.activity_date
  if (!ev?.id || !start) return { rows: [], skipped: [] }
  const days = eventDays(start, ev.end_date || start)
  // Match on lowercased label so "Hall Setup" and "hall setup" are the same type.
  const find = (label) =>
    types.find((t) => (t.label || '').trim().toLowerCase() === label && t.active !== false && (t.kind || 'volunteer') === 'volunteer')

  const rows = []
  const skipped = []
  for (const spec of AUTO_SESSIONS) {
    const type = find(spec.label)
    if (!type) { skipped.push(spec.label); continue }
    const dates = spec.on === 'setup' ? [dayBefore(start)] : days
    for (const d of dates) {
      rows.push({
        activity_id: ev.id,
        title: sessionTitle(type.label, d),
        type: 'volunteer',
        session_date: d,
        center_id: ev.center_id || null,
        activity_type_id: type.id,
        created_by: createdBy || null,
      })
    }
  }
  return { rows, skipped }
}

/** "3 attendance sessions ready" / "…· hall setup skipped (no such activity type)" */
export function describePlan({ rows, skipped }) {
  const n = rows.length
  const made = `${n} attendance session${n === 1 ? '' : 's'} ready`
  if (!skipped.length) return made
  return `${made} · ${skipped.join(' and ')} skipped — no active volunteer activity type with that name`
}

// ── the write side ──────────────────────────────────────────────────────────
// Kept here rather than at each call site so the one-off form, the series
// materializer and the rolling-window job all create the same two sessions.
// Never throws: an event that exists without its sessions is a nuisance, an
// event-creation button that fails after the event is already saved is worse.
export async function createSessionsFor(ev, createdBy = null) {
  // Imported lazily on purpose: lib/supabase.js reads `import.meta.env`, which does
  // not exist under plain node, and scripts/sessions.test.mjs imports this file.
  // Keeping the client out of the static graph is what lets the planner be tested.
  const { supabase } = await import('./supabase')
  try {
    const { data: types } = await supabase.from('activity_types').select('id, label, kind, active')
    const plan = planSessions(ev, types || [], createdBy)
    if (!plan.rows.length) return plan
    const { error } = await supabase.from('attendance_sessions').insert(plan.rows)
    if (error) return { rows: [], skipped: plan.skipped, error: error.message }
    return plan
  } catch (e) {
    return { rows: [], skipped: [], error: e.message || String(e) }
  }
}
