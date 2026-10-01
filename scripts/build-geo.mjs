// Télécharge et simplifie les contours utilisés par la carte, puis les écrit dans public/geo/.
// Usage : npm run build:geo   (les fichiers produits sont versionnés, ce script ne sert qu'à les régénérer)
//
// Sources :
//  - Départements + DROM (vue France) : https://github.com/gregoiredavid/france-geojson (Licence Ouverte, données IGN)
//  - Île-de-France détaillée et arrondissements de Paris (vues Île-de-France et Paris) : API Découpage administratif,
//    https://geo.api.gouv.fr (Licence Ouverte, IGN Admin Express). Départements reconstitués à partir des communes et
//    simplifiés dans la même topologie que les arrondissements : les frontières communes coïncident exactement.
//  - Monaco : geoBoundaries (OpenStreetMap, ODbL)
import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { geoArea } from 'd3-geo'

const SOURCES = {
  departements:
    'https://raw.githubusercontent.com/gregoiredavid/france-geojson/master/departements-avec-outre-mer.geojson',
  communes: (dep) =>
    `https://geo.api.gouv.fr/communes?codeDepartement=${dep}&format=geojson&geometry=contour&fields=code,codeDepartement`,
  arrondissements:
    'https://geo.api.gouv.fr/communes?codeDepartement=75&type=arrondissement-municipal&format=geojson&geometry=contour&fields=code',
  monaco:
    'https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/MCO/ADM0/geoBoundaries-MCO-ADM0.geojson',
}

const OUT_DIR = new URL('../public/geo/', import.meta.url).pathname
const tmp = mkdtempSync(join(tmpdir(), 'gd-map-geo-'))
mkdirSync(join(tmp, 'idf-out'))

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

// Île-de-France et départements voisins, plus les arrondissements de Paris, pour les vues Île-de-France et Paris.
// Tout vient de la même source et passe par une seule simplification topologique : aucun jour entre les zones.
// Précision décroissante en s'éloignant de Paris (tolérance en mètres).
const IDF_DETAIL = {
  petiteCouronne: ['92', '93', '94'],
  grandeCouronne: ['77', '78', '91', '95'],
  voisins: ['60', '02', '51', '10', '89', '45', '28', '27'],
}
const communes = []
for (const dep of Object.values(IDF_DETAIL).flat()) {
  const fc = JSON.parse(readFileSync(await download(`communes-${dep}`, SOURCES.communes(dep)), 'utf8'))
  for (const f of fc.features) communes.push({ type: 'Feature', properties: { dep }, geometry: f.geometry })
}
const arrondissements = JSON.parse(readFileSync(await download('arrondissements', SOURCES.arrondissements), 'utf8'))
writeFeatures(join(tmp, 'idf-all.geojson'), [
  ...arrondissements.features.map((f) => ({
    type: 'Feature',
    properties: { dep: '75', code: `75-${Number(f.properties.code) - 75100}` },
    geometry: f.geometry,
  })),
  ...communes,
])
const tolerance = `["75","92","93","94"].includes(dep) ? 6 : ${JSON.stringify(IDF_DETAIL.grandeCouronne)}.includes(dep) ? 60 : 300`
execFileSync(
  'npx',
  [
    'mapshaper', '-i', join(tmp, 'idf-all.geojson'), 'name=idf',
    '-simplify', 'variable', `interval=${tolerance}`, 'keep-shapes',
    '-filter', 'dep == "75"', '+', 'name=arr', 'target=idf',
    '-filter', 'dep != "75"', 'target=idf',
    '-dissolve', 'dep', 'target=idf',
    '-each', 'code = dep, nom = code', 'target=idf',
    '-each', 'nom = "Paris " + code.slice(3)', 'target=arr',
    '-o', join(tmp, 'idf-out') + '/', 'format=geojson', 'precision=0.00001', 'target=idf,arr',
  ],
  { stdio: 'inherit' },
)
const sortArr = (file) => {
  const fc = JSON.parse(readFileSync(file, 'utf8'))
  fc.features.sort((a, b) => Number(a.properties.code.slice(3)) - Number(b.properties.code.slice(3)))
  writeFileSync(file, JSON.stringify(fc))
  return file
}
finalize(join(tmp, 'idf-out', 'idf.json'), join(OUT_DIR, 'idf-departements.geojson'))
finalize(sortArr(join(tmp, 'idf-out', 'arr.json')), join(OUT_DIR, 'paris-arrondissements.geojson'))

const monaco = JSON.parse(readFileSync(await download('monaco', SOURCES.monaco), 'utf8'))
writeFeatures(
  join(tmp, 'monaco-clean.geojson'),
  monaco.features.map((f) => ({ type: 'Feature', properties: { code: '98', nom: 'Monaco' }, geometry: f.geometry })),
)
mapshaper(join(tmp, 'monaco-clean.geojson'), join(tmp, 'monaco-simple.geojson'), '30%')
finalize(join(tmp, 'monaco-simple.geojson'), join(OUT_DIR, 'monaco.geojson'))

rmSync(tmp, { recursive: true, force: true })
