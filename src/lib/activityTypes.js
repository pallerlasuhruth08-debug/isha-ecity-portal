import { supabase } from './supabase'

// The ONE shared, editable vocabulary for event types AND volunteer activities.
// Dropdowns/filters populate from this — never a hardcoded enum/literal.
export async function fetchActivityTypes({ activeOnly = true } = {}) {
  let q = supabase.from('activity_types').select('id, label, active, sort_order').order('sort_order', { ascending: true })
  if (activeOnly) q = q.eq('active', true)
  const { data, error } = await q
  if (error) throw error
  return data || []
}
