-- Mode d'affichage des zones partagées choisi par les admins pour tout le monde (modifiable ensuite par chacun).
alter table public.settings
  add column default_shared_mode text not null default 'rayures'
    check (default_shared_mode in ('rayures', 'decoupage', 'camemberts', 'dominante'));

create function public.set_default_shared_mode(p_mode text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Accès réservé aux admins' using errcode = '42501';
  end if;
  if p_mode is null or p_mode not in ('rayures', 'decoupage', 'camemberts', 'dominante') then
    raise exception 'Mode inconnu : %', p_mode using errcode = '22023';
  end if;
  update public.settings set default_shared_mode = p_mode where id = 1;
end;
$$;

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
    -- Réglages d'affichage choisis par les admins (sans rien de sensible)
    'settings', (select jsonb_build_object('default_shared_mode', s.default_shared_mode) from public.settings s where s.id = 1),
    'updated_at', (select max(updated_at) from public.commerciaux)
  );
end;
$$;

revoke execute on function public.set_default_shared_mode(text) from public, anon;
grant execute on function public.set_default_shared_mode(text) to authenticated;
revoke execute on function public.get_map_data(text) from public;
grant execute on function public.get_map_data(text) to anon, authenticated;
