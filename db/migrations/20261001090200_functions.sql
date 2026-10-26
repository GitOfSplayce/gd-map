-- Carte commerciale Groupe : fonctions appelées par le site

-- Lecture de la carte avec le code d'accès (ou sans code pour un admin connecté).
-- Renvoie {ok:false, error} plutôt que de lever une erreur, pour que l'essai raté soit bien enregistré.
create function public.get_map_data(p_code text default null)
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

    -- 10 essais ratés par IP sur 15 min, 300 essais ratés au total sur 1 h
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

  -- Avec le code : uniquement les commerciaux actifs et les champs utiles à la carte.
  -- Les notes, actions, dates et jours/an restent réservés aux admins.
  return jsonb_build_object(
    'ok', true,
    'admin', v_admin,
    'commerciaux', coalesce((
      select jsonb_agg(
        case when v_admin then to_jsonb(c) - 'created_at'
        else jsonb_build_object(
          'id', c.id, 'nom', c.nom, 'statut', c.statut, 'manager1', c.manager1, 'manager2', c.manager2,
          'couleur', c.couleur, 'actif', c.actif, 'structures', c.structures, 'secteur', c.secteur, 'ordre', c.ordre
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
    'objectifs', coalesce((
      select jsonb_agg(to_jsonb(o))
      from public.objectifs o
      join public.commerciaux c on c.id = o.commercial_id
      where v_admin or c.actif
    ), '[]'::jsonb),
    'updated_at', (select max(updated_at) from public.commerciaux)
  );
end;
$$;

create function public.get_access_status()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux admins' using errcode = '42501';
  end if;
  return (
    select jsonb_build_object(
      'configured', s.access_code_hash is not null,
      'updated_at', s.access_code_updated_at,
      'updated_by', (select email from public.admins where user_id = s.access_code_updated_by)
    )
    from public.settings s where s.id = 1
  );
end;
$$;

create function public.set_access_code(p_code text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux admins' using errcode = '42501';
  end if;
  if p_code is null or char_length(btrim(p_code)) < 6 then
    raise exception 'Le code doit contenir au moins 6 caractères' using errcode = '22023';
  end if;

  update public.settings
  set access_code_hash = extensions.crypt(p_code, extensions.gen_salt('bf', 10)),
      access_code_updated_at = now(),
      access_code_updated_by = auth.uid()
  where id = 1;

  delete from public.access_attempts;
end;
$$;

-- Crée ou met à jour un commercial, avec ses affectations et objectifs, en une transaction.
-- Seules les clés présentes dans p sont modifiées. Si p contient "affectations",
-- elles remplacent toutes les affectations du commercial.
create function public.save_commercial(p jsonb)
returns uuid
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid := nullif(p ->> 'id', '')::uuid;
  v_structures text[] := array(select jsonb_array_elements_text(coalesce(p -> 'structures', '[]'::jsonb)));
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux admins' using errcode = '42501';
  end if;

  if v_id is null then
    insert into public.commerciaux (
      nom, statut, manager1, manager2, couleur, actif, notes, structures,
      jours_an, date_manager1, date_manager2, actions, secteur, ordre
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
      coalesce((p ->> 'ordre')::integer, (select coalesce(max(ordre), 0) + 1 from public.commerciaux))
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
      ordre = case when p ? 'ordre' then (p ->> 'ordre')::integer else c.ordre end
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

-- Import Excel : suppressions puis créations / mises à jour, le tout en une transaction.
create function public.apply_import(p_items jsonb, p_delete_ids uuid[] default '{}')
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_item jsonb;
  v_saved integer := 0;
  v_deleted integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux admins' using errcode = '42501';
  end if;

  delete from public.commerciaux where id = any (coalesce(p_delete_ids, '{}'));
  get diagnostics v_deleted = row_count;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    perform public.save_commercial(v_item);
    v_saved := v_saved + 1;
  end loop;

  return jsonb_build_object('saved', v_saved, 'deleted', v_deleted);
end;
$$;

-- Appelée par le workflow GitHub "keepalive" pour éviter la mise en pause du projet (plan Free).
create function public.ping()
returns text
language sql
stable
set search_path = ''
as $$
  select 'ok'::text;
$$;

-- Droits d'exécution : tout est fermé, puis ouvert fonction par fonction.
revoke execute on all functions in schema public from public, anon, authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.get_map_data(text) to anon, authenticated;
grant execute on function public.ping() to anon, authenticated;
grant execute on function public.get_access_status() to authenticated;
grant execute on function public.set_access_code(text) to authenticated;
grant execute on function public.save_commercial(jsonb) to authenticated;
grant execute on function public.apply_import(jsonb, uuid[]) to authenticated;
