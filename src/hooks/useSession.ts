import { useCallback, useEffect, useState } from 'react'
import { fetchMe, type Me } from '../lib/session'

export interface SessionState {
  loading: boolean
  me: Me
  refresh: () => Promise<void>
}

/** La personne connectée par le portail (ou personne), relue à l'ouverture de la page. */
export function useSession(): SessionState {
  const [state, setState] = useState<{ loading: boolean; me: Me }>({ loading: true, me: { user: null, role: null, portalUrl: null } })

  const refresh = useCallback(async () => {
    const me = await fetchMe()
    setState({ loading: false, me })
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  return { ...state, refresh }
}
