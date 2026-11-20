-- Accès nominatifs (D-009) : la carte se lit avec le code d'accès ; le portail GD One ne sert qu'aux
-- personnes nommées dans `acces`. Un admin gère tout ; un responsable saisit le CA et les objectifs des
-- commerciaux de ses managers (Manager 1 ou Manager 2), rien d'autre.

-- ---------------------------------------------------------------------------------------------------
-- 1. Le périmètre d'un responsable : des managers qui existent, et rien pour un admin
-- ---------------------------------------------------------------------------------------------------

alter table public.acces
  add constraint acces_managers_check check (role = 'responsable' or managers = '{}');

-- Chaque manager du périmètre doit exister ; la liste est rangée, sans doublon ni espaces.
create function public.acces_check_managers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_unknown text;
begin
  new.managers := coalesce(
    array(select distinct btrim(m) from unnest(new.managers) as m where btrim(m) <> '' order by 1),
    '{}'
  );
  select m into v_unknown
  from unnest(new.managers) as m
  where not exists (select 1 from public.managers where nom = m)
  limit 1;
  if v_unknown is not null then
    raise exception 'Manager inconnu : %', v_unknown using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger acces_check_managers
before insert or update of managers on public.acces
for each row execute function public.acces_check_managers();

-- Renommer un manager le renomme dans les périmètres ; le supprimer l'en retire.
create function public.acces_follow_managers()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' then
    update public.acces set managers = array_replace(managers, old.nom, new.nom) where old.nom = any (managers);
    return new;
  end if;
  update public.acces set managers = array_remove(managers, old.nom) where old.nom = any (managers);
  return old;
end;
$$;

create trigger managers_follow_in_acces
after update of nom or delete on public.managers
for each row execute function public.acces_follow_managers();

-- Fusion de deux managers : les périmètres qui citaient l'ancien citent désormais celui qui reste.
-- `security definer` pour toucher `acces` (dont un admin ne modifie pas sa propre ligne) : le contrôle
-- d'admin, en tête, reste la seule porte.
create or replace function public.rename_manager(p_old text, p_new text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new text := btrim(p_new);
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
    update public.managers m
    set telephone = coalesce(m.telephone, o.telephone), email = coalesce(m.email, o.email)
    from public.managers o
    where m.nom = v_new and o.nom = p_old;
    update public.commerciaux set manager1 = v_new where manager1 = p_old;
    update public.commerciaux set manager2 = v_new where manager2 = p_old;
    update public.acces set managers = array_replace(managers, p_old, v_new) where p_old = any (managers);
    delete from public.managers where nom = p_old;
  else
    update public.managers set nom = v_new where nom = p_old;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 2. Qui est connecté : son rôle, et l'équipe d'un responsable
-- ---------------------------------------------------------------------------------------------------

-- 'admin', 'responsable', ou null (pas de rôle, ou plus de droit d'usage sur le portail).
create function public.map_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select a.role
  from public."user" u
  join public.acces a on a.email = lower(u.email)
  where u.id = (select auth.uid()) and coalesce(u."hasAccess", false);
$$;

-- Managers du responsable connecté ; null pour tout autre.
create function public.team_managers()
returns text[]
language sql
stable
security definer
set search_path = ''
as $$
  select a.managers
  from public."user" u
  join public.acces a on a.email = lower(u.email)
  where u.id = (select auth.uid()) and coalesce(u."hasAccess", false) and a.role = 'responsable';
$$;

-- Le droit d'usage du portail ne suffit plus pour lire la carte sans code : il faut un rôle.
drop function public.has_map_access();

-- ---------------------------------------------------------------------------------------------------
-- 3. La carte : sans code pour un admin ou un responsable, avec le code pour tous les autres
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

  return jsonb_build_object(
    'ok', true,
    'admin', v_admin,
    'commerciaux', coalesce((
      select jsonb_agg(
        case when v_admin then to_jsonb(c) - 'created_at'
        else jsonb_build_object(
          'id', c.id, 'nom', c.nom, 'statut', c.statut, 'manager1', c.manager1, 'manager2', c.manager2,
          'couleur', c.couleur, 'actif', c.actif, 'structures', c.structures, 'secteur', c.secteur, 'ordre', c.ordre,
          'telephone', c.telephone, 'email', c.email
        ) end
        order by c.ordre, c.nom)
      from public.commerciaux c
      where v_admin or c.actif
    ), '[]'::jsonb),
    'affectations', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', a.id, 'commercial_id', a.commercial_id, 'structure', a.structure,
        'zone_code', a.zone_code, 'couverture', a.couverture))
      from public.affectations a
      join public.commerciaux c on c.id = a.commercial_id
      where v_admin or c.actif
    ), '[]'::jsonb),
    -- CA et objectifs : réservés aux admins sur la carte (un responsable saisit ceux de son équipe à part)
    'objectifs', case when v_admin then coalesce((
      select jsonb_agg(to_jsonb(o) order by o.annee, o.structure)
      from public.objectifs o
    ), '[]'::jsonb) else '[]'::jsonb end,
    'managers', coalesce((
      select jsonb_agg(jsonb_build_object('nom', m.nom, 'couleur', m.couleur, 'telephone', m.telephone, 'email', m.email) order by m.nom)
      from public.managers m
    ), '[]'::jsonb),
    'structures', coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'nom', s.nom, 'ordre', s.ordre) order by s.ordre, s.code)
      from public.structures s
    ), '[]'::jsonb),
    'settings', (select jsonb_build_object('default_shared_mode', s.default_shared_mode) from public.settings s where s.id = 1),
    'updated_at', (select max(updated_at) from public.commerciaux)
  );
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 4. Les chiffres de l'équipe d'un responsable
-- ---------------------------------------------------------------------------------------------------

-- Ses commerciaux (Manager 1 ou Manager 2 dans son périmètre, actifs ou non), leurs CA et objectifs.
create function public.get_equipe()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_managers text[] := public.team_managers();
begin
  if v_managers is null then
    raise exception 'Accès réservé aux responsables' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'managers', to_jsonb(v_managers),
    'commerciaux', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', c.id, 'nom', c.nom, 'statut', c.statut, 'manager1', c.manager1, 'manager2', c.manager2,
        'couleur', c.couleur, 'actif', c.actif, 'structures', c.structures
      ) order by c.actif desc, c.ordre, c.nom)
      from public.commerciaux c
      where c.manager1 = any (v_managers) or c.manager2 = any (v_managers)
    ), '[]'::jsonb),
    'objectifs', coalesce((
      select jsonb_agg(to_jsonb(o) order by o.annee, o.structure)
      from public.objectifs o
      join public.commerciaux c on c.id = o.commercial_id
      where c.manager1 = any (v_managers) or c.manager2 = any (v_managers)
    ), '[]'::jsonb),
    'structures', coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'nom', s.nom, 'ordre', s.ordre) order by s.ordre, s.code)
      from public.structures s
    ), '[]'::jsonb)
  );
end;
$$;

-- CA et objectifs d'un commercial de son équipe : seules les lignes envoyées changent, et une ligne
-- vidée (CA et objectif vides) disparaît. Rien d'autre du commercial n'est modifiable ici.
create function public.save_objectifs_equipe(p_commercial uuid, p_objectifs jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_managers text[] := public.team_managers();
begin
  if v_managers is null then
    raise exception 'Accès réservé aux responsables' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.commerciaux c
    where c.id = p_commercial and (c.manager1 = any (v_managers) or c.manager2 = any (v_managers))
  ) then
    raise exception 'Ce commercial n''est pas dans votre équipe' using errcode = '42501';
  end if;
  if jsonb_typeof(p_objectifs) is distinct from 'array' then
    raise exception 'Liste de CA et objectifs illisible' using errcode = '22023';
  end if;

  insert into public.objectifs (commercial_id, structure, annee, ca, objectif)
  select p_commercial, x.structure, x.annee, x.ca, x.objectif
  from jsonb_to_recordset(p_objectifs) as x (structure text, annee integer, ca numeric, objectif numeric)
  on conflict (commercial_id, structure, annee) do update set ca = excluded.ca, objectif = excluded.objectif;

  delete from public.objectifs where commercial_id = p_commercial and ca is null and objectif is null;
end;
$$;

-- ---------------------------------------------------------------------------------------------------
-- 5. Page Paramètres : « Accès à la carte » ne veut plus dire lecture, seulement droit d'usage
-- ---------------------------------------------------------------------------------------------------

-- (list_acces est inchangée : `has_access` reste le droit d'usage du portail, sans lequel un rôle ne
-- donne rien.)

-- ---------------------------------------------------------------------------------------------------
-- 6. Droits d'exécution
-- ---------------------------------------------------------------------------------------------------

revoke execute on function public.acces_check_managers(), public.acces_follow_managers() from public, anon, authenticated;
revoke execute on function public.rename_manager(text, text) from public, anon;
grant execute on function public.rename_manager(text, text) to authenticated;
revoke execute on function public.map_role(), public.team_managers(), public.get_equipe(), public.save_objectifs_equipe(uuid, jsonb) from public, anon;
grant execute on function public.map_role(), public.team_managers(), public.get_equipe(), public.save_objectifs_equipe(uuid, jsonb) to authenticated;
revoke execute on function public.get_map_data(text) from public;
grant execute on function public.get_map_data(text) to anon, authenticated;
