// Télécharge et simplifie les contours utilisés par la carte, puis les écrit dans public/geo/.
// Usage : npm run build:geo   (les fichiers produits sont versionnés, ce script ne sert qu'à les régénérer)
//
// Sources :
//  - Départements + DROM : https://github.com/gregoiredavid/france-geojson (Licence Ouverte, données IGN)
//  - Arrondissements de Paris : https://opendata.paris.fr/explore/dataset/arrondissements (ODbL)
//  - Monaco : geoBoundaries (OpenStreetMap, ODbL)
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { geoArea } from 'd3-geo'

const SOURCES = {
  departements:
    'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements-avec-outre-mer.geojson',
  paris: 'https://opendata.paris.fr/api/explore/v2.1/catalog/datasets/arrondissements/exports/geojson',
  monaco:
    'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/MCO/ADM0/geoBoundaries-MCO-ADM0.geojson',
}

const OUT_DIR = new URL('../public/geo/', import.meta.url).pathname
const tmp = mkdtempSync(join(tmpdir(), 'gd-map-geo-'))

async function download(name, url) {
  const res = await fetch(url, { headers: { 'User-Agent': 'gd-map-build' } })
  if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`)
  const path = join(tmp, `${name}.geojson`)
  writeFileSync(path, await res.text())
  return path
}

function writeFeatures(path, features) {
  writeFileSync(path, JSON.stringify({ type: 'FeatureCollection', features }))
}

function mapshaper(input, output, simplify) {
  execFileSync(
    'npx',
    ['mapshaper', input, '-simplify', simplify, 'weighted', 'keep-shapes', '-o', 'format=geojson', 'precision=0.00001', output],
    { stdio: 'inherit' },
  )
}

// d3-geo attend des anneaux extérieurs dans le sens horaire : on inverse ceux qui couvrent "tout le globe sauf la zone".
function rewind(feature) {
  if (geoArea(feature) <= 2 * Math.PI) return feature
  const g = feature.geometry
  const rev = (polygon) => polygon.map((ring) => [...ring].reverse())
  const coordinates = g.type === 'Polygon' ? rev(g.coordinates) : g.coordinates.map(rev)
  return { ...feature, geometry: { ...g, coordinates } }
}

function finalize(input, output) {
  const fc = JSON.parse(readFileSync(input, 'utf8'))
  fc.features = fc.features.map(rewind)
  writeFileSync(output, JSON.stringify(fc))
  console.log(`${output} : ${fc.features.length} zones, ${(JSON.stringify(fc).length / 1024).toFixed(0)} Ko`)
}

mkdirSync(OUT_DIR, { recursive: true })

const deps = JSON.parse(readFileSync(await download('departements', SOURCES.departements), 'utf8'))
writeFeatures(
  join(tmp, 'deps-clean.geojson'),
  deps.features.map((f) => ({ type: 'Feature', properties: { code: f.properties.code, nom: f.properties.nom }, geometry: f.geometry })),
)
mapshaper(join(tmp, 'deps-clean.geojson'), join(tmp, 'deps-simple.geojson'), '7%')
finalize(join(tmp, 'deps-simple.geojson'), join(OUT_DIR, 'departements.geojson'))

// Version détaillée de l'Île-de-France et de ses voisins, pour les vues Île-de-France et Paris
// (sinon les contours simplifiés laissent des jours avec les arrondissements de Paris)
const IDF_DETAIL = ['75', '77', '78', '91', '92', '93', '94', '95', '60', '02', '51', '10', '89', '45', '28', '27']
writeFeatures(
  join(tmp, 'idf-clean.geojson'),
  deps.features
    .filter((f) => IDF_DETAIL.includes(f.properties.code))
    .map((f) => ({ type: 'Feature', properties: { code: f.properties.code, nom: f.properties.nom }, geometry: f.geometry })),
)
// La petite couronne reste non simplifiée : elle borde directement les arrondissements (Saint-Mandé, bois…)
const PETITE_COURONNE = ['75', '92', '93', '94']
mapshaper(join(tmp, 'idf-clean.geojson'), join(tmp, 'idf-simple.geojson'), '40%')
const idfSimple = JSON.parse(readFileSync(join(tmp, 'idf-simple.geojson'), 'utf8'))
const idfClean = JSON.parse(readFileSync(join(tmp, 'idf-clean.geojson'), 'utf8'))
const round = (c) => (typeof c[0] === 'number' ? c.map((v) => Math.round(v * 1e5) / 1e5) : c.map(round))
writeFeatures(
  join(tmp, 'idf-mixed.geojson'),
  idfSimple.features.map((f) => {
    if (!PETITE_COURONNE.includes(f.properties.code)) return f
    const full = idfClean.features.find((g) => g.properties.code === f.properties.code)
    return { ...full, geometry: { ...full.geometry, coordinates: round(full.geometry.coordinates) } }
  }),
)
finalize(join(tmp, 'idf-mixed.geojson'), join(OUT_DIR, 'idf-departements.geojson'))

const paris = JSON.parse(readFileSync(await download('paris', SOURCES.paris), 'utf8'))
writeFeatures(
  join(tmp, 'paris-clean.geojson'),
  paris.features
    .map((f) => ({
      type: 'Feature',
      properties: { code: `75-${f.properties.c_ar}`, nom: `Paris ${f.properties.l_ar.replace(' Ardt', '').replace('ème', 'e')} – ${f.properties.l_aroff}` },
      geometry: f.geometry,
    }))
    .sort((a, b) => Number(a.properties.code.slice(3)) - Number(b.properties.code.slice(3))),
)
mapshaper(join(tmp, 'paris-clean.geojson'), join(tmp, 'paris-simple.geojson'), '25%')
finalize(join(tmp, 'paris-simple.geojson'), join(OUT_DIR, 'paris-arrondissements.geojson'))

const monaco = JSON.parse(readFileSync(await download('monaco', SOURCES.monaco), 'utf8'))
writeFeatures(
  join(tmp, 'monaco-clean.geojson'),
  monaco.features.map((f) => ({ type: 'Feature', properties: { code: '98', nom: 'Monaco' }, geometry: f.geometry })),
)
mapshaper(join(tmp, 'monaco-clean.geojson'), join(tmp, 'monaco-simple.geojson'), '30%')
finalize(join(tmp, 'monaco-simple.geojson'), join(OUT_DIR, 'monaco.geojson'))

rmSync(tmp, { recursive: true, force: true })
