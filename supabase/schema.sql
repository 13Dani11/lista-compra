-- =====================================================================
--  LISTA COMPRA · esquema de base de datos para Supabase
--  Ejecuta este archivo entero en Supabase → SQL Editor → New query → Run.
--  Se puede volver a ejecutar sin romper nada.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- 1. Tablas
-- ---------------------------------------------------------------------

-- Correos de la familia que pueden usar la lista
create table if not exists public.miembros (
  email      text primary key,
  created_at timestamptz not null default now()
);

-- Lista de la compra (lo que hace falta en casa)
create table if not exists public.items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(name) between 1 and 80),
  qty        text not null default '' check (char_length(qty) <= 20),
  created_at timestamptz not null default now()
);

-- Historial de productos: alimenta "Frecuentes" y el desplegable de recientes.
-- id = nombre normalizado (minúsculas, sin acentos), lo calcula la web.
create table if not exists public.frecuentes (
  id    text primary key,
  name  text not null,
  qty   text not null default '',   -- última cantidad usada (no se muestra)
  count integer not null default 1,
  last  timestamptz not null default now()
);

-- Compras ("Hacer compra" crea una activa; "Terminar compra" la cierra)
create table if not exists public.compras (
  id           uuid primary key default gen_random_uuid(),
  estado       text not null default 'activa' check (estado in ('activa', 'terminada')),
  created_at   timestamptz not null default now(),
  terminada_at timestamptz
);

-- Productos de cada compra, con su marca de "en el carro"
create table if not exists public.compra_items (
  id         uuid primary key default gen_random_uuid(),
  compra_id  uuid not null references public.compras(id) on delete cascade,
  name       text not null,
  qty        text not null default '',
  checked    boolean not null default false,
  orden      integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists compra_items_compra_idx on public.compra_items (compra_id, orden);
create index if not exists compras_estado_idx      on public.compras (estado, created_at desc);
create index if not exists frecuentes_last_idx     on public.frecuentes (last desc);

-- ---------------------------------------------------------------------
-- 2. ¿Quién es de la familia?
-- ---------------------------------------------------------------------
create or replace function public.es_miembro()
returns boolean
language sql stable security definer
set search_path = public
as $$
  select exists (
    select 1 from public.miembros
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- ---------------------------------------------------------------------
-- 3. Seguridad (Row Level Security): solo los miembros leen y escriben
-- ---------------------------------------------------------------------
alter table public.miembros     enable row level security;
alter table public.items        enable row level security;
alter table public.frecuentes   enable row level security;
alter table public.compras      enable row level security;
alter table public.compra_items enable row level security;

drop policy if exists "ver mi propia fila" on public.miembros;
create policy "ver mi propia fila" on public.miembros
  for select to authenticated
  using (lower(email) = lower(coalesce(auth.jwt() ->> 'email', '')));

drop policy if exists "familia" on public.items;
create policy "familia" on public.items
  for all to authenticated using (public.es_miembro()) with check (public.es_miembro());

drop policy if exists "familia" on public.frecuentes;
create policy "familia" on public.frecuentes
  for all to authenticated using (public.es_miembro()) with check (public.es_miembro());

drop policy if exists "familia" on public.compras;
create policy "familia" on public.compras
  for all to authenticated using (public.es_miembro()) with check (public.es_miembro());

drop policy if exists "familia" on public.compra_items;
create policy "familia" on public.compra_items
  for all to authenticated using (public.es_miembro()) with check (public.es_miembro());

-- ---------------------------------------------------------------------
-- 4. Acciones (se ejecutan de una vez, sin estados a medias)
-- ---------------------------------------------------------------------

-- Suma 1 al contador del producto y guarda su última cantidad
create or replace function public.registrar_frecuente(p_id text, p_name text, p_qty text)
returns void
language sql security invoker
set search_path = public
as $$
  insert into public.frecuentes (id, name, qty, count, last)
  values (p_id, p_name, coalesce(p_qty, ''), 1, now())
  on conflict (id) do update
    set name  = excluded.name,
        qty   = coalesce(nullif(excluded.qty, ''), public.frecuentes.qty),
        count = public.frecuentes.count + 1,
        last  = now();
$$;

-- "Hacer compra": mueve todo lo de la lista a la compra activa (o crea una) y vacía la lista
create or replace function public.hacer_compra()
returns uuid
language plpgsql security invoker
set search_path = public
as $$
declare
  v_compra uuid;
  v_orden  integer;
begin
  select id into v_compra
  from public.compras
  where estado = 'activa'
  order by created_at desc
  limit 1;

  if v_compra is null then
    insert into public.compras (estado) values ('activa') returning id into v_compra;
  end if;

  select coalesce(max(orden), 0) into v_orden
  from public.compra_items where compra_id = v_compra;

  with movidos as (
    delete from public.items where true
    returning name, qty, created_at
  )
  insert into public.compra_items (compra_id, name, qty, orden)
  select v_compra, m.name, m.qty, v_orden + row_number() over (order by m.created_at)
  from movidos m
  where not exists (
    select 1 from public.compra_items ci
    where ci.compra_id = v_compra and lower(ci.name) = lower(m.name)
  );

  return v_compra;
end;
$$;

-- "Terminar compra": lo no marcado vuelve a la lista y la compra se cierra
create or replace function public.terminar_compra(p_compra uuid)
returns void
language plpgsql security invoker
set search_path = public
as $$
begin
  insert into public.items (name, qty, created_at)
  select ci.name, ci.qty, now() + (ci.orden * interval '1 millisecond')
  from public.compra_items ci
  where ci.compra_id = p_compra
    and not ci.checked
    and not exists (select 1 from public.items i where lower(i.name) = lower(ci.name));

  update public.compras
  set estado = 'terminada', terminada_at = now()
  where id = p_compra and estado = 'activa';
end;
$$;

revoke all on function public.es_miembro()                            from public, anon;
revoke all on function public.registrar_frecuente(text, text, text)   from public, anon;
revoke all on function public.hacer_compra()                          from public, anon;
revoke all on function public.terminar_compra(uuid)                   from public, anon;
grant execute on function public.es_miembro()                          to authenticated;
grant execute on function public.registrar_frecuente(text, text, text) to authenticated;
grant execute on function public.hacer_compra()                        to authenticated;
grant execute on function public.terminar_compra(uuid)                 to authenticated;

-- ---------------------------------------------------------------------
-- 5. Tiempo real: que todos vean los cambios al momento
-- ---------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['items', 'frecuentes', 'compras', 'compra_items'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ---------------------------------------------------------------------
-- 6. Añade aquí los correos de la familia (uno por línea) y ejecuta
-- ---------------------------------------------------------------------
-- insert into public.miembros (email) values
--   ('tu-correo@gmail.com'),
--   ('correo-de-otro-familiar@gmail.com')
-- on conflict do nothing;
