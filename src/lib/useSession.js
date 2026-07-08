import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Tracks the Supabase auth session and the signed-in user's profile row
// (role/center/name), which the app uses for identity + RLS-scoped reads.
export function useSession() {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [profile, setProfile] = useState(null)
  const [sections, setSections] = useState(null) // the role's granted section keys

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (alive) setSession(data.session ?? null)
    })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => {
      setSession(s ?? null)
    })
    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!session?.user) {
      setProfile(null)
      return
    }
    let alive = true
    supabase
      .from('profiles')
      .select('id, full_name, email, role, center_id, active')
      .eq('id', session.user.id)
      .maybeSingle()
      .then(async ({ data }) => {
        if (!alive) return
        setProfile(data || null)
        // Which sections this role grants (drives nav + mirrors RLS). Admin = all.
        if (!data) { setSections([]); return }
        const { data: rs } = await supabase
          .from('roles').select('key, role_sections(section)').eq('key', data.role).maybeSingle()
        if (alive) setSections((rs?.role_sections || []).map((r) => r.section))
      })
    return () => {
      alive = false
    }
  }, [session])

  return { session, profile, sections }
}
