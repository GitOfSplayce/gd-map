-- Rôle Manager, départements à recruter, journal des modifications (D-010, D-011, D-012).
--
-- Un manager est relié à son compte GD One (`managers.compte`). Il voit toute la carte, chiffres compris,
-- et ne modifie que les départements, le CA et les objectifs de ses commerciaux, dans les structures
-- qu'un admin lui a cochées. Un département (par structure) n'appartient qu'à un manager. Un département
-- vide est à recruter. Le rôle « responsable » de D-009 disparaît.

-- ---------------------------------------------------------------------------------------------------
-- 1. Manager 1 et Manager 2 se désactivent pour toute la carte (il en reste toujours un)
-- ---------------------------------------------------------------------------------------------------

alter table public.settings
  add column manager1_actif boolean not null default true,
  add column manager2_actif boolean not null default true,
  add constraint settings_un_manager_actif check (manager1_actif or manager2_actif);

create function public.set_managers_actifs(p_manager1 boolean, p_manager2 boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux admins' using errcode = '42501';
  end if;
  if not (coalesce(p_manager1, false) or coalesce(p_manager2, false)) then
    raise exception 'Manager 1 ou Manager 2 doit rester actif' using errcode = '22023';
  end if;
  update public.settings set manager1_actif = coalesce(p_manager1, false), manager2_actif = coalesce(p_manager2, false) where id = 1;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Les managers : leur compte GD One et leurs structures
-- ---------------------------------------------------------------------------------------------------

alter table public.managers
  add column structures text[] not null default '{}',
  -- Compte GD One, distinct de l'e-mail de contact : changer un contact ne donne ni ne retire d'accès.
  add column compte text
    check (compte = lower(btrim(compte)) and compte ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

create unique index managers_compte_key on public.managers (compte);

-- Point de départ : les structures de leurs commerciaux
update public.managers m
set structures = coalesce((
  select array_agg(distinct s order by s)
  from public.commerciaux c, unnest(c.structures) as s
  where c.manager1 = m.nom or c.manager2 = m.nom
), '{}')
where m.structures = '{}';

create trigger managers_check_structures
before insert or update of structures on public.managers
for each row execute function public.check_commercial_structures();

-- Code renommé ou structure supprimée : les commerciaux et les managers suivent
create or replace function public.sync_commercial_structures()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.commerciaux set structures = array_remove(structures, old.code) where old.code = any (structures);
    update public.managers set structures = array_remove(structures, old.code) where old.code = any (structures);
    return old;
  end if;
  if new.code <> old.code then
    update public.commerciaux set structures = array_replace(structures, old.code, new.code) where old.code = any (structures);
    update public.managers set structures = array_replace(structures, old.code, new.code) where old.code = any (structures);
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 3. Les rôles : admin (table acces) ou manager (managers.compte)
-- ---------------------------------------------------------------------------------------------------

-- Un responsable d'un seul manager devient ce manager ; les autres repassent au code d'accès.
update public.managers m
set compte = a.email
from public.acces a
where a.role = 'responsable' and a.managers = array[m.nom];

drop function public.get_equipe();
drop function public.save_objectifs_equipe(uuid, jsonb);
drop function public.team_managers();
drop trigger acces_check_managers on public.acces;
drop trigger managers_follow_in_acces on public.managers;
drop function public.acces_check_managers();
drop function public.acces_follow_managers();

delete from public.acces where role = 'responsable';
alter table public.acces
  drop constraint acces_managers_check,
  drop column managers,
  drop constraint acces_role_check,
  add constraint acces_role_check check (role = 'admin');

-- 'admin', 'manager', ou null (pas de rôle, ou plus de droit d'usage sur le portail). Un manager aussi
-- admin est admin.
create or replace function public.map_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case
    when exists (select 1 from public.acces a where a.email = lower(u.email) and a.role = 'admin') then 'admin'
    when exists (select 1 from public.managers m where m.compte = lower(u.email)) then 'manager'
  end
  from public."user" u
  where u.id = (select auth.uid()) and coalesce(u."hasAccess", false);
$$;

-- Nom du manager connecté ; null pour tout autre, admin compris.
create function public.mon_manager()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.nom
  from public."user" u
  join public.managers m on m.compte = lower(u.email)
  where u.id = (select auth.uid()) and public.map_role() = 'manager';
$$;

-- Ce manager gère-t-il un commercial de tel Manager 1 et Manager 2 ? Seuls comptent ceux qui sont actifs.
create function public.gere(p_manager text, p_manager1 text, p_manager2 text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((s.manager1_actif and p_manager1 = p_manager) or (s.manager2_actif and p_manager2 = p_manager), false)
  from public.settings s where s.id = 1;
$$;

-- Fusion de deux managers : celui qui reste prend le contact, le compte et les structures de l'autre.
create or replace function public.rename_manager(p_old text, p_new text)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_new text := btrim(p_new);
  v_old public.managers;
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux admins' using errcode = '42501';
  end if;
  if v_new = '' then
    raise exception 'Le nom du manager est obligatoire' using errcode = '22023';
  end if;
  if v_new = p_old then
    return;
  end if;

  if exists (select 1 from public.managers where nom = v_new) then
    select * into v_old from public.managers where nom = p_old;
    update public.managers set compte = null where nom = p_old and compte is not null;
    update public.managers m
    set telephone = coalesce(m.telephone, v_old.telephone),
        email = coalesce(m.email, v_old.email),
        compte = coalesce(m.compte, v_old.compte),
        structures = array(select distinct s from unnest(m.structures || coalesce(v_old.structures, '{}')) as s order by s)
    where m.nom = v_new;
    update public.commerciaux set manager1 = v_new where manager1 = p_old;
    update public.commerciaux set manager2 = v_new where manager2 = p_old;
    delete from public.managers where nom = p_old;
  else
    update public.managers set nom = v_new where nom = p_old;
  end if;
end;
$$;

-- Page Paramètres (admins) et onglet Managers (comptes) : qui a quel rôle, et qui est déjà venu.
create or replace function public.list_acces()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux admins' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'roles', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', a.email, 'role', a.role, 'created_at', a.created_at, 'created_by', a.created_by,
        'name', u.name, 'last_sign_in_at', public.last_sign_in(u.id)
      ) order by a.email)
      from public.acces a
      left join public."user" u on lower(u.email) = a.email
    ), '[]'::jsonb),
    'users', coalesce((
      select jsonb_agg(jsonb_build_object(
        'email', lower(u.email), 'name', u.name, 'has_access', coalesce(u."hasAccess", false),
        'last_sign_in_at', public.last_sign_in(u.id)
      ) order by u.name)
      from public."user" u
    ), '[]'::jsonb)
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Les zones : « 75 » couvre les 20 arrondissements
-- ---------------------------------------------------------------------------------------------------

-- Les zones élémentaires d'un code : lui-même, ou les arrondissements pour « 75 ».
create function public.zones_atomes(p_code text)
returns setof text
language sql
stable
set search_path = ''
as $$
  select z.code from public.zones z where p_code = '75' and z.type = 'arrondissement'
  union all
  select p_code where p_code <> '75';
$$;

-- Occupation de chaque zone élémentaire, par structure : les commerciaux actifs qui y sont.
create function public.occupants(p_structure text)
returns table (zone text, commercial_id uuid)
language sql
stable
security definer
set search_path = ''
as $$
  select z.code, a.commercial_id
  from public.affectations a
  join public.commerciaux c on c.id = a.commercial_id and c.actif
  join public.zones z on z.code = a.zone_code or (a.zone_code = '75' and z.type = 'arrondissement')
  where a.structure = p_structure and z.code <> '75';
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Les départements à recruter : un département vide, sa priorité (1 à 3) et son secteur
-- ---------------------------------------------------------------------------------------------------

-- Un département vide est à recruter sans rien écrire ici ; une ligne n'ajoute qu'une priorité ou un secteur.
create table public.a_recruter (
  structure text not null references public.structures (code) on update cascade on delete cascade,
  zone_code text not null references public.zones (code) on update cascade,
  priorite smallint check (priorite between 1 and 3),
  secteur text check (secteur = btrim(secteur) and secteur <> ''),
  primary key (structure, zone_code),
  check (priorite is not null or secteur is not null)
);

alter table public.a_recruter enable row level security;
revoke all on public.a_recruter from anon;
grant select, insert, update, delete on public.a_recruter to authenticated;
grant all on public.a_recruter to service_role;

create policy "Admins : départements à recruter"
  on public.a_recruter for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Un département pourvu n'est plus à recruter. Si tout Paris l'était et qu'un arrondissement est pourvu,
-- les autres arrondissements le restent.
create function public.pourvoir(p_structure text, p_zone text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_zone like '75-%' then
    insert into public.a_recruter (structure, zone_code, priorite, secteur)
    select r.structure, atome, r.priorite, r.secteur
    from public.a_recruter r, public.zones_atomes('75') as atome
    where r.structure = p_structure and r.zone_code = '75' and atome <> p_zone
    on conflict (structure, zone_code) do nothing;
  end if;
  delete from public.a_recruter r
  where r.structure = p_structure
    and (r.zone_code = p_zone or (p_zone = '75' and r.zone_code like '75-%') or (p_zone like '75-%' and r.zone_code = '75'));
end;
$$;

create function public.affectations_pourvoir()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from public.commerciaux c where c.id = new.commercial_id and c.actif) then
    perform public.pourvoir(new.structure, new.zone_code);
  end if;
  return null;
end;
$$;

create trigger affectations_pourvoir
after insert on public.affectations
for each row execute function public.affectations_pourvoir();

create function public.commerciaux_pourvoir()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.pourvoir(a.structure, a.zone_code) from public.affectations a where a.commercial_id = new.id;
  return null;
end;
$$;

create trigger commerciaux_pourvoir
after update of actif on public.commerciaux
for each row when (new.actif and not old.actif) execute function public.commerciaux_pourvoir();

-- Priorité et secteur de départements vides d'une structure (ni l'un ni l'autre : la ligne disparaît).
create function public.set_recrutement(p_structure text, p_zones jsonb)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_occupe text;
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux admins' using errcode = '42501';
  end if;
  if jsonb_typeof(p_zones) is distinct from 'array' then
    raise exception 'Liste de départements illisible' using errcode = '22023';
  end if;

  select x.zone_code into v_occupe
  from jsonb_to_recordset(p_zones) as x (zone_code text, priorite integer, secteur text)
  where (x.priorite is not null or nullif(btrim(x.secteur), '') is not null)
    and exists (
      select 1 from public.zones_atomes(x.zone_code) as atome
      join public.occupants(p_structure) o on o.zone = atome
    )
  limit 1;
  if v_occupe is not null then
    raise exception 'Le département % (%) n''est pas vide', v_occupe, p_structure using errcode = '22023';
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

-- Une fiche « À recruter » d'avant D-011 : un faux commercial, par son nom ou son statut.
create function public.est_a_recruter(p_nom text, p_statut text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select coalesce(bool_or(regexp_replace(translate(lower(btrim(v)), 'àâä', 'aaa'), '\s+', ' ', 'g') like 'a recruter%'), false)
  from unnest(array[p_nom, p_statut]) as v;
$$;

-- Supprime des fiches « À recruter » : leurs départements, s'ils sont vides, prennent leur nom pour secteur.
create function public.convertir_a_recruter(p_ids uuid[])
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_fiche record;
  v_zones jsonb := '[]'::jsonb;
  v_n integer := 0;
  v_total integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux admins' using errcode = '42501';
  end if;

  for v_fiche in
    select c.id, c.nom, c.statut,
      coalesce(
        nullif(btrim(regexp_replace(c.nom, '^\s*[aàAÀ]\s+recruter\s*[-–—:]?\s*', '', 'i')), ''),
        nullif(btrim(c.secteur), '')
      ) as secteur
    from public.commerciaux c
    where c.id = any (coalesce(p_ids, '{}'))
    order by c.ordre, c.nom
  loop
    if not public.est_a_recruter(v_fiche.nom, v_fiche.statut) then
      raise exception '« % » n''est pas une fiche « À recruter »', v_fiche.nom using errcode = '22023';
    end if;
    v_zones := v_zones || coalesce((
      select jsonb_agg(jsonb_build_object('structure', a.structure, 'zone_code', a.zone_code, 'secteur', v_fiche.secteur))
      from public.affectations a where a.commercial_id = v_fiche.id
    ), '[]'::jsonb);
    v_n := v_n + 1;
  end loop;

  delete from public.commerciaux where id = any (coalesce(p_ids, '{}'));

  -- Une zone encore occupée n'est pas à recruter ; « 75 » se détaille si un arrondissement est occupé
  insert into public.a_recruter (structure, zone_code, secteur)
  select distinct on (x.structure, cible.code) x.structure, cible.code, x.secteur
  from jsonb_to_recordset(v_zones) as x (structure text, zone_code text, secteur text)
  cross join lateral (
    select x.zone_code as code
    where not exists (
      select 1 from public.zones_atomes(x.zone_code) as atome join public.occupants(x.structure) o on o.zone = atome
    )
    union all
    select atome
    from public.zones_atomes(x.zone_code) as atome
    where x.zone_code = '75'
      and exists (select 1 from public.zones_atomes('75') as a2 join public.occupants(x.structure) o on o.zone = a2)
      and not exists (select 1 from public.occupants(x.structure) o where o.zone = atome)
  ) as cible
  where x.secteur is not null
  on conflict (structure, zone_code) do nothing;
  get diagnostics v_total = row_count;

  return jsonb_build_object('fiches', v_n, 'zones', v_total);
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 6. Le journal : qui a modifié quoi, quand, avant et après
-- ---------------------------------------------------------------------------------------------------

-- Une ligne par changement. `lot` réunit celles d'un même enregistrement. Pas de clé étrangère : le
-- journal survit à ce qu'il décrit. Personne n'y accède directement, ni en lecture ni en écriture.
create table public.journal (
  id bigint generated always as identity primary key,
  le timestamptz not null default now(),
  lot bigint not null default txid_current(),
  auteur text,
  auteur_nom text,
  objet text not null check (objet in ('commercial', 'zone', 'chiffres', 'manager', 'structure', 'recrutement', 'acces', 'reglage')),
  action text not null check (action in ('ajout', 'modification', 'retrait')),
  commercial_id uuid,
  nom text,
  structure text,
  zone_code text,
  annee integer,
  avant jsonb,
  apres jsonb
);

create index journal_commercial_idx on public.journal (commercial_id, id desc);

alter table public.journal enable row level security;
revoke all on public.journal from public, anon, authenticated;

create function public.noter(
  p_objet text, p_action text, p_commercial uuid, p_nom text, p_structure text, p_zone text, p_annee integer, p_avant jsonb, p_apres jsonb
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.journal (auteur, auteur_nom, objet, action, commercial_id, nom, structure, zone_code, annee, avant, apres)
  values (
    public.current_email(),
    (select u.name from public."user" u where u.id = (select auth.uid())),
    p_objet, p_action, p_commercial, p_nom, p_structure, p_zone, p_annee, p_avant, p_apres
  );
$$;

-- Déclencheur commun. Arguments : l'objet, puis les colonnes suivies. Une suite automatique (structure
-- renommée, manager supprimé, département pourvu…) n'ajoute rien : la ligne qui l'a causée le dit. Les
-- suites des clés étrangères arrivent à la même profondeur que le reste : on les reconnaît à ce qui
-- n'existe plus (le commercial, la structure, le manager d'avant).
create function public.journaliser()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_objet text := tg_argv[0];
  v_champs text[] := tg_argv[1]::text[];
  v_old jsonb;
  v_new jsonb;
  v_ligne jsonb;
  v_avant jsonb;
  v_apres jsonb;
  v_commercial uuid;
  v_nom text;
begin
  if pg_trigger_depth() > 1 then
    return null;
  end if;

  if tg_op <> 'INSERT' then v_old := to_jsonb(old); end if;
  if tg_op <> 'DELETE' then v_new := to_jsonb(new); end if;
  v_ligne := coalesce(v_new, v_old);

  if tg_op = 'DELETE' and v_objet in ('zone', 'chiffres', 'recrutement') and not exists (select 1 from public.structures s where s.code = v_old ->> 'structure') then
    return null;
  end if;
  if tg_op = 'DELETE' and v_objet in ('zone', 'chiffres') and not exists (select 1 from public.commerciaux c where c.id = (v_old ->> 'commercial_id')::uuid) then
    return null;
  end if;
  if tg_op = 'UPDATE' and v_objet = 'commercial' then
    v_champs := array(
      select k from unnest(v_champs) as k
      where k not in ('manager1', 'manager2') or v_old ->> k is null or exists (select 1 from public.managers m where m.nom = v_old ->> k)
    );
  end if;

  select
    jsonb_object_agg(k, v_old -> k) filter (where case when tg_op = 'UPDATE' then v_old -> k is distinct from v_new -> k else v_old ->> k is not null end),
    jsonb_object_agg(k, v_new -> k) filter (where case when tg_op = 'UPDATE' then v_old -> k is distinct from v_new -> k else v_new ->> k is not null end)
  into v_avant, v_apres
  from unnest(v_champs) as k;

  if tg_op = 'UPDATE' and v_apres is null then
    return null;
  end if;

  v_commercial := case when v_objet = 'commercial' then (v_ligne ->> 'id')::uuid when v_objet in ('zone', 'chiffres') then (v_ligne ->> 'commercial_id')::uuid end;
  v_nom := case
    when v_objet in ('zone', 'chiffres') then (select c.nom from public.commerciaux c where c.id = v_commercial)
    when v_objet = 'acces' then v_ligne ->> 'email'
    when v_objet = 'structure' then v_ligne ->> 'code'
    else v_ligne ->> 'nom'
  end;

  perform public.noter(
    v_objet,
    case tg_op when 'INSERT' then 'ajout' when 'UPDATE' then 'modification' else 'retrait' end,
    v_commercial, v_nom, v_ligne ->> 'structure', v_ligne ->> 'zone_code', (v_ligne ->> 'annee')::integer, v_avant, v_apres
  );
  return null;
end;
$$;

create trigger journal_commerciaux
after insert or update on public.commerciaux
for each row execute function public.journaliser('commercial', '{nom,statut,manager1,manager2,couleur,actif,notes,structures,jours_an,date_manager1,date_manager2,actions,secteur,telephone,email}');

create trigger journal_affectations
after insert or update or delete on public.affectations
for each row execute function public.journaliser('zone', '{couverture}');

create trigger journal_objectifs
after insert or update or delete on public.objectifs
for each row execute function public.journaliser('chiffres', '{ca,objectif}');

create trigger journal_managers
after insert or update or delete on public.managers
for each row execute function public.journaliser('manager', '{nom,couleur,telephone,email,structures,compte}');

create trigger journal_structures
after insert or update or delete on public.structures
for each row execute function public.journaliser('structure', '{code,nom}');

create trigger journal_a_recruter
after insert or update or delete on public.a_recruter
for each row execute function public.journaliser('recrutement', '{priorite,secteur}');

create trigger journal_acces
after insert or update or delete on public.acces
for each row execute function public.journaliser('acces', '{role}');

-- Un commercial retiré emporte ses zones et ses chiffres : le journal les garde avec lui.
create function public.journaliser_retrait_commercial()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.noter(
    'commercial', 'retrait', old.id, old.nom, null, null, null,
    jsonb_strip_nulls(to_jsonb(old) - '{id,created_at,updated_at,ordre}'::text[]) || jsonb_build_object(
      'zones', coalesce((
        select jsonb_agg(jsonb_build_object('structure', a.structure, 'zone_code', a.zone_code, 'couverture', a.couverture) order by a.structure, a.zone_code)
        from public.affectations a where a.commercial_id = old.id
      ), '[]'::jsonb),
      'chiffres', coalesce((
        select jsonb_agg(jsonb_build_object('structure', o.structure, 'annee', o.annee, 'ca', o.ca, 'objectif', o.objectif) order by o.annee, o.structure)
        from public.objectifs o where o.commercial_id = old.id
      ), '[]'::jsonb)
    ),
    null
  );
  return old;
end;
$$;

create trigger journal_retrait_commercial
before delete on public.commerciaux
for each row execute function public.journaliser_retrait_commercial();

-- Réglages : le code d'accès change, sa valeur n'est jamais notée, même chiffrée.
create function public.journaliser_reglages()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_avant jsonb := '{}'::jsonb;
  v_apres jsonb := '{}'::jsonb;
begin
  if new.access_code_hash is distinct from old.access_code_hash then
    v_apres := v_apres || jsonb_build_object('code', 'nouveau code d''accès');
  end if;
  if new.default_shared_mode is distinct from old.default_shared_mode then
    v_avant := v_avant || jsonb_build_object('default_shared_mode', old.default_shared_mode);
    v_apres := v_apres || jsonb_build_object('default_shared_mode', new.default_shared_mode);
  end if;
  if new.manager1_actif is distinct from old.manager1_actif then
    v_avant := v_avant || jsonb_build_object('manager1_actif', old.manager1_actif);
    v_apres := v_apres || jsonb_build_object('manager1_actif', new.manager1_actif);
  end if;
  if new.manager2_actif is distinct from old.manager2_actif then
    v_avant := v_avant || jsonb_build_object('manager2_actif', old.manager2_actif);
    v_apres := v_apres || jsonb_build_object('manager2_actif', new.manager2_actif);
  end if;
  if v_apres <> '{}'::jsonb then
    perform public.noter('reglage', 'modification', null, null, null, null, null, v_avant, v_apres);
  end if;
  return null;
end;
$$;

create trigger journal_settings
after update on public.settings
for each row execute function public.journaliser_reglages();

-- Lecture : tout pour un admin, son équipe du moment pour un manager, sans les champs réservés aux
-- admins. Du plus récent au plus ancien, par pages (`p_avant` : identifiant de la dernière ligne reçue).
create function public.get_journal(p_avant bigint default null, p_limite integer default 200, p_commercial uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.map_role();
  v_moi text := public.mon_manager();
  v_limite integer := least(greatest(coalesce(p_limite, 200), 1), 500);
  v_reserves text[] := '{notes,jours_an,date_manager1,date_manager2,actions}';
  v_lignes jsonb;
begin
  if v_role is null then
    raise exception 'Accès réservé aux admins et aux managers' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(l) order by l.id desc), '[]'::jsonb) into v_lignes
  from (
    select j.id, j.le, j.lot, j.auteur, j.auteur_nom, j.objet, j.action, j.commercial_id, j.nom, j.structure, j.zone_code, j.annee,
      case when v_role = 'admin' then j.avant else j.avant - v_reserves end as avant,
      case when v_role = 'admin' then j.apres else j.apres - v_reserves end as apres
    from public.journal j
    where (p_avant is null or j.id < p_avant)
      and (p_commercial is null or j.commercial_id = p_commercial)
      and (
        v_role = 'admin'
        or (
          exists (
            select 1 from public.commerciaux c
            where c.id = j.commercial_id and public.gere(v_moi, c.manager1, c.manager2)
          )
          -- Un changement qui ne touche que des champs réservés ne le regarde pas
          and (j.action <> 'modification' or coalesce(j.apres - v_reserves, '{}'::jsonb) <> '{}'::jsonb)
        )
      )
    order by j.id desc
    limit v_limite + 1
  ) as l;

  return jsonb_build_object(
    'lignes', case when jsonb_array_length(v_lignes) > v_limite then v_lignes - v_limite else v_lignes end,
    'suite', jsonb_array_length(v_lignes) > v_limite
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 7. Enregistrer un commercial : seules les lignes qui changent sont écrites (le journal reste juste)
-- ---------------------------------------------------------------------------------------------------

-- Zones d'un commercial dans les structures données : ajoute, change et retire ce qu'il faut.
create function public.ecrire_zones(p_commercial uuid, p_zones jsonb, p_structures text[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(p_zones) is distinct from 'array' then
    raise exception 'Liste de zones illisible' using errcode = '22023';
  end if;
  delete from public.affectations a
  where a.commercial_id = p_commercial and a.structure = any (p_structures)
    and not exists (
      select 1 from jsonb_to_recordset(p_zones) as x (structure text, zone_code text)
      where x.structure = a.structure and x.zone_code = a.zone_code
    );
  insert into public.affectations (commercial_id, structure, zone_code, couverture)
  select distinct on (x.structure, x.zone_code) p_commercial, x.structure, x.zone_code, coalesce(x.couverture, 'propre')
  from jsonb_to_recordset(p_zones) as x (structure text, zone_code text, couverture text)
  on conflict (commercial_id, structure, zone_code) do update set couverture = excluded.couverture
  where public.affectations.couverture is distinct from excluded.couverture;
end;
$$;

-- CA et objectifs d'un commercial : seules les lignes envoyées changent, une ligne vidée disparaît.
create function public.ecrire_chiffres(p_commercial uuid, p_chiffres jsonb)
returns void
language plpgsql
set search_path = ''
as $$
begin
  if jsonb_typeof(p_chiffres) is distinct from 'array' then
    raise exception 'Liste de CA et objectifs illisible' using errcode = '22023';
  end if;
  delete from public.objectifs o
  using jsonb_to_recordset(p_chiffres) as x (structure text, annee integer, ca numeric, objectif numeric)
  where o.commercial_id = p_commercial and o.structure = x.structure and o.annee = x.annee and x.ca is null and x.objectif is null;

  insert into public.objectifs (commercial_id, structure, annee, ca, objectif)
  select distinct on (x.structure, x.annee) p_commercial, x.structure, x.annee, x.ca, x.objectif
  from jsonb_to_recordset(p_chiffres) as x (structure text, annee integer, ca numeric, objectif numeric)
  where x.ca is not null or x.objectif is not null
  on conflict (commercial_id, structure, annee) do update set ca = excluded.ca, objectif = excluded.objectif
  where (public.objectifs.ca, public.objectifs.objectif) is distinct from (excluded.ca, excluded.objectif);
end;
$$;

-- Plus d'import Excel (D-012) : la carte est la source.
drop function public.apply_import(jsonb, uuid[]);

create or replace function public.save_commercial(p jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_structures text[] := array(select jsonb_array_elements_text(coalesce(p -> 'structures', '[]'::jsonb)));
  v_manager text;
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux admins' using errcode = '42501';
  end if;

  foreach v_manager in array array[nullif(btrim(p ->> 'manager1'), ''), nullif(btrim(p ->> 'manager2'), '')] loop
    if v_manager is not null then
      insert into public.managers (nom) values (v_manager) on conflict (nom) do nothing;
    end if;
  end loop;

  if v_id is null then
    insert into public.commerciaux (
      nom, statut, manager1, manager2, couleur, actif, notes, structures,
      jours_an, date_manager1, date_manager2, actions, secteur, ordre, telephone, email
    ) values (
      btrim(p ->> 'nom'),
      nullif(btrim(p ->> 'statut'), ''),
      nullif(btrim(p ->> 'manager1'), ''),
      nullif(btrim(p ->> 'manager2'), ''),
      coalesce(p ->> 'couleur', '#4363d8'),
      coalesce((p ->> 'actif')::boolean, true),
      nullif(p ->> 'notes', ''),
      v_structures,
      nullif(p ->> 'jours_an', '')::numeric,
      nullif(btrim(p ->> 'date_manager1'), ''),
      nullif(btrim(p ->> 'date_manager2'), ''),
      nullif(btrim(p ->> 'actions'), ''),
      nullif(btrim(p ->> 'secteur'), ''),
      coalesce((p ->> 'ordre')::integer, (select coalesce(max(ordre), 0) + 1 from public.commerciaux)),
      nullif(btrim(p ->> 'telephone'), ''),
      nullif(lower(btrim(p ->> 'email')), '')
    )
    returning id into v_id;
  else
    update public.commerciaux c set
      nom = case when p ? 'nom' then btrim(p ->> 'nom') else c.nom end,
      statut = case when p ? 'statut' then nullif(btrim(p ->> 'statut'), '') else c.statut end,
      manager1 = case when p ? 'manager1' then nullif(btrim(p ->> 'manager1'), '') else c.manager1 end,
      manager2 = case when p ? 'manager2' then nullif(btrim(p ->> 'manager2'), '') else c.manager2 end,
      couleur = case when p ? 'couleur' then p ->> 'couleur' else c.couleur end,
      actif = case when p ? 'actif' then (p ->> 'actif')::boolean else c.actif end,
      notes = case when p ? 'notes' then nullif(p ->> 'notes', '') else c.notes end,
      structures = case when p ? 'structures' then v_structures else c.structures end,
      jours_an = case when p ? 'jours_an' then nullif(p ->> 'jours_an', '')::numeric else c.jours_an end,
      date_manager1 = case when p ? 'date_manager1' then nullif(btrim(p ->> 'date_manager1'), '') else c.date_manager1 end,
      date_manager2 = case when p ? 'date_manager2' then nullif(btrim(p ->> 'date_manager2'), '') else c.date_manager2 end,
      actions = case when p ? 'actions' then nullif(btrim(p ->> 'actions'), '') else c.actions end,
      secteur = case when p ? 'secteur' then nullif(btrim(p ->> 'secteur'), '') else c.secteur end,
      ordre = case when p ? 'ordre' then (p ->> 'ordre')::integer else c.ordre end,
      telephone = case when p ? 'telephone' then nullif(btrim(p ->> 'telephone'), '') else c.telephone end,
      email = case when p ? 'email' then nullif(lower(btrim(p ->> 'email')), '') else c.email end
    where c.id = v_id;

    if not found then
      raise exception 'Commercial introuvable : %', v_id using errcode = 'P0002';
    end if;
  end if;

  if p ? 'affectations' then
    perform public.ecrire_zones(v_id, p -> 'affectations', array(select code from public.structures));
  end if;
  if p ? 'objectifs' then
    perform public.ecrire_chiffres(v_id, p -> 'objectifs');
  end if;

  return v_id;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 8. Le manager enregistre les départements, le CA et les objectifs d'un de ses commerciaux
-- ---------------------------------------------------------------------------------------------------

create function public.save_equipe(p_commercial uuid, p jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_moi text := public.mon_manager();
  v_commercial public.commerciaux;
  v_structures text[];
  v_hors text;
  v_conflit record;
begin
  if v_moi is null then
    raise exception 'Accès réservé aux managers' using errcode = '42501';
  end if;
  -- Deux managers qui prennent le même département en même temps passent l'un après l'autre
  perform pg_advisory_xact_lock(hashtext('gd-map:departements'));

  select * into v_commercial from public.commerciaux c where c.id = p_commercial for update;
  if not found or not public.gere(v_moi, v_commercial.manager1, v_commercial.manager2) then
    raise exception 'Ce commercial n''est pas dans votre équipe' using errcode = '42501';
  end if;

  -- Les structures du commercial que ce manager gère
  v_structures := array(
    select s from public.managers m, unnest(m.structures) as s
    where m.nom = v_moi and s = any (v_commercial.structures)
  );

  select x.structure into v_hors
  from (
    select y.structure from jsonb_to_recordset(case when jsonb_typeof(p -> 'affectations') = 'array' then p -> 'affectations' else '[]'::jsonb end) as y (structure text)
    union all
    select y.structure from jsonb_to_recordset(case when jsonb_typeof(p -> 'objectifs') = 'array' then p -> 'objectifs' else '[]'::jsonb end) as y (structure text)
  ) as x
  where x.structure is null or not (x.structure = any (v_structures))
  limit 1;
  if found then
    raise exception 'La structure % n''est pas dans votre périmètre pour ce commercial', coalesce(v_hors, '(vide)') using errcode = '42501';
  end if;

  if p ? 'affectations' then
    if jsonb_typeof(p -> 'affectations') <> 'array' then
      raise exception 'Liste de zones illisible' using errcode = '22023';
    end if;
    -- Un département ajouté ne doit pas être occupé par le commercial d'un autre manager ; ceux qu'il a
    -- déjà, il les garde. Paris se compare par arrondissement.
    select atome as zone, x.structure, autre.nom as commercial into v_conflit
    from jsonb_to_recordset(p -> 'affectations') as x (structure text, zone_code text)
    cross join lateral public.zones_atomes(x.zone_code) as atome
    join public.occupants(x.structure) o on o.zone = atome and o.commercial_id <> p_commercial
    join public.commerciaux autre on autre.id = o.commercial_id and not public.gere(v_moi, autre.manager1, autre.manager2)
    where not exists (
      select 1 from public.affectations a, public.zones_atomes(a.zone_code) as deja
      where a.commercial_id = p_commercial and a.structure = x.structure and deja = atome
    )
    order by x.structure, atome
    limit 1;
    if found then
      raise exception 'Le département % (%) est déjà occupé par %, d''un autre manager', v_conflit.zone, v_conflit.structure, v_conflit.commercial
        using errcode = 'P0001';
    end if;
    perform public.ecrire_zones(p_commercial, p -> 'affectations', v_structures);
  end if;

  if p ? 'objectifs' then
    perform public.ecrire_chiffres(p_commercial, p -> 'objectifs');
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 9. La carte : sans code pour un admin ou un manager, chiffres compris ; avec le code pour les autres
-- ---------------------------------------------------------------------------------------------------

create or replace function public.get_map_data(p_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role text := public.map_role();
  v_admin boolean := coalesce(v_role = 'admin', false);
  v_moi text := public.mon_manager();
  v_m1 boolean;
  v_m2 boolean;
  v_ip text := coalesce(nullif(current_setting('app.client_ip', true), ''), 'inconnue');
  v_hash text;
begin
  if v_role is null then
    delete from public.access_attempts where created_at < now() - interval '1 day';

    if (select count(*) from public.access_attempts
        where ip = v_ip and created_at > now() - interval '15 minutes') >= 10
      or (select count(*) from public.access_attempts
        where created_at > now() - interval '1 hour') >= 300 then
      return jsonb_build_object('ok', false, 'error', 'too_many_attempts');
    end if;

    select access_code_hash into v_hash from public.settings where id = 1;
    if v_hash is null then
      return jsonb_build_object('ok', false, 'error', 'not_configured');
    end if;

    if p_code is null or extensions.crypt(p_code, v_hash) is distinct from v_hash then
      insert into public.access_attempts (ip) values (v_ip);
      return jsonb_build_object('ok', false, 'error', 'invalid_code');
    end if;
  end if;

  select s.manager1_actif, s.manager2_actif into v_m1, v_m2 from public.settings s where s.id = 1;

  return jsonb_build_object(
    'ok', true,
    'admin', v_admin,
    -- Le CA et les objectifs sont dans la réponse : un admin, ou un manager (toutes les équipes)
    'chiffres', v_role is not null,
    'manager', (select jsonb_build_object('nom', m.nom, 'structures', m.structures) from public.managers m where m.nom = v_moi),
    'commerciaux', coalesce((
      select jsonb_agg(
        case when v_admin then to_jsonb(c) - 'created_at'
        else jsonb_build_object(
          'id', c.id, 'nom', c.nom, 'statut', c.statut,
          'manager1', case when v_m1 then c.manager1 end, 'manager2', case when v_m2 then c.manager2 end,
          'couleur', c.couleur, 'actif', c.actif, 'structures', c.structures, 'secteur', c.secteur, 'ordre', c.ordre,
          'telephone', c.telephone, 'email', c.email
        ) end
        order by c.ordre, c.nom)
      from public.commerciaux c
      where v_admin or c.actif or public.gere(v_moi, c.manager1, c.manager2)
    ), '[]'::jsonb),
    'affectations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'commercial_id', a.commercial_id, 'structure', a.structure,
        'zone_code', a.zone_code, 'couverture', a.couverture))
      from public.affectations a
      join public.commerciaux c on c.id = a.commercial_id
      where v_admin or c.actif or public.gere(v_moi, c.manager1, c.manager2)
    ), '[]'::jsonb),
    'objectifs', case when v_role is not null then coalesce((
      select jsonb_agg(to_jsonb(o) order by o.annee, o.structure)
      from public.objectifs o
      join public.commerciaux c on c.id = o.commercial_id
      where v_admin or c.actif or public.gere(v_moi, c.manager1, c.manager2)
    ), '[]'::jsonb) else '[]'::jsonb end,
    'a_recruter', coalesce((
      select jsonb_agg(jsonb_build_object('structure', r.structure, 'zone_code', r.zone_code, 'priorite', r.priorite, 'secteur', r.secteur) order by r.structure, r.zone_code)
      from public.a_recruter r
    ), '[]'::jsonb),
    'managers', coalesce((
      select jsonb_agg(
        jsonb_build_object('nom', m.nom, 'couleur', m.couleur, 'telephone', m.telephone, 'email', m.email)
        || case when v_admin then jsonb_build_object('structures', m.structures, 'compte', m.compte) else '{}'::jsonb end
        order by m.nom)
      from public.managers m
    ), '[]'::jsonb),
    'structures', coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'nom', s.nom, 'ordre', s.ordre) order by s.ordre, s.code)
      from public.structures s
    ), '[]'::jsonb),
    'settings', (
      select jsonb_build_object('default_shared_mode', s.default_shared_mode, 'manager1_actif', s.manager1_actif, 'manager2_actif', s.manager2_actif)
      from public.settings s where s.id = 1
    ),
    'updated_at', (select max(updated_at) from public.commerciaux)
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 10. Droits d'exécution
-- ---------------------------------------------------------------------------------------------------

-- Internes : appelées par les déclencheurs et les fonctions ci-dessus, jamais par l'API
revoke execute on function
  public.pourvoir(text, text), public.affectations_pourvoir(), public.commerciaux_pourvoir(),
  public.noter(text, text, uuid, text, text, text, integer, jsonb, jsonb),
  public.journaliser(), public.journaliser_retrait_commercial(), public.journaliser_reglages()
from public, anon, authenticated;

revoke execute on function
  public.set_managers_actifs(boolean, boolean), public.map_role(), public.mon_manager(), public.gere(text, text, text),
  public.rename_manager(text, text), public.list_acces(), public.zones_atomes(text), public.occupants(text),
  public.set_recrutement(text, jsonb), public.est_a_recruter(text, text), public.convertir_a_recruter(uuid[]),
  public.get_journal(bigint, integer, uuid), public.ecrire_zones(uuid, jsonb, text[]), public.ecrire_chiffres(uuid, jsonb),
  public.save_commercial(jsonb), public.save_equipe(uuid, jsonb)
from public, anon;
grant execute on function
  public.set_managers_actifs(boolean, boolean), public.map_role(), public.mon_manager(),
  public.rename_manager(text, text), public.list_acces(), public.zones_atomes(text), public.occupants(text),
  public.set_recrutement(text, jsonb), public.est_a_recruter(text, text), public.convertir_a_recruter(uuid[]),
  public.get_journal(bigint, integer, uuid), public.ecrire_zones(uuid, jsonb, text[]), public.ecrire_chiffres(uuid, jsonb),
  public.save_commercial(jsonb), public.save_equipe(uuid, jsonb)
to authenticated;
-- gere() et occupants() sont lues par des fonctions `security definer` ; occupants() aussi par set_recrutement
revoke execute on function public.gere(text, text, text) from authenticated;
revoke execute on function public.get_map_data(text) from public;
grant execute on function public.get_map_data(text) to anon, authenticated;
