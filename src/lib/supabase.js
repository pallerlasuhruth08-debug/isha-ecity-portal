import { createClient } from '@supabase/supabase-js'

// Isha E-City live Supabase project (ref: oreljszgkligutxdwgxw).
// The publishable key is public by design — RLS is the security boundary.
// Override locally via .env.local (VITE_SUPABASE_URL / VITE_SUPABASE_KEY).
const SUPABASE_URL =
  import.meta.env.VITE_SUPABASE_URL || 'https://oreljszgkligutxdwgxw.supabase.co'
const SUPABASE_KEY =
  import.meta.env.VITE_SUPABASE_KEY || 'sb_publishable_Z43FdWGRtaDnVkPKoUulTg_Qs2Y85NQ'

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
})
