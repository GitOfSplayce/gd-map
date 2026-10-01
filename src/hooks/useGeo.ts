import type { FeatureCollection, MultiPolygon, Polygon } from 'geojson'
import { useEffect, useState } from 'react'

export type ZoneFeatureCollection = FeatureCollection<Polygon | MultiPolygon, { code: string; nom: string }>

export interface GeoData {
  departements: ZoneFeatureCollection
  /** Contours plus fins pour l'Île-de-France et ses voisins (vues Île-de-France et Paris). */
  idf: ZoneFeatureCollection
  paris: ZoneFeatureCollection
  monaco: ZoneFeatureCollection
}

let pending: Promise<GeoData> | null = null

async function getJson(file: string): Promise<ZoneFeatureCollection> {
  const res = await fetch(`${import.meta.env.BASE_URL}geo/${file}`)
  if (!res.ok) throw new Error(`${file} : HTTP ${res.status}`)
  return res.json()
}

/** Charge les contours une seule fois (appelé dès l'écran du code pour gagner du temps). */
export function loadGeo(): Promise<GeoData> {
  pending ??= Promise.all([
    getJson('departements.geojson'),
    getJson('idf-departements.geojson'),
    getJson('paris-arrondissements.geojson'),
    getJson('monaco.geojson'),
  ])
    .then(([departements, idf, paris, monaco]) => ({ departements, idf, paris, monaco }))
    .catch((e) => {
      pending = null
      throw e
    })
  return pending
}

export function useGeo() {
  const [geo, setGeo] = useState<GeoData | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    loadGeo()
      .then(setGeo)
      .catch(() => setError('Impossible de charger les contours de la carte.'))
  }, [])
  return { geo, error }
}
