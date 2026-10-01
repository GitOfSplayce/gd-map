import type { Session } from '@supabase/supabase-js'
import { useEffect, useState } from 'react'
import { checkIsAdmin } from '../lib/api'
import { isDemo, requireSupabase } from '../lib/supabase'

export interface AdminSession {
  loading: boolean
  session: Session | null
  isAdmin: boolean
}

export function useAdminSession(): AdminSession {
  // En mode démo, on est admin d'office (données en mémoire, voir lib/demo.ts)
  const [state, setState] = useState<AdminSession>(
    isDemo ? { loading: false, session: { user: { email: 'demo@exemple.fr' } } as Session, isAdmin: true } : { loading: true, session: null, isAdmin: false },
  )

  useEffect(() => {
    if (isDemo) return
    let cancelled = false
    const sb = requireSupabase()
    const update = async (session: Session | null) => {
      const isAdmin = session ? await checkIsAdmin() : false
      if (!cancelled) setState({ loading: false, session, isAdmin })
    }
    const { data } = sb.auth.onAuthStateChange((event, session) => {
      // Pas d'appel Supabase directement dans le callback (risque de blocage) : on diffère
      if (event === 'INITIAL_SESSION' || event === 'SIGNED_IN' || event === 'SIGNED_OUT' || event === 'USER_UPDATED') {
        setTimeout(() => void update(session), 0)
      }
    })
    return () => {
      cancelled = true
      data.subscription.unsubscribe()
    }
  }, [])

  return state
}
