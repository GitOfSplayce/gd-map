// Génère exemples/exemple-import.xlsx : un fichier fictif au format de l'onglet V3.
// Même disposition que le fichier réel : colonne A vide, en-têtes en ligne 3 (avec espaces parasites),
// colonnes calculées à droite qui reprennent certains en-têtes (Statut, Manager 1…).
// Usage : npm run sample:excel
import { mkdirSync, writeFileSync } from 'node:fs'
import * as XLSX from 'xlsx'

const OUT_DIR = new URL('../exemples/', import.meta.url).pathname
const OUT = OUT_DIR + 'exemple-import.xlsx'

const HEADERS = [
  'Nom', 'MD', 'SP', 'MC', 'BK', 'Statut ', 'Nb de jour / an', 'Manager 1', 'Date 1', 'Manager 2', 'Date 2',
  'Actions ', 'Région', 'DPT MD', 'DPT SP', 'DPT MC', 'DPT BK',
  'CA MD', 'Objectif MD', 'CA SP', 'Objectif SP', 'CA MC', 'Objectif MC', 'CA BK', 'Objectif BK',
]

// [Nom, MD, SP, MC, BK, Statut, Jours, M1, Date1, M2, Date2, Actions, Région, DPT MD, DPT SP, DPT MC, DPT BK, CA/Obj…]
const ROWS = [
  ['Agathe Rolland', 'X', '', '', '', 'VRP', 2, 'Hélène', 'mi-Oct', 'Hélène', '-', '', 'Secteur Ouest', '29, 56, 22', '', '', '', 120000, 150000],
  ['Basile Fournier', 'X', '', '', '', 'VRP', 3, 'Hélène', 'mi-Oct', 'Direction Nord', '?', '', 'Secteur Nord-Est', '57, 08, 55, 52G, 10G'],
  ['Capucine Delorme', 'X', 'X', '', '', 'ATC Splayce', 2, 'Inès', 'mi-Oct', 'Inès', '-', '', 'Secteur Alpes', '73, 74', '01, 26, 38, 73, 74', '', '', 80000, 90000, 40000, 50000],
  ['Dorian Marchal', 'X', '', '', '', 'VRP', 1, 'Victor', 'mi-Oct', 'Direction Nord', '?', 'Départ prévu 2027', 'Paris Nord', '75-8, 75-9, 75-10, 75-17, 75-18, 75-19, 93'],
  ['Élodie Vasseur', 'X', '', '', '', 'VRP', 2, 'Victor', 'mi-Oct', 'Direction Nord', '?', '', 'Paris Sud', '75-1, 75-2, 75-3, 75-4, 75-5, 75-6, 75-7, 75-11, 75-12, 75-13, 75-14, 75-15, 75-16, 75-20, 92, 94'],
  ['Fabien Carré', 'X', '', '', '', 'Agent Commercial', 3, 'Inès', 'mi-Oct', 'Inès', '', '', 'Secteur Riviera', '06, 98', '', '', ''],
  ['Gaspard Lenoir', 'X', '', '', '', 'VRP', 2, 'Inès', 'mi-Oct', 'Direction Sud', '', '', 'Secteur Provence', '04, 05, 20, 83, 13'],
  [],
  ['À recruter – Secteur Est', 'X', '', '', '', 'A recruter', '', '', '', '', '', '', 'Secteur Est', '67, 68, 88, 54'],
  ['À recruter – Secteur Centre', 'X', '', '', '', 'A recruter', '', '', '', '', '', '', 'Secteur Centre', '18, 36, 41, 45'],
  ['HAMON Léonie', '', 'X', '', '', '', '', 'Hélène', '', 'Hélène', '-', '', '', '', '29, 35P, 56'],
  ['IZARD Théo', '', 'X', '', '', '', '', 'Hélène', '', 'Hélène', '-', '', '', '', '35P, 44, 85'],
  ['JOUBERT Maëlle', '', 'X', '', '', '', '', 'Inès', '', 'Direction Sud', 'recrut', '', '', '', '07G, 26G, 48P, 30'],
  ['KERVELLA Simon', '', 'X', '', '', '', '', 'Victor', '', 'Direction Nord', '', '', '', '', '75, 93, 95'],
  ['LAVAL Inaya', '', 'X', '', '', '', '', 'Inès', '', 'Inès', '', '', '', '', '98, 06'],
  ['MOULIN Axel', '', 'X', '', '', '', '', 'Hélène', '', 'Direction Nord', 'recrut', '', '', '', '02, 59, 76G, 62, ?'],
  ['NAUDIN Margaux', '', '', 'X', '', '', '', 'Noémie', '-', 'Bastien', new Date(2027, 0, 1)],
  ['OGER Lucas', '', '', 'X', '', '', '', 'Noémie', '-', 'Claire', new Date(2027, 0, 1), '', '', '', '', '', '971, 972, 973, 974, 976'],
  ['PRADEL Jade', '', '', '', 'X', '', '', 'Claire', '', 'Claire', '', '', '', '', '', '', '13, 9, 2AB, 1000'],
  ['QUILLET Lou', '', '', '', 'X', '', '', 'Bastien', '', 'Bastien'],
]

// CA et objectifs fictifs (colonnes « CA MD », « Objectif MD »…), pour illustrer la vue Performance
const FIGURES = {
  'Basile Fournier': { MD: [210000, 200000] },
  'Dorian Marchal': { MD: [95000, 180000] },
  'Élodie Vasseur': { MD: [260000, 200000] },
  'Fabien Carré': { MD: [60000, 140000] },
  'Gaspard Lenoir': { MD: [150000, 160000] },
  'HAMON Léonie': { SP: [70000, 60000] },
  'IZARD Théo': { SP: [30000, 65000] },
  'JOUBERT Maëlle': { SP: [55000, 70000] },
  'KERVELLA Simon': { SP: [98000, 80000] },
  'NAUDIN Margaux': { MC: [45000, 50000] },
  'PRADEL Jade': { BK: [20000, 25000] },
}
const FIRST_FIGURE_COLUMN = HEADERS.indexOf('CA MD')
for (const row of ROWS) {
  for (const [structure, [ca, objectif]] of Object.entries(FIGURES[row[0]] ?? {})) {
    while (row.length < HEADERS.length) row.push('')
    const i = FIRST_FIGURE_COLUMN + ['MD', 'SP', 'MC', 'BK'].indexOf(structure) * 2
    row[i] = ca
    row[i + 1] = objectif
  }
}

// Colonnes calculées à droite (comme dans le fichier réel) : en-têtes en double, à ignorer
const RIGHT_HEADERS = ['', 'Commercial', 'Structure', 'Dépt', 'Arr.', 'Couverture', 'Manager 1', 'Manager 2', 'Statut']

const aoa = [
  ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'Affectations (calcul automatique – ne pas saisir ici)'],
  ['', 'Carte commerciale – fichier d\'exemple (données fictives)'],
  ['', ...HEADERS, ...RIGHT_HEADERS],
  ...ROWS.map((r) => (r.length ? ['', ...r, ...Array(HEADERS.length - r.length).fill(''), '', 'calcul', 'MD', '29', '', 'Propre', 'X', 'Y', 'VRP'] : [])),
]

const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true })
ws['!cols'] = [{ wch: 2 }, { wch: 32 }, ...HEADERS.slice(1).map((h) => ({ wch: h.startsWith('DPT') ? 34 : h.length <= 3 ? 4 : 12 }))]
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'V3')
XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Onglet sans rapport, pour tester le choix de l\'onglet']]), 'Notes')
mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', compression: true }))
console.log(`${OUT} : ${ROWS.filter((r) => r.length).length} lignes`)
