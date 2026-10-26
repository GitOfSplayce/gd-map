-- Statuts : une seule écriture par statut, quelles que soient la casse et les accents
-- (« A recruter » → « À recruter », « Agent Commercial » → « Agent commercial »).
-- Même règle que src/lib/statuts.ts : l'écriture des suggestions l'emporte, sinon la plus fréquente
-- (à égalité : la plus accentuée, puis l'ordre alphabétique). Rejouable sans effet.

create or replace function pg_temp.statut_key(s text)
returns text
language sql
immutable
as $$
  select lower(btrim(regexp_replace(
    translate(s, 'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿ', 'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYyy'),
    '[\s–—-]+', ' ', 'g'
  )))
$$;

with variants as (
  select btrim(regexp_replace(statut, '\s+', ' ', 'g')) as statut, count(*) as n
  from public.commerciaux
  where btrim(coalesce(statut, '')) <> ''
  group by 1
),
preferred as (
  select s as statut from unnest(array['VRP', 'Agent commercial', 'ATC', 'À recruter']) as s
),
canon as (
  select distinct on (pg_temp.statut_key(v.statut))
    pg_temp.statut_key(v.statut) as k,
    coalesce(
      (select p.statut from preferred p where pg_temp.statut_key(p.statut) = pg_temp.statut_key(v.statut)),
      v.statut
    ) as statut
  from variants v
  order by
    pg_temp.statut_key(v.statut),
    v.n desc,
    length(v.statut) - length(translate(v.statut, 'ÀÁÂÄàáâäÇçÈÉÊËèéêëÎÏîïÔÖôöÙÛÜùûü', '')) desc,
    v.statut
)
update public.commerciaux c
set statut = canon.statut
from canon
where pg_temp.statut_key(c.statut) = canon.k
  and c.statut is distinct from canon.statut;

drop function pg_temp.statut_key(text);
