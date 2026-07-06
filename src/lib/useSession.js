import { useEffect, useState } from 'react'
import { supabase } from './supabase'

// Tracks the Supabase auth session and the signed-in user's profile row
// (role/center/name), which the app uses for identity + RLS-scoped reads.
export function useSession() {
  const [session, setSession] = useState(undefined) // undefined = still loading
  const [profile, setProfile] = useState(null)

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
      .then(({ data }) => {
        if (alive) setProfile(data || null)
      })
    return () => {
      alive = false
    }
  }, [session])

  return { session, profile }
}
