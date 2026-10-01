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

export function useMapAccess(admin: { loading: boolean; isAdmin: boolean }) {
  const [status, setStatus] = useState<AccessStatus>('checking')
  const [data, setData] = useState<MapData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const codeRef = useRef<string | null>(storage.get())

  const load = useCallback(async (code: string | null, asAdmin: boolean) => {
    setStatus((s) => (s === 'ready' ? 'ready' : 'loading'))
    const res = await fetchMapData(asAdmin ? null : code)
    if ('data' in res) {
      if (code && !asAdmin) {
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
    if (admin.loading) return
    if (admin.isAdmin) void load(null, true)
    else if (codeRef.current) void load(codeRef.current, false)
    else setStatus('locked')
  }, [admin.loading, admin.isAdmin, load])

  return {
    status,
    data,
    error,
    submit: (code: string) => load(code.trim(), false),
    reload: () => load(codeRef.current, admin.isAdmin),
    lock: () => {
      storage.clear()
      codeRef.current = null
      setData(null)
      setError(null)
      setStatus('locked')
    },
  }
}
