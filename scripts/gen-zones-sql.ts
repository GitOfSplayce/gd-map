// Génère la migration de remplissage de la table zones à partir de src/lib/zones.ts.
// Usage : npm run gen:zones-sql
import { writeFileSync } from 'node:fs'
import { ZONES } from '../src/lib/zones.ts'

const OUT = new URL('../supabase/migrations/20261001090300_zones.sql', import.meta.url).pathname

const q = (s: string) => `'${s.replaceAll("'", "''")}'`
const rows = ZONES.map((z) => `  (${q(z.code)}, ${q(z.nom)}, ${q(z.type)}, ${q(z.region)})`)

writeFileSync(
  OUT,
  `-- Généré par scripts/gen-zones-sql.ts depuis src/lib/zones.ts : ne pas modifier à la main.
insert into public.zones (code, nom, type, region) values
${rows.join(',\n')}
on conflict (code) do update set nom = excluded.nom, type = excluded.type, region = excluded.region;
`,
)
console.log(`${OUT} : ${ZONES.length} zones`)
