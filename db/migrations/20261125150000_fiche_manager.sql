-- La fiche d'un manager (D-013) : un manager peut aussi être un commercial. Reliée à lui, sa fiche fait
-- partie de son équipe : il modifie ses propres départements, son CA et ses objectifs, et ils comptent
-- pour lui sur la carte et dans la synthèse. Le manager de sa fiche (Manager 1 ou 2) garde ses droits dessus.

alter table public.managers
  add column commercial_id uuid references public.commerciaux (id) on delete set null;

create unique index managers_commercial_key on public.managers (commercial_id);

-- Point de départ : le même nom, quels que soient l'ordre des mots, la casse et les accents
create or replace function pg_temp.mots(s text)
returns text[]
language sql
immutable
as $$
  select array(
    select w
    from regexp_split_to_table(
      lower(translate(s, 'ÀÁÂÃÄÅàáâãäåÇçÈÉÊËèéêëÌÍÎÏìíîïÑñÒÓÔÕÖòóôõöÙÚÛÜùúûüÝýÿ', 'AAAAAAaaaaaaCcEEEEeeeeIIIIiiiiNnOOOOOoooooUUUUuuuuYyy')),
      '[^a-z]+'
    ) as w
    where w <> ''
    order by w
  )
$$;

with paires as (
  select m.nom, c.id, count(*) over (partition by m.nom) as par_manager, count(*) over (partition by c.id) as par_fiche
  from public.managers m
  join public.commerciaux c on pg_temp.mots(c.nom) = pg_temp.mots(m.nom)
)
update public.managers m
set commercial_id = p.id
from paires p
where p.nom = m.nom and p.par_manager = 1 and p.par_fiche = 1;

drop function pg_temp.mots(text);

-- Ce manager gère-t-il ce commercial ? Le sien par Manager 1 ou Manager 2 (ceux qui sont actifs), ou sa fiche.
drop function public.gere(text, text, text);
create function public.gere(p_manager text, p_commercial uuid, p_manager1 text, p_manager2 text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce((s.manager1_actif and p_manager1 = p_manager) or (s.manager2_actif and p_manager2 = p_manager), false)
    or exists (select 1 from public.managers m where m.nom = p_manager and m.commercial_id = p_commercial)
  from public.settings s where s.id = 1;
$$;

revoke execute on function public.gere(text, uuid, text, text) from public, anon, authenticated;

-- Fusion de deux managers : celui qui reste prend le contact, le compte, la fiche et les structures de l'autre.
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
    update public.managers set compte = null, commercial_id = null where nom = p_old;
    update public.managers m
    set telephone = coalesce(m.telephone, v_old.telephone),
        email = coalesce(m.email, v_old.email),
        compte = coalesce(m.compte, v_old.compte),
        commercial_id = coalesce(m.commercial_id, v_old.commercial_id),
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

-- Le journal suit aussi la fiche d'un manager.
create or replace function public.journaliser()
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

  -- La fiche d'un manager s'écrit par le nom du commercial, plus lisible que son identifiant
  if v_objet = 'manager' then
    v_old := v_old || jsonb_build_object('fiche', (select c.nom from public.commerciaux c where c.id = (v_old ->> 'commercial_id')::uuid));
    v_new := v_new || jsonb_build_object('fiche', (select c.nom from public.commerciaux c where c.id = (v_new ->> 'commercial_id')::uuid));
  end if;

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

drop trigger journal_managers on public.managers;
create trigger journal_managers
after insert or update or delete on public.managers
for each row execute function public.journaliser('manager', '{nom,couleur,telephone,email,structures,compte,fiche}');

-- Les trois fonctions qui disent qui gère qui : la fiche d'un manager en plus.
-- Journal par pages d'enregistrements (`lot` et son heure : un même enregistrement n'est jamais coupé en
-- deux), avec une recherche sur tout ce que la personne peut lire.
drop function public.get_journal(bigint, integer, uuid);
create function public.get_journal(p_page integer default 1, p_taille integer default 20, p_recherche text default null, p_commercial uuid default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_role text := public.map_role();
  v_moi text := public.mon_manager();
  v_taille integer := least(greatest(coalesce(p_taille, 20), 1), 500);
  v_page integer := greatest(coalesce(p_page, 1), 1);
  v_reserves text[] := '{notes,jours_an,date_manager1,date_manager2,actions}';
  v_motif text := nullif(btrim(p_recherche), '');
  v_total integer;
  v_lignes jsonb;
begin
  if v_role is null then
    raise exception 'Accès réservé aux admins et aux managers' using errcode = '42501';
  end if;
  -- Le texte cherché est pris tel quel : ni % ni _ n'y sont des jokers
  if v_motif is not null then
    v_motif := '%' || replace(replace(replace(v_motif, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;

  with visibles as materialized (
    select j.id, j.le, j.lot, j.auteur, j.auteur_nom, j.objet, j.action, j.commercial_id, j.nom, j.structure, j.zone_code, j.annee,
      case when v_role = 'admin' then j.avant else j.avant - v_reserves end as avant,
      case when v_role = 'admin' then j.apres else j.apres - v_reserves end as apres
    from public.journal j
    where (p_commercial is null or j.commercial_id = p_commercial)
      and (
        v_role = 'admin'
        or (
          exists (
            select 1 from public.commerciaux c
            where c.id = j.commercial_id and public.gere(v_moi, c.id, c.manager1, c.manager2)
          )
          -- Un changement qui ne touche que des champs réservés ne le regarde pas
          and (j.action <> 'modification' or coalesce(j.apres - v_reserves, '{}'::jsonb) <> '{}'::jsonb)
        )
      )
  ),
  lots as (
    select v.lot, v.le, max(v.id) as dernier
    from visibles v
    left join public.zones z on z.code = v.zone_code
    where v_motif is null
      or concat_ws(' ', v.nom, v.auteur, v.auteur_nom, v.structure, v.zone_code, z.nom, v.annee, v.avant::text, v.apres::text) ilike v_motif
    group by v.lot, v.le
  ),
  une_page as (
    select l.lot, l.le from lots l order by l.dernier desc limit v_taille offset (v_page - 1) * v_taille
  )
  select
    (select count(*) from lots),
    coalesce((select jsonb_agg(to_jsonb(v) order by v.id desc) from visibles v join une_page u on u.lot = v.lot and u.le = v.le), '[]'::jsonb)
  into v_total, v_lignes;

  return jsonb_build_object('lignes', v_lignes, 'total', v_total, 'page', v_page, 'taille', v_taille);
end;
$$;

revoke execute on function public.get_journal(integer, integer, text, uuid) from public, anon;
grant execute on function public.get_journal(integer, integer, text, uuid) to authenticated;

create or replace function public.save_equipe(p_commercial uuid, p jsonb)
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
  if not found or not public.gere(v_moi, v_commercial.id, v_commercial.manager1, v_commercial.manager2) then
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
    join public.commerciaux autre on autre.id = o.commercial_id and not public.gere(v_moi, autre.id, autre.manager1, autre.manager2)
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
      where v_admin or c.actif or public.gere(v_moi, c.id, c.manager1, c.manager2)
    ), '[]'::jsonb),
    'affectations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'commercial_id', a.commercial_id, 'structure', a.structure,
        'zone_code', a.zone_code, 'couverture', a.couverture))
      from public.affectations a
      join public.commerciaux c on c.id = a.commercial_id
      where v_admin or c.actif or public.gere(v_moi, c.id, c.manager1, c.manager2)
    ), '[]'::jsonb),
    'objectifs', case when v_role is not null then coalesce((
      select jsonb_agg(to_jsonb(o) order by o.annee, o.structure)
      from public.objectifs o
      join public.commerciaux c on c.id = o.commercial_id
      where v_admin or c.actif or public.gere(v_moi, c.id, c.manager1, c.manager2)
    ), '[]'::jsonb) else '[]'::jsonb end,
    'a_recruter', coalesce((
      select jsonb_agg(jsonb_build_object('structure', r.structure, 'zone_code', r.zone_code, 'priorite', r.priorite, 'secteur', r.secteur) order by r.structure, r.zone_code)
      from public.a_recruter r
    ), '[]'::jsonb),
    'managers', coalesce((
      select jsonb_agg(
        jsonb_build_object('nom', m.nom, 'couleur', m.couleur, 'telephone', m.telephone, 'email', m.email, 'commercial_id', m.commercial_id)
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
