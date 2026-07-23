import { supabase } from './supabase'

// The shared, editable vocabulary of volunteer skills. Pickers populate from
// this; "add a new skill" inserts here. Seeded with a starter set — never a
// hardcoded enum.
export async function fetchSkills({ activeOnly = true } = {}) {
  let q = supabase.from('skills').select('id, label, active, sort_order')
    .order('sort_order', { ascending: true }).order('label', { ascending: true })
  if (activeOnly) q = q.eq('active', true)
  const { data, error } = await q
  if (error) throw error
  return data || []
}

// Find an existing skill by case-insensitive label (so "Transport" and
// "transport" never split), or create it. Returns the skill row {id, label}.
export async function ensureSkill(label) {
  const clean = (label || '').trim()
  if (!clean) throw new Error('Empty skill')
  const { data: found } = await supabase.from('skills').select('id, label').ilike('label', clean).limit(1)
  if (found && found.length) return found[0]
  const { data, error } = await supabase.from('skills').insert({ label: clean }).select('id, label').single()
  if (error) {
    // lost a race to a concurrent insert — read the winner back
    const { data: again } = await supabase.from('skills').select('id, label').ilike('label', clean).limit(1)
    if (again && again.length) return again[0]
    throw error
  }
  return data
}
