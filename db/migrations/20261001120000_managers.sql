-- Managers : liste gérée dans l'admin (onglet Managers), avec leur couleur pour la carte.
-- commerciaux.manager1 / manager2 restent des noms (fichier Excel inchangé) mais référencent cette table :
-- renommer un manager met à jour ses commerciaux, le supprimer les laisse sans manager.

create table public.managers (
  nom text primary key check (btrim(nom) <> '' and nom = btrim(nom)),
  couleur text check (couleur ~ '^#[0-9a-fA-F]{6}$'),
  created_at timestamptz not null default now()
);

-- Couleurs de départ : même palette que celle utilisée jusqu'ici par la carte, dans l'ordre alphabétique
with noms as (
  select distinct btrim(n) as nom
  from public.commerciaux, unnest(array[manager1, manager2]) as n
  where n is not null and btrim(n) <> ''
),
palette as (
  select array[
    '#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#17becf',
    '#bcbd22', '#393b79', '#ad494a', '#637939'
  ] as couleurs
)
insert into public.managers (nom, couleur)
select nom, couleurs[1 + (row_number() over (order by nom) - 1)::int % 12]
from noms, palette;

update public.commerciaux set manager1 = btrim(manager1) where manager1 <> btrim(manager1);
update public.commerciaux set manager2 = btrim(manager2) where manager2 <> btrim(manager2);

alter table public.commerciaux
  add constraint commerciaux_manager1_fkey foreign key (manager1) references public.managers (nom)
    on update cascade on delete set null,
  add constraint commerciaux_manager2_fkey foreign key (manager2) references public.managers (nom)
    on update cascade on delete set null;

alter table public.managers enable row level security;
revoke all on public.managers from anon;
grant select, insert, update, delete on public.managers to authenticated;
grant all on public.managers to service_role;

create policy "Admins : gestion des managers"
  on public.managers for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Renomme un manager ; si le nouveau nom existe déjà, les deux sont fusionnés.
create function public.rename_manager(p_old text, p_new text)
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
    update public.commerciaux set manager1 = v_new where manager1 = p_old;
    update public.commerciaux set manager2 = v_new where manager2 = p_old;
    delete from public.managers where nom = p_old;
  else
    update public.managers set nom = v_new where nom = p_old;
  end if;
end;
$$;

-- save_commercial : crée à la volée les managers inconnus (saisie libre, import Excel)
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

-- get_map_data : ajoute la liste des managers (nom et couleur, visibles avec le code comme sur la carte)
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
    'managers', coalesce((
      select jsonb_agg(jsonb_build_object('nom', m.nom, 'couleur', m.couleur) order by m.nom)
      from public.managers m
    ), '[]'::jsonb),
    'updated_at', (select max(updated_at) from public.commerciaux)
  );
end;
$$;

revoke execute on function public.rename_manager(text, text) from public, anon;
grant execute on function public.rename_manager(text, text) to authenticated;
revoke execute on function public.save_commercial(jsonb) from public, anon;
grant execute on function public.save_commercial(jsonb) to authenticated;
revoke execute on function public.get_map_data(text) from public;
grant execute on function public.get_map_data(text) to anon, authenticated;
