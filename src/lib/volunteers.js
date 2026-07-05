import { supabase } from './supabase'

// The canonical "make this person a volunteer" operation. The Volunteers list is
// driven by the presence of a volunteer_profiles row (inner-joined to people), so a
// person only appears there once this runs — setting people.is_volunteer alone is NOT
// enough. Auto-promote (confirmed): any resolved event attendance grants volunteer
// status by ensuring BOTH the flag and the profile row.
// ignoreDuplicates: never downgrade an existing volunteer's profile/status.
export async function ensureVolunteer(personId, { source = 'event_attendance' } = {}) {
  if (!personId) return
  const flag = await supabase.from('people').update({ is_volunteer: true }).eq('id', personId)
  if (flag.error) throw flag.error
  const prof = await supabase
    .from('volunteer_profiles')
    .upsert({ person_id: personId, status: 'active', interest_source: source }, { onConflict: 'person_id', ignoreDuplicates: true })
  if (prof.error) throw prof.error
}

// Meditator membership is just the flag (hybrid model: flag OR typed attendance).
export async function ensureMeditator(personId) {
  if (!personId) return
  const { error } = await supabase.from('people').update({ is_meditator: true }).eq('id', personId)
  if (error) throw error
}

// Grant the participation that matches the attendance TYPE's kind: a meditator-kind
// attendance makes the person a meditator; a volunteer-kind attendance makes them a
// volunteer. This keeps the flag-driven screens in sync with typed attendance.
export async function ensureParticipation(personId, kind, { source = 'event_attendance' } = {}) {
  if (kind === 'meditator') return ensureMeditator(personId)
  return ensureVolunteer(personId, { source })
}
