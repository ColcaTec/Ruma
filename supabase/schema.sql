-- Ruma: esquema multi-negocio aislado del proyecto INVENTARIO.
-- Requiere Supabase Auth. Ejecutar solo en un proyecto Ruma nuevo.
create extension if not exists pgcrypto;

create table if not exists public.businesses (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) > 0),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.business_members (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'owner' check (role in ('owner','manager','staff')),
  created_at timestamptz not null default now(),
  primary key (business_id,user_id)
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  barcode text,
  unit text not null default 'unidad',
  stock numeric(14,3) not null default 0 check (stock >= 0),
  last_unit_cost numeric(14,2) not null default 0 check (last_unit_cost >= 0),
  created_at timestamptz not null default now(),
  unique (business_id, barcode),
  unique (id, business_id)
);
create index if not exists products_business_name_idx on public.products(business_id,name);

create table if not exists public.purchases (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  supplier text,
  purchased_on date not null default current_date,
  receipt_object text,
  status text not null default 'confirmed' check (status in ('draft','confirmed')),
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  unique (id, business_id)
);
create index if not exists purchases_business_date_idx on public.purchases(business_id,purchased_on desc);

create table if not exists public.purchase_items (
  id uuid primary key default gen_random_uuid(),
  purchase_id uuid not null,
  business_id uuid not null,
  product_id uuid not null,
  quantity numeric(14,3) not null check (quantity > 0),
  unit_cost numeric(14,2) not null check (unit_cost >= 0),
  created_at timestamptz not null default now(),
  foreign key (purchase_id,business_id) references public.purchases(id,business_id) on delete cascade,
  foreign key (product_id,business_id) references public.products(id,business_id)
);

create table if not exists public.stock_movements (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id uuid not null,
  purchase_id uuid,
  kind text not null check (kind in ('purchase','adjustment','sale','waste')),
  quantity_delta numeric(14,3) not null,
  unit_cost numeric(14,2),
  note text,
  created_by uuid not null default auth.uid() references auth.users(id),
  created_at timestamptz not null default now(),
  foreign key (product_id,business_id) references public.products(id,business_id),
  foreign key (purchase_id,business_id) references public.purchases(id,business_id)
);
create index if not exists movements_business_created_idx on public.stock_movements(business_id,created_at desc);

create or replace function public.ruma_is_member(target_business uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.business_members m
    where m.business_id = target_business and m.user_id = (select auth.uid())
  );
$$;

create or replace function public.ruma_can_bootstrap_business(target_business uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.businesses b
    where b.id = target_business and b.created_by = (select auth.uid())
  );
$$;

alter table public.businesses enable row level security;
alter table public.business_members enable row level security;
alter table public.products enable row level security;
alter table public.purchases enable row level security;
alter table public.purchase_items enable row level security;
alter table public.stock_movements enable row level security;

drop policy if exists businesses_read_member on public.businesses;
create policy businesses_read_member on public.businesses for select to authenticated
  using (public.ruma_is_member(id));
drop policy if exists businesses_create_owner on public.businesses;
create policy businesses_create_owner on public.businesses for insert to authenticated
  with check (created_by = (select auth.uid()));

drop policy if exists members_read_same_business on public.business_members;
create policy members_read_same_business on public.business_members for select to authenticated
  using (public.ruma_is_member(business_id));
drop policy if exists creator_add_self_as_owner on public.business_members;
create policy creator_add_self_as_owner on public.business_members for insert to authenticated
  with check (user_id = (select auth.uid()) and role = 'owner' and public.ruma_can_bootstrap_business(business_id));

drop policy if exists products_member_access on public.products;
create policy products_member_access on public.products for all to authenticated
  using (public.ruma_is_member(business_id)) with check (public.ruma_is_member(business_id));
drop policy if exists purchases_member_access on public.purchases;
drop policy if exists purchases_read_member on public.purchases;
create policy purchases_read_member on public.purchases for select to authenticated
  using (public.ruma_is_member(business_id));
drop policy if exists purchase_items_member_access on public.purchase_items;
drop policy if exists purchase_items_read_member on public.purchase_items;
create policy purchase_items_read_member on public.purchase_items for select to authenticated
  using (public.ruma_is_member(business_id));
drop policy if exists movements_read_member on public.stock_movements;
create policy movements_read_member on public.stock_movements for select to authenticated
  using (public.ruma_is_member(business_id));

-- Recibir una compra actualiza las líneas, stock, costo más reciente y kardex
-- en una sola transacción; si una línea no es válida, no queda una recepción parcial.
create or replace function public.ruma_confirm_purchase(
  p_business_id uuid,
  p_supplier text,
  p_purchased_on date,
  p_items jsonb,
  p_receipt_object text default null
) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  v_purchase_id uuid;
  v_item jsonb;
  v_product_id uuid;
  v_qty numeric(14,3);
  v_cost numeric(14,2);
begin
  if not public.ruma_is_member(p_business_id) then
    raise exception 'No tienes acceso a este negocio' using errcode = '42501';
  end if;
  if jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) = 0 then
    raise exception 'La compra debe incluir al menos un producto';
  end if;

  insert into public.purchases(business_id,supplier,purchased_on,receipt_object,status,created_by)
  values (p_business_id,nullif(trim(p_supplier),''),coalesce(p_purchased_on,current_date),p_receipt_object,'confirmed',(select auth.uid()))
  returning id into v_purchase_id;

  for v_item in select value from jsonb_array_elements(p_items) loop
    v_product_id := (v_item->>'product_id')::uuid;
    v_qty := (v_item->>'quantity')::numeric;
    v_cost := (v_item->>'unit_cost')::numeric;
    if v_qty <= 0 or v_cost < 0 then raise exception 'Cantidad o costo inválido'; end if;

    update public.products
      set stock = stock + v_qty, last_unit_cost = v_cost
      where id = v_product_id and business_id = p_business_id;
    if not found then raise exception 'Producto no pertenece a este negocio'; end if;

    insert into public.purchase_items(purchase_id,business_id,product_id,quantity,unit_cost)
      values(v_purchase_id,p_business_id,v_product_id,v_qty,v_cost);
    insert into public.stock_movements(business_id,product_id,purchase_id,kind,quantity_delta,unit_cost)
      values(p_business_id,v_product_id,v_purchase_id,'purchase',v_qty,v_cost);
  end loop;
  return v_purchase_id;
end;
$$;

grant usage on schema public to authenticated;
grant select,insert on public.businesses to authenticated;
grant select,insert on public.business_members to authenticated;
grant select on public.products to authenticated;
grant insert (business_id,name,barcode,unit) on public.products to authenticated;
grant update (name,barcode,unit) on public.products to authenticated;
grant select on public.purchases to authenticated;
grant select on public.purchase_items to authenticated;
grant select on public.stock_movements to authenticated;
revoke all on function public.ruma_is_member(uuid) from public,anon;
grant execute on function public.ruma_is_member(uuid) to authenticated;
revoke all on function public.ruma_can_bootstrap_business(uuid) from public,anon;
grant execute on function public.ruma_can_bootstrap_business(uuid) to authenticated;
revoke all on function public.ruma_confirm_purchase(uuid,text,date,jsonb,text) from public,anon;
grant execute on function public.ruma_confirm_purchase(uuid,text,date,jsonb,text) to authenticated;

insert into storage.buckets(id,name,public)
values ('ruma-receipts','ruma-receipts',false)
on conflict (id) do nothing;

drop policy if exists ruma_receipts_read_member on storage.objects;
create policy ruma_receipts_read_member on storage.objects for select to authenticated
  using (bucket_id = 'ruma-receipts' and public.ruma_is_member(((storage.foldername(name))[1])::uuid));
drop policy if exists ruma_receipts_insert_member on storage.objects;
create policy ruma_receipts_insert_member on storage.objects for insert to authenticated
  with check (bucket_id = 'ruma-receipts' and public.ruma_is_member(((storage.foldername(name))[1])::uuid));

