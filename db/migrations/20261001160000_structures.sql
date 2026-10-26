-- Structures (MD, SP, MC, BK…) : liste gérée dans l'admin (onglet Structures) au lieu d'être fixée dans le code.
-- Le code sert d'onglet sur la carte et de suffixe aux colonnes Excel (« DPT MD », « CA MD »…).

create table public.structures (
  code text primary key check (code ~ '^[A-Z][A-Z0-9]{1,5}$' and code <> 'ALL'),
  nom text not null check (btrim(nom) <> '' and nom = btrim(nom)),
  ordre integer not null default 0,
  created_at timestamptz not null default now()
);

insert into public.structures (code, nom, ordre) values
  ('MD', 'Maison Davoise', 1),
  ('SP', 'Splayce', 2),
  ('MC', 'MaucoCartex', 3),
  ('BK', 'BK Event', 4);

-- Les listes fixes laissent la place à des clés étrangères : renommer un code suit partout,
-- supprimer une structure supprime ses zones et ses CA/objectifs.
alter table public.affectations
  drop constraint affectations_structure_check,
  add constraint affectations_structure_fkey foreign key (structure) references public.structures (code)
    on update cascade on delete cascade;

alter table public.objectifs
  drop constraint objectifs_structure_check,
  add constraint objectifs_structure_fkey foreign key (structure) references public.structures (code)
    on update cascade on delete cascade;

alter table public.commerciaux drop constraint commerciaux_structures_check;

-- commerciaux.structures est un tableau (pas de clé étrangère possible) : contrôle par déclencheur
create function public.check_commercial_structures()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_unknown text;
begin
  select s into v_unknown
  from unnest(new.structures) as s
  where not exists (select 1 from public.structures st where st.code = s)
  limit 1;
  if v_unknown is not null then
    raise exception 'Structure inconnue : %', v_unknown using errcode = '23503';
  end if;
  return new;
end;
$$;

create trigger commerciaux_check_structures
before insert or update of structures on public.commerciaux
for each row execute function public.check_commercial_structures();

-- Code renommé ou structure supprimée : les commerciaux suivent
create function public.sync_commercial_structures()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    update public.commerciaux set structures = array_remove(structures, old.code) where old.code = any (structures);
    return old;
  end if;
  if new.code <> old.code then
    update public.commerciaux set structures = array_replace(structures, old.code, new.code) where old.code = any (structures);
  end if;
  return new;
end;
$$;

create trigger structures_sync_commerciaux
after update of code or delete on public.structures
for each row execute function public.sync_commercial_structures();

alter table public.structures enable row level security;
revoke all on public.structures from anon;
grant select, insert, update, delete on public.structures to authenticated;
grant all on public.structures to service_role;

create policy "Admins : gestion des structures"
  on public.structures for all to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

-- Nouvel ordre des structures (onglets de la carte, colonnes de l'export), en une fois
create function public.reorder_structures(p_codes text[])
returns void
language plpgsql
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux admins' using errcode = '42501';
  end if;
  update public.structures s
  set ordre = x.ord
  from unnest(p_codes) with ordinality as x (code, ord)
  where s.code = x.code;
end;
$$;

-- get_map_data : ajoute la liste des structures (code, nom, ordre ; visibles avec le code comme les onglets)
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
    -- CA et objectifs : réservés aux admins (jamais envoyés avec le seul code d'accès)
    'objectifs', case when v_admin then coalesce((
      select jsonb_agg(to_jsonb(o) order by o.annee, o.structure)
      from public.objectifs o
    ), '[]'::jsonb) else '[]'::jsonb end,
    'managers', coalesce((
      select jsonb_agg(jsonb_build_object('nom', m.nom, 'couleur', m.couleur) order by m.nom)
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

revoke execute on function public.check_commercial_structures() from public, anon;
revoke execute on function public.sync_commercial_structures() from public, anon;
revoke execute on function public.reorder_structures(text[]) from public, anon;
grant execute on function public.reorder_structures(text[]) to authenticated;
revoke execute on function public.get_map_data(text) from public;
grant execute on function public.get_map_data(text) to anon, authenticated;
