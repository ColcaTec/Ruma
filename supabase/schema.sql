-- Ruma cloud account and inventory sync. Apply only to Ruma's Supabase project.
create schema if not exists ruma_private;
revoke all on schema ruma_private from public, anon;
grant usage on schema ruma_private to authenticated;

create table public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','manager','staff')),
  created_at timestamptz not null default now(),
  primary key (business_id, user_id)
);
create table public.inventory_snapshots (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  data jsonb not null default '{"products":[],"purchases":[]}'::jsonb check (
    jsonb_typeof(data)='object' and jsonb_typeof(data->'products')='array' and jsonb_typeof(data->'purchases')='array'
  ),
  revision bigint not null default 0 check (revision >= 0),
  updated_at timestamptz not null default now()
);
create index business_members_user_idx on public.business_members(user_id);

create or replace function ruma_private.is_member(target_business uuid)
returns boolean language sql stable security definer set search_path=''
as $$ select (select auth.uid()) is not null and exists (
  select 1 from public.business_members m where m.business_id=target_business and m.user_id=(select auth.uid())
); $$;
revoke all on function ruma_private.is_member(uuid) from public, anon;
grant execute on function ruma_private.is_member(uuid) to authenticated;

create or replace function public.ruma_bootstrap_new_user()
returns trigger language plpgsql security definer set search_path=''
as $$
declare new_business_id uuid;
begin
  insert into public.businesses(name,created_by)
  values (coalesce(nullif(trim(split_part(coalesce(new.email,''),'@',1)),''),'Mi negocio') || ' · Ruma',new.id)
  returning id into new_business_id;
  insert into public.business_members(business_id,user_id,role) values(new_business_id,new.id,'owner');
  return new;
end; $$;
revoke all on function public.ruma_bootstrap_new_user() from public, anon, authenticated;
create trigger ruma_bootstrap_after_signup after insert on auth.users for each row execute function public.ruma_bootstrap_new_user();

alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.inventory_snapshots enable row level security;
create policy businesses_member_read on public.businesses for select to authenticated using (ruma_private.is_member(id));
create policy memberships_read_self on public.business_members for select to authenticated using (user_id=(select auth.uid()));
create policy snapshots_member_select on public.inventory_snapshots for select to authenticated using (ruma_private.is_member(business_id));
create policy snapshots_member_insert on public.inventory_snapshots for insert to authenticated with check (ruma_private.is_member(business_id));
create policy snapshots_member_update on public.inventory_snapshots for update to authenticated using (ruma_private.is_member(business_id)) with check (ruma_private.is_member(business_id));

create or replace function public.ruma_save_inventory_snapshot(p_business_id uuid,p_data jsonb,p_expected_revision bigint)
returns bigint language plpgsql security invoker set search_path=''
as $$
declare next_revision bigint;
begin
  if (select auth.uid()) is null or not ruma_private.is_member(p_business_id) then
    raise exception 'No tienes acceso a este negocio' using errcode='42501';
  end if;
  if jsonb_typeof(p_data)<>'object' or jsonb_typeof(p_data->'products')<>'array'
     or jsonb_typeof(p_data->'purchases')<>'array' or octet_length(p_data::text)>5000000 then
    raise exception 'El inventario enviado no es válido o supera el límite permitido';
  end if;
  if p_expected_revision=0 then
    insert into public.inventory_snapshots(business_id,data,revision,updated_at)
    values(p_business_id,p_data,1,now()) on conflict(business_id) do nothing returning revision into next_revision;
  else
    update public.inventory_snapshots set data=p_data,revision=revision+1,updated_at=now()
    where business_id=p_business_id and revision=p_expected_revision returning revision into next_revision;
  end if;
  if next_revision is null then
    raise exception 'El inventario cambió en otro dispositivo. Recárgalo antes de guardar.' using errcode='40001';
  end if;
  return next_revision;
end; $$;
grant usage on schema public to authenticated;
grant select on public.businesses,public.business_members to authenticated;
grant select,insert,update on public.inventory_snapshots to authenticated;
revoke all on function public.ruma_save_inventory_snapshot(uuid,jsonb,bigint) from public,anon;
grant execute on function public.ruma_save_inventory_snapshot(uuid,jsonb,bigint) to authenticated;

