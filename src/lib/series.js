import { supabase } from './supabase'
import { seriesDatesUpTo, addDaysISO, todayISO } from './planning'

export const SERIES_WINDOW_DAYS = 28 // rolling ~4-week materialization window

// Materialize missing occurrences of every active series into REAL activities rows,
// but only within [today .. today+window]. Idempotent (dedupes on series_id+date).
// Returns the number of rows created. RLS gates the insert to coordinators; a
// non-coordinator's failed insert is swallowed (returns 0).
export async function ensureSeriesWindow(windowDays = SERIES_WINDOW_DAYS) {
  const today = todayISO()
  const horizon = addDaysISO(today, windowDays)
  const { data: series, error } = await supabase.from('event_series').select('*')
  if (error || !series?.length) return 0
  const active = series.filter((s) => !s.end_date || s.end_date >= today)
  if (!active.length) return 0

  const ids = active.map((s) => s.id)
  const { data: existing } = await supabase.from('activities').select('series_id, activity_date').in('series_id', ids)
  const have = new Set((existing || []).map((r) => `${r.series_id}|${r.activity_date}`))

  const rows = []
  for (const s of active) {
    for (const d of seriesDatesUpTo(s, horizon)) {
      if (d < today) continue // don't back-fill past occurrences
      if (have.has(`${s.id}|${d}`)) continue
      rows.push({
        name: s.name, center_id: s.center_id, activity_type_id: s.activity_type_id,
        description: s.description, activity_date: d, start_date: d,
        end_date: addDaysISO(d, s.span_days || 0), is_open: true, created_by: s.created_by, series_id: s.id,
      })
    }
  }
  if (!rows.length) return 0
  const { error: insErr } = await supabase.from('activities').insert(rows)
  return insErr ? 0 : rows.length
}

// Materialize ONE specific projected occurrence (coordinator opened it to plan).
// Returns the new activity id, or null.
export async function materializeOccurrence(series, dateISO) {
  const { data: exists } = await supabase.from('activities').select('id').eq('series_id', series.id).eq('activity_date', dateISO).maybeSingle()
  if (exists) return exists.id
  const { data, error } = await supabase.from('activities').insert({
    name: series.name, center_id: series.center_id, activity_type_id: series.activity_type_id,
    description: series.description, activity_date: dateISO, start_date: dateISO,
    end_date: addDaysISO(dateISO, series.span_days || 0), is_open: true, created_by: series.created_by, series_id: series.id,
  }).select('id').single()
  return error ? null : data.id
}
