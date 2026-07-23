import { supabase } from './supabase'

// Single source of truth for programme filters. Each maps to a date column on
// people (and volunteer_list). Shown DYNAMICALLY via programsWithData() — a
// programme only appears once someone actually has that date, so programmes with
// no data yet (e.g. newly-added ones awaiting an Ishangam sync) never clutter the
// filter or read as "does nothing".
export const PROGRAMS = [
  { key: 'ie', label: 'Inner Engineering', col: 'ie_date', chip: 'IE' },
  { key: 'bsp', label: 'Bhava Spandana', col: 'bsp_date', chip: 'BSP' },
  { key: 'shoonya', label: 'Shoonya', col: 'shoonya_date', chip: 'Shoonya' },
  { key: 'samyama', label: 'Samyama', col: 'samyama_date', chip: 'Samyama' },
  { key: 'yogasanas', label: 'Yogasanas', col: 'yogasanas_date', chip: 'Yogasanas' },
  { key: 'surya_kriya', label: 'Surya Kriya', col: 'surya_kriya_date', chip: 'Surya Kriya' },
  { key: 'guru_pooja', label: 'Guru Pooja', col: 'guru_puja_date', chip: 'Guru Pooja' },
  { key: 'eoe', label: 'EOE', col: 'eoe_date', chip: 'EOE' },
  { key: 'angamardhana', label: 'Angamardhana', col: 'angamardhana_date', chip: 'Angamardhana' },
  { key: 'lom', label: 'LOM', col: 'lom_date', chip: 'LOM' },
  { key: 'bhutha_shuddhi', label: 'Bhutha Shuddhi', col: 'bhutha_shuddhi_date', chip: 'Bhutha Shuddhi' },
]

export const PROGRAM_BY_KEY = Object.fromEntries(PROGRAMS.map((p) => [p.key, p]))

// Returns the set of programme keys that currently have at least one person.
export async function programsWithData() {
  const { data } = await supabase.rpc('programs_with_data')
  return new Set(data || ['ie', 'bsp', 'shoonya', 'samyama'])
}
