// Référentiel des zones : départements (métropole + Corse), DROM, arrondissements de Paris et Monaco.
// La migration supabase/migrations/*_zones.sql est générée à partir de ce fichier (npm run gen:zones-sql).

export type ZoneType = 'departement' | 'arrondissement' | 'drom' | 'monaco'

export interface ZoneInfo {
  code: string
  nom: string
  type: ZoneType
  region: string
}

const REGIONS: Record<string, string[]> = {
  'Auvergne-Rhône-Alpes': ['01', '03', '07', '15', '26', '38', '42', '43', '63', '69', '73', '74'],
  'Bourgogne-Franche-Comté': ['21', '25', '39', '58', '70', '71', '89', '90'],
  Bretagne: ['22', '29', '35', '56'],
  'Centre-Val de Loire': ['18', '28', '36', '37', '41', '45'],
  Corse: ['2A', '2B'],
  'Grand Est': ['08', '10', '51', '52', '54', '55', '57', '67', '68', '88'],
  'Hauts-de-France': ['02', '59', '60', '62', '80'],
  'Île-de-France': ['75', '77', '78', '91', '92', '93', '94', '95'],
  Normandie: ['14', '27', '50', '61', '76'],
  'Nouvelle-Aquitaine': ['16', '17', '19', '23', '24', '33', '40', '47', '64', '79', '86', '87'],
  Occitanie: ['09', '11', '12', '30', '31', '32', '34', '46', '48', '65', '66', '81', '82'],
  'Pays de la Loire': ['44', '49', '53', '72', '85'],
  "Provence-Alpes-Côte d'Azur": ['04', '05', '06', '13', '83', '84'],
}

const DEPARTEMENTS: Record<string, string> = {
  '01': 'Ain', '02': 'Aisne', '03': 'Allier', '04': 'Alpes-de-Haute-Provence', '05': 'Hautes-Alpes',
  '06': 'Alpes-Maritimes', '07': 'Ardèche', '08': 'Ardennes', '09': 'Ariège', '10': 'Aube', '11': 'Aude',
  '12': 'Aveyron', '13': 'Bouches-du-Rhône', '14': 'Calvados', '15': 'Cantal', '16': 'Charente',
  '17': 'Charente-Maritime', '18': 'Cher', '19': 'Corrèze', '2A': 'Corse-du-Sud', '2B': 'Haute-Corse',
  '21': "Côte-d'Or", '22': "Côtes-d'Armor", '23': 'Creuse', '24': 'Dordogne', '25': 'Doubs', '26': 'Drôme',
  '27': 'Eure', '28': 'Eure-et-Loir', '29': 'Finistère', '30': 'Gard', '31': 'Haute-Garonne', '32': 'Gers',
  '33': 'Gironde', '34': 'Hérault', '35': 'Ille-et-Vilaine', '36': 'Indre', '37': 'Indre-et-Loire',
  '38': 'Isère', '39': 'Jura', '40': 'Landes', '41': 'Loir-et-Cher', '42': 'Loire', '43': 'Haute-Loire',
  '44': 'Loire-Atlantique', '45': 'Loiret', '46': 'Lot', '47': 'Lot-et-Garonne', '48': 'Lozère',
  '49': 'Maine-et-Loire', '50': 'Manche', '51': 'Marne', '52': 'Haute-Marne', '53': 'Mayenne',
  '54': 'Meurthe-et-Moselle', '55': 'Meuse', '56': 'Morbihan', '57': 'Moselle', '58': 'Nièvre', '59': 'Nord',
  '60': 'Oise', '61': 'Orne', '62': 'Pas-de-Calais', '63': 'Puy-de-Dôme', '64': 'Pyrénées-Atlantiques',
  '65': 'Hautes-Pyrénées', '66': 'Pyrénées-Orientales', '67': 'Bas-Rhin', '68': 'Haut-Rhin', '69': 'Rhône',
  '70': 'Haute-Saône', '71': 'Saône-et-Loire', '72': 'Sarthe', '73': 'Savoie', '74': 'Haute-Savoie',
  '75': 'Paris', '76': 'Seine-Maritime', '77': 'Seine-et-Marne', '78': 'Yvelines', '79': 'Deux-Sèvres',
  '80': 'Somme', '81': 'Tarn', '82': 'Tarn-et-Garonne', '83': 'Var', '84': 'Vaucluse', '85': 'Vendée',
  '86': 'Vienne', '87': 'Haute-Vienne', '88': 'Vosges', '89': 'Yonne', '90': 'Territoire de Belfort',
  '91': 'Essonne', '92': 'Hauts-de-Seine', '93': 'Seine-Saint-Denis', '94': 'Val-de-Marne', '95': "Val-d'Oise",
}

const DROM: Record<string, string> = {
  '971': 'Guadeloupe',
  '972': 'Martinique',
  '973': 'Guyane',
  '974': 'La Réunion',
  '976': 'Mayotte',
}

const ARRONDISSEMENTS = [
  'Louvre', 'Bourse', 'Temple', 'Hôtel-de-Ville', 'Panthéon', 'Luxembourg', 'Palais-Bourbon', 'Élysée',
  'Opéra', 'Entrepôt', 'Popincourt', 'Reuilly', 'Gobelins', 'Observatoire', 'Vaugirard', 'Passy',
  'Batignolles-Monceau', 'Buttes-Montmartre', 'Buttes-Chaumont', 'Ménilmontant',
]

const regionOf = (code: string) => Object.entries(REGIONS).find(([, codes]) => codes.includes(code))?.[0] ?? ''

export const PARIS_ARR_CODES = ARRONDISSEMENTS.map((_, i) => `75-${i + 1}`)
export const DROM_CODES = Object.keys(DROM)
export const MONACO_CODE = '98'
export const IDF_CODES = REGIONS['Île-de-France']

export const isParisArr = (code: string) => code.startsWith('75-')

/** Clé de tri : 01…19, 2A, 2B, 21…75, 75-1…75-20, 76…95, DROM, Monaco. */
export function zoneSortKey(code: string): number {
  if (code === '2A') return 2010
  if (code === '2B') return 2020
  if (isParisArr(code)) return 7500 + Number(code.slice(3))
  if (code === MONACO_CODE) return 99_000
  return Number(code) * 100
}

export const compareZoneCodes = (a: string, b: string) => zoneSortKey(a) - zoneSortKey(b)

export const ZONES: ZoneInfo[] = [
  ...Object.entries(DEPARTEMENTS).map(([code, nom]) => ({ code, nom, type: 'departement' as const, region: regionOf(code) })),
  ...ARRONDISSEMENTS.map((nom, i) => ({
    code: `75-${i + 1}`,
    nom: `Paris ${i + 1}${i === 0 ? 'er' : 'e'} – ${nom}`,
    type: 'arrondissement' as const,
    region: 'Île-de-France',
  })),
  ...Object.entries(DROM).map(([code, nom]) => ({ code, nom, type: 'drom' as const, region: nom })),
  { code: MONACO_CODE, nom: 'Monaco', type: 'monaco' as const, region: 'Monaco' },
].sort((a, b) => compareZoneCodes(a.code, b.code))

export const ZONE_BY_CODE = new Map(ZONES.map((z) => [z.code, z]))

/** Libellé court : "22", "Paris 7e", "Monaco". */
export function shortZoneLabel(code: string): string {
  if (isParisArr(code)) {
    const n = Number(code.slice(3))
    return `Paris ${n}${n === 1 ? 'er' : 'e'}`
  }
  return code
}
