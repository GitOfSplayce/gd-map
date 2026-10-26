-- Supabase refuse les DELETE / UPDATE sans WHERE (extension safeupdate) dans les requêtes de l'API :
-- set_access_code vidait le journal des essais avec un simple "delete from". Même fonction, avec un WHERE.
create or replace function public.set_access_code(p_code text)
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

  -- Nouveau code : on repart de zéro pour la limitation des essais
  delete from public.access_attempts where true;
end;
$$;

revoke execute on function public.set_access_code(text) from public, anon;
grant execute on function public.set_access_code(text) to authenticated;
