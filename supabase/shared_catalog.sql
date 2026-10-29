-- Shared product identifiers for the “Ya lo tienes en catálogo” purchase flow.
-- Only name, barcode, unit and package size are shared. Stock, costs, selling
-- prices, expiry, supplier and purchase history remain private to each business.
create table if not exists public.shared_catalog_products (
  id uuid primary key default gen_random_uuid(),
  catalog_key text not null unique,
  normalized_name text not null,
  normalized_barcode text,
  name text not null check (char_length(name) between 2 and 120),
  barcode text,
  unit text not null default 'unidad' check (char_length(unit) <= 24),
  units_per_package numeric not null default 1 check (units_per_package >= 1 and units_per_package <= 100000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users(id) on delete set null
);

create index if not exists shared_catalog_name_idx on public.shared_catalog_products(normalized_name);
create index if not exists shared_catalog_barcode_idx on public.shared_catalog_products(normalized_barcode);
alter table public.shared_catalog_products enable row level security;
revoke all on table public.shared_catalog_products from anon, authenticated;

-- Import only public product identifiers from existing private inventory snapshots.
with source as (
  select
    btrim(product->>'name') as name,
    case when char_length(nullif(btrim(product->>'barcode'), '')) <= 64
      then nullif(btrim(product->>'barcode'), '') else null end as barcode,
    left(coalesce(nullif(btrim(product->>'unit'), ''), 'unidad'),24) as unit,
    greatest(1,least(case
      when (product->>'unitsPerPackage') ~ '^\d+(\.\d+)?$' and (product->>'unitsPerPackage')::numeric > 1
        then (product->>'unitsPerPackage')::numeric
      when coalesce(product->>'name','') ~* '\bx\s*[0-9]{1,3}\b'
        then substring(product->>'name' from '(?i)\bx\s*([0-9]{1,3})\b')::numeric
      when coalesce(product->>'name','') ~* '\b[0-9]{1,3}\s*(piezas?|unidades?|und\.?|u\.?\s*n\.?\s*d\.?)\b'
        then substring(product->>'name' from '(?i)\b([0-9]{1,3})\s*(piezas?|unidades?|und\.?|u\.?\s*n\.?\s*d\.?)\b')::numeric
      else 1::numeric
    end,100000)) as units_per_package,
    snapshot.updated_at
  from public.inventory_snapshots as snapshot
  cross join lateral jsonb_array_elements(coalesce(snapshot.data->'products','[]'::jsonb)) as products(product)
  where char_length(btrim(coalesce(product->>'name',''))) between 2 and 120
), normalized as (
  select *,
    trim(regexp_replace(translate(lower(btrim(name)), 'áéíóúüñ', 'aeiouun'), '[^a-z0-9]+', ' ', 'g')) as name_norm,
    nullif(regexp_replace(lower(coalesce(barcode,'')), '[^a-z0-9]', '', 'g'), '') as barcode_norm
  from source
), keyed as (
  select *, coalesce('barcode:'||barcode_norm, 'name:'||name_norm) as product_key
  from normalized
  where name_norm <> ''
), deduped as (
  select distinct on (product_key) product_key,name_norm,barcode_norm,name,barcode,unit,units_per_package
  from keyed order by product_key,updated_at desc
)
insert into public.shared_catalog_products(catalog_key,normalized_name,normalized_barcode,name,barcode,unit,units_per_package)
select product_key,name_norm,barcode_norm,name,barcode,unit,units_per_package from deduped
on conflict(catalog_key) do update set
  normalized_name=excluded.normalized_name,
  normalized_barcode=excluded.normalized_barcode,
  name=excluded.name,
  barcode=excluded.barcode,
  unit=excluded.unit,
  units_per_package=excluded.units_per_package,
  updated_at=now();

create or replace function public.ruma_search_shared_products(p_query text)
returns table(id uuid,name text,barcode text,unit text,units_per_package numeric)
language plpgsql stable security definer set search_path=''
as $$
declare q text; qbar text;
begin
  if (select auth.uid()) is null then
    raise exception 'Inicia sesión para buscar en el catálogo compartido' using errcode='42501';
  end if;
  q:=trim(regexp_replace(translate(lower(coalesce(p_query,'')), 'áéíóúüñ', 'aeiouun'), '[^a-z0-9]+', ' ', 'g'));
  qbar:=nullif(regexp_replace(lower(coalesce(p_query,'')), '[^a-z0-9]', '', 'g'), '');
  if q='' then return; end if;
  return query
    select c.id,c.name,c.barcode,c.unit,c.units_per_package
    from public.shared_catalog_products as c
    where c.normalized_name like '%'||q||'%'
       or (qbar is not null and c.normalized_barcode like qbar||'%')
    order by case when qbar is not null and c.normalized_barcode=qbar then 0
                  when c.normalized_name=q then 1 else 2 end, c.name
    limit 12;
end; $$;

create or replace function public.ruma_publish_shared_product(
  p_name text,p_barcode text default null,p_unit text default 'unidad',p_units_per_package numeric default 1
)
returns table(id uuid,name text,barcode text,unit text,units_per_package numeric)
language plpgsql security definer set search_path=''
as $$
declare n text; b text; u text; size numeric; n_norm text; b_norm text; product_key text; saved public.shared_catalog_products%rowtype;
begin
  if (select auth.uid()) is null then
    raise exception 'Inicia sesión para agregar al catálogo compartido' using errcode='42501';
  end if;
  n:=btrim(coalesce(p_name,'')); b:=nullif(btrim(coalesce(p_barcode,'')),''); u:=coalesce(nullif(btrim(p_unit),''),'unidad');
  size:=coalesce(p_units_per_package,1);
  if char_length(n)<2 or char_length(n)>120 then raise exception 'El nombre debe tener entre 2 y 120 caracteres'; end if;
  if char_length(coalesce(b,''))>64 or char_length(u)>24 then raise exception 'El código o la unidad es demasiado largo'; end if;
  if size<1 or size>100000 then raise exception 'Las unidades por paquete no son válidas'; end if;
  n_norm:=trim(regexp_replace(translate(lower(n), 'áéíóúüñ', 'aeiouun'), '[^a-z0-9]+', ' ', 'g'));
  b_norm:=nullif(regexp_replace(lower(coalesce(b,'')), '[^a-z0-9]', '', 'g'), '');
  product_key:=coalesce('barcode:'||b_norm,'name:'||n_norm);
  insert into public.shared_catalog_products as existing_row(catalog_key,normalized_name,normalized_barcode,name,barcode,unit,units_per_package,updated_by)
  values(product_key,n_norm,b_norm,n,b,u,size,(select auth.uid()))
  on conflict(catalog_key) do update set
    normalized_name=excluded.normalized_name,normalized_barcode=excluded.normalized_barcode,
    name=excluded.name,barcode=excluded.barcode,unit=excluded.unit,
    units_per_package=excluded.units_per_package,updated_at=now(),updated_by=(select auth.uid())
  returning existing_row.* into saved;
  return query select saved.id,saved.name,saved.barcode,saved.unit,saved.units_per_package;
end; $$;

revoke all on function public.ruma_search_shared_products(text) from public,anon;
revoke all on function public.ruma_publish_shared_product(text,text,text,numeric) from public,anon;
grant execute on function public.ruma_search_shared_products(text) to authenticated;
grant execute on function public.ruma_publish_shared_product(text,text,text,numeric) to authenticated;

-- Keep the shared search index in sync whenever any account saves its inventory.
-- The trigger copies product identifiers only; private stock and transaction
-- fields remain inside inventory_snapshots.data and are never written here.
create or replace function public.ruma_sync_shared_catalog_from_snapshot()
returns trigger
language plpgsql security definer set search_path=''
as $$
declare
  product jsonb;
  n text;
  b text;
  u text;
  size numeric;
  n_norm text;
  b_norm text;
  product_key text;
begin
  for product in
    select value
    from jsonb_array_elements(coalesce(new.data->'products','[]'::jsonb)) as entries(value)
  loop
    n:=btrim(coalesce(product->>'name',''));
    if char_length(n)<2 or char_length(n)>120 then continue; end if;

    b:=nullif(btrim(coalesce(product->>'barcode','')),'');
    if char_length(coalesce(b,''))>64 then b:=null; end if;
    u:=coalesce(nullif(btrim(product->>'unit'),''),'unidad');
    if char_length(u)>24 then u:=left(u,24); end if;

    size:=null;
    if coalesce(product->>'unitsPerPackage','') ~ '^\d+(\.\d+)?$' then
      size:=(product->>'unitsPerPackage')::numeric;
    end if;
    if coalesce(size,1)<=1 then
      if n ~* '\bx\s*[0-9]{1,3}\b' then
        size:=substring(n from '(?i)\bx\s*([0-9]{1,3})\b')::numeric;
      elsif n ~* '\b[0-9]{1,3}\s*(piezas?|unidades?|und\.?|u\.?\s*n\.?\s*d\.?)\b' then
        size:=substring(n from '(?i)\b([0-9]{1,3})\s*(piezas?|unidades?|und\.?|u\.?\s*n\.?\s*d\.?)\b')::numeric;
      end if;
    end if;
    size:=greatest(1,least(coalesce(size,1),100000));

    n_norm:=trim(regexp_replace(translate(lower(n),'áéíóúüñ','aeiouun'),'[^a-z0-9]+',' ','g'));
    if n_norm='' then continue; end if;
    b_norm:=nullif(regexp_replace(lower(coalesce(b,'')),'[^a-z0-9]','','g'),'');
    product_key:=coalesce('barcode:'||b_norm,'name:'||n_norm);

    insert into public.shared_catalog_products as existing_row(
      catalog_key,normalized_name,normalized_barcode,name,barcode,unit,units_per_package,updated_by
    ) values (
      product_key,n_norm,b_norm,n,b,u,size,(select auth.uid())
    )
    on conflict(catalog_key) do update set
      normalized_name=excluded.normalized_name,
      normalized_barcode=excluded.normalized_barcode,
      name=excluded.name,
      barcode=excluded.barcode,
      unit=excluded.unit,
      units_per_package=excluded.units_per_package,
      updated_at=now(),
      updated_by=excluded.updated_by
    where existing_row.normalized_name is distinct from excluded.normalized_name
       or existing_row.normalized_barcode is distinct from excluded.normalized_barcode
       or existing_row.name is distinct from excluded.name
       or existing_row.barcode is distinct from excluded.barcode
       or existing_row.unit is distinct from excluded.unit
       or existing_row.units_per_package is distinct from excluded.units_per_package;
  end loop;
  return new;
end; $$;

revoke all on function public.ruma_sync_shared_catalog_from_snapshot() from public,anon,authenticated;
drop trigger if exists ruma_sync_shared_catalog_after_inventory_save on public.inventory_snapshots;
create trigger ruma_sync_shared_catalog_after_inventory_save
after insert or update of data on public.inventory_snapshots
for each row execute function public.ruma_sync_shared_catalog_from_snapshot();
