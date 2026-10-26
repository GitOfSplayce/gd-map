import { useCallback, useEffect, useRef, useState } from 'react'
import { MAP_DATA_ERRORS, fetchMapData } from '../lib/api'
import type { MapData } from '../lib/types'

const CODE_KEY = 'gd-map:code'

// Le code est gardé pour la session du navigateur uniquement (fermer l'onglet le fait oublier)
const storage = {
  get: () => {
    try {
      return sessionStorage.getItem(CODE_KEY)
    } catch {
      return null
    }
  },
  set: (code: string) => {
    try {
      sessionStorage.setItem(CODE_KEY, code)
    } catch {
      // stockage indisponible (navigation privée stricte) : il faudra ressaisir le code
    }
  },
  clear: () => {
    try {
      sessionStorage.removeItem(CODE_KEY)
    } catch {
      // idem
    }
  },
}

export type AccessStatus = 'checking' | 'locked' | 'loading' | 'ready'

/** `signedIn` : connecté par le portail avec accès à la carte (lecteur ou admin), donc sans code. */
export function useMapAccess(session: { loading: boolean; signedIn: boolean }) {
  const [status, setStatus] = useState<AccessStatus>('checking')
  const [data, setData] = useState<MapData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const codeRef = useRef<string | null>(storage.get())

  const load = useCallback(async (code: string | null, withSession: boolean) => {
    setStatus((s) => (s === 'ready' ? 'ready' : 'loading'))
    const res = await fetchMapData(withSession ? null : code)
    if ('data' in res) {
      if (code && !withSession) {
        storage.set(code)
        codeRef.current = code
      }
      setData(res.data)
      setError(null)
      setStatus('ready')
      return true
    }
    if (res.error === 'invalid_code') {
      storage.clear()
      codeRef.current = null
    }
    setError(MAP_DATA_ERRORS[res.error])
    setStatus((s) => (s === 'ready' && res.error === 'network' ? 'ready' : 'locked'))
    return false
  }, [])

  useEffect(() => {
    if (session.loading) return
    if (session.signedIn) void load(null, true)
    else if (codeRef.current) void load(codeRef.current, false)
    else setStatus('locked')
  }, [session.loading, session.signedIn, load])

  return {
    status,
    data,
    error,
    submit: (code: string) => load(code.trim(), false),
    reload: () => load(codeRef.current, session.signedIn),
    lock: () => {
      storage.clear()
      codeRef.current = null
      setData(null)
      setError(null)
      setStatus('locked')
    },
  }
}
