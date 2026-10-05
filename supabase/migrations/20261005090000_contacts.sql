-- Téléphone et e-mail des commerciaux et des managers, visibles sur la carte avec le code d'accès
-- (choix validé : utiles pour joindre le commercial d'un secteur).
-- Contrôles légers ici ; la saisie et l'import les mettent en forme et écartent les valeurs illisibles avant d'arriver là.

alter table public.commerciaux
  add column telephone text check (telephone ~ '^[0-9+() .-]{6,25}$'),
  add column email text check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

alter table public.managers
  add column telephone text check (telephone ~ '^[0-9+() .-]{6,25}$'),
  add column email text check (email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$');

-- save_commercial : enregistre aussi le téléphone et l'e-mail (e-mail en minuscules)
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
    delete from public.affectations where commercial_id = v_id;
    insert into public.affectations (commercial_id, structure, zone_code, couverture)
    select v_id, x.structure, x.zone_code, coalesce(x.couverture, 'propre')
    from jsonb_to_recordset(p -> 'affectations') as x (structure text, zone_code text, couverture text)
    on conflict (commercial_id, structure, zone_code) do update set couverture = excluded.couverture;
  end if;

  if p ? 'objectifs' then
    insert into public.objectifs (commercial_id, structure, annee, ca, objectif)
    select v_id, x.structure, x.annee, x.ca, x.objectif
    from jsonb_to_recordset(p -> 'objectifs') as x (structure text, annee integer, ca numeric, objectif numeric)
    on conflict (commercial_id, structure, annee) do update set ca = excluded.ca, objectif = excluded.objectif;

    delete from public.objectifs where commercial_id = v_id and ca is null and objectif is null;
  end if;

  return v_id;
end;
$$;

-- rename_manager : en cas de fusion, le manager gardé reprend le téléphone et l'e-mail qui lui manquent
create or replace function public.rename_manager(p_old text, p_new text)
returns void
language plpgsql
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
    delete from public.managers where nom = p_old;
  else
    update public.managers set nom = v_new where nom = p_old;
  end if;
end;
$$;

-- get_map_data : téléphone et e-mail des commerciaux et des managers, avec ou sans compte admin
create or replace function public.get_map_data(p_code text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_admin boolean := public.is_admin();
  v_headers json := nullif(current_setting('request.headers', true), '')::json;
  v_ip text;
  v_hash text;
begin
  if not v_admin then
    v_ip := coalesce(
      v_headers ->> 'cf-connecting-ip',
      nullif(btrim(split_part(v_headers ->> 'x-forwarded-for', ',', 1)), ''),
      'inconnue'
    );

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
    -- CA et objectifs : réservés aux admins (jamais envoyés avec le seul code d'accès)
    'objectifs', case when v_admin then coalesce((
      select jsonb_agg(to_jsonb(o) order by o.annee, o.structure)
      from public.objectifs o
    ), '[]'::jsonb) else '[]'::jsonb end,
    'managers', coalesce((
      select jsonb_agg(jsonb_build_object('nom', m.nom, 'couleur', m.couleur, 'telephone', m.telephone, 'email', m.email) order by m.nom)
      from public.managers m
    ), '[]'::jsonb),
    -- Structures du groupe, dans l'ordre choisi par les admins (onglets de la carte)
    'structures', coalesce((
      select jsonb_agg(jsonb_build_object('code', s.code, 'nom', s.nom, 'ordre', s.ordre) order by s.ordre, s.code)
      from public.structures s
    ), '[]'::jsonb),
    -- Réglages d'affichage choisis par les admins (sans rien de sensible)
    'settings', (select jsonb_build_object('default_shared_mode', s.default_shared_mode) from public.settings s where s.id = 1),
    'updated_at', (select max(updated_at) from public.commerciaux)
  );
end;
$$;

revoke execute on function public.save_commercial(jsonb) from public, anon;
grant execute on function public.save_commercial(jsonb) to authenticated;
revoke execute on function public.rename_manager(text, text) from public, anon;
grant execute on function public.rename_manager(text, text) to authenticated;
revoke execute on function public.get_map_data(text) from public;
grant execute on function public.get_map_data(text) to anon, authenticated;
