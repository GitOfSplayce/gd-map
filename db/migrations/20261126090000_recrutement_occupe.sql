-- À recruter, même là où quelqu'un est déjà ; un poste se pourvoit en propre (D-016).
--
-- D-011 réservait la priorité et le groupe aux départements vides. Un admin peut désormais marquer un
-- département déjà occupé : pour un second commercial, ou pour un commercial en propre là où il n'y a que
-- de la gestion ou du partiel. Un département vide reste à recruter sans rien écrire.
-- Un département sort du recrutement quand un commercial actif y arrive en propre (ou y passe en propre) ;
-- en gestion ou en partiel, il y reste.

-- ---------------------------------------------------------------------------------------------------
-- 1. Priorité et groupe, sur n'importe quel département d'une structure
-- ---------------------------------------------------------------------------------------------------

create or replace function public.set_recrutement(p_structure text, p_zones jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux admins' using errcode = '42501';
  end if;
  if jsonb_typeof(p_zones) is distinct from 'array' then
    raise exception 'Liste de départements illisible' using errcode = '22023';
  end if;

  -- Paris : entier, ou par arrondissement, jamais les deux à la fois
  if exists (select 1 from jsonb_to_recordset(p_zones) as x (zone_code text) where x.zone_code like '75-%') then
    insert into public.a_recruter (structure, zone_code, priorite, secteur)
    select r.structure, atome, r.priorite, r.secteur
    from public.a_recruter r, public.zones_atomes('75') as atome
    where r.structure = p_structure and r.zone_code = '75'
    on conflict (structure, zone_code) do nothing;
    delete from public.a_recruter r where r.structure = p_structure and r.zone_code = '75';
  end if;
  if exists (select 1 from jsonb_to_recordset(p_zones) as x (zone_code text) where x.zone_code = '75') then
    delete from public.a_recruter r where r.structure = p_structure and r.zone_code like '75-%';
  end if;

  delete from public.a_recruter r
  using jsonb_to_recordset(p_zones) as x (zone_code text, priorite integer, secteur text)
  where r.structure = p_structure and r.zone_code = x.zone_code
    and x.priorite is null and nullif(btrim(x.secteur), '') is null;

  insert into public.a_recruter (structure, zone_code, priorite, secteur)
  select distinct on (x.zone_code) p_structure, x.zone_code, x.priorite, nullif(btrim(x.secteur), '')
  from jsonb_to_recordset(p_zones) as x (zone_code text, priorite integer, secteur text)
  where x.priorite is not null or nullif(btrim(x.secteur), '') is not null
  on conflict (structure, zone_code) do update set priorite = excluded.priorite, secteur = excluded.secteur
  where (public.a_recruter.priorite, public.a_recruter.secteur) is distinct from (excluded.priorite, excluded.secteur);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Pourvu : seulement par un commercial actif en propre
-- ---------------------------------------------------------------------------------------------------

create or replace function public.affectations_pourvoir()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.couverture = 'propre' and exists (select 1 from public.commerciaux c where c.id = new.commercial_id and c.actif) then
    perform public.pourvoir(new.structure, new.zone_code);
  end if;
  return null;
end;
$$;

drop trigger affectations_pourvoir on public.affectations;

create trigger affectations_pourvoir
after insert on public.affectations
for each row when (new.couverture = 'propre') execute function public.affectations_pourvoir();

-- Un commercial déjà là, en gestion ou en partiel, qui passe en propre
create trigger affectations_pourvoir_propre
after update of couverture on public.affectations
for each row when (new.couverture = 'propre' and old.couverture <> 'propre') execute function public.affectations_pourvoir();

create or replace function public.commerciaux_pourvoir()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.pourvoir(a.structure, a.zone_code) from public.affectations a where a.commercial_id = new.id and a.couverture = 'propre';
  return null;
end;
$$;

comment on table public.a_recruter is
  'Départements à recruter (D-011, D-016) : priorité (1 à 3) et groupe (colonne secteur). Un département vide est à recruter sans ligne ; un département occupé peut l''être aussi. Il sort quand un commercial actif y arrive en propre.';
