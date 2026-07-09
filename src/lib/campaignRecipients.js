import { supabase } from './supabase'

// Append people to an existing campaign as active journeys, deduped against anyone
// already in it (active or removed — a removed person is restored by un-dropping from
// the call list, not re-added here). Split campaigns auto-assign split_number via the
// assign_split_on_journey trigger; callers are left unassigned for the coordinator to
// place from the call list. Returns { added, skipped }.
export async function addRecipientsToCampaign(campaignId, personIds) {
  const ids = [...new Set((personIds || []).filter(Boolean))]
  if (!ids.length) return { added: 0, skipped: 0 }

  const [{ data: camp }, { data: existing, error: exErr }] = await Promise.all([
    supabase.from('campaigns').select('center_id').eq('id', campaignId).single(),
    supabase.from('journeys').select('person_id').eq('campaign_id', campaignId),
  ])
  if (exErr) throw exErr

  const have = new Set((existing || []).map((r) => r.person_id))
  const fresh = ids.filter((id) => !have.has(id))
  if (!fresh.length) return { added: 0, skipped: ids.length }

  const rows = fresh.map((id) => ({
    person_id: id,
    campaign_id: campaignId,
    type: 'campaign',
    status: 'active',
    center_id: camp?.center_id || 'unassigned',
  }))
  const { error } = await supabase.from('journeys').insert(rows)
  if (error) throw error
  return { added: fresh.length, skipped: ids.length - fresh.length }
}
