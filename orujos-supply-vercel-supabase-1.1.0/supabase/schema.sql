-- ORUJOS SUPPLY 1.1 — ejecutar una vez en Supabase: SQL Editor.
-- 1) Crea el primer usuario en Authentication > Users.
-- 2) Sustituye el correo en el último INSERT por el del encargado de compras.

create extension if not exists pgcrypto;

create type public.user_role as enum ('ADMIN', 'USER');
create type public.request_status as enum ('BORRADOR','ENVIADA','EN_REVISION','APROBADA','MODIFICADA','RECHAZADA','COMPRADA','CERRADA');

create table public.branches (id bigint generated always as identity primary key, name text unique not null, active boolean not null default true);
create table public.areas (id bigint generated always as identity primary key, name text unique not null, active boolean not null default true);
create table public.categories (id bigint generated always as identity primary key, name text unique not null, active boolean not null default true);
create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null, role public.user_role not null default 'USER', active boolean not null default true,
  branch_id bigint references public.branches(id), area_id bigint references public.areas(id), created_at timestamptz not null default now()
);
create table public.products (
  id bigint generated always as identity primary key, code text unique not null, name text not null,
  category_id bigint references public.categories(id), subcategory text, unit text not null,
  unit_price numeric(12,2) not null check(unit_price >= 0), supplier text, active boolean not null default true, notes text
);
create table public.product_scopes (product_id bigint references public.products(id) on delete cascade, branch_id bigint references public.branches(id) on delete cascade, area_id bigint references public.areas(id) on delete cascade, primary key(product_id,branch_id,area_id));
create table public.supply_requests (
  id uuid primary key default gen_random_uuid(), number text unique, branch_id bigint not null references public.branches(id), area_id bigint not null references public.areas(id), user_id uuid not null references public.profiles(id), status public.request_status not null default 'BORRADOR', notes text, total numeric(12,2) not null default 0, created_at timestamptz not null default now(), submitted_at timestamptz, reviewed_at timestamptz, reviewed_by uuid references public.profiles(id)
);
create table public.supply_request_items (
  id bigint generated always as identity primary key, request_id uuid not null references public.supply_requests(id) on delete cascade, product_id bigint not null references public.products(id), code text, product_name text, category_name text, unit text, physical_qty numeric(12,2) not null check(physical_qty >= 0), requested_qty numeric(12,2) not null check(requested_qty > 0), approved_qty numeric(12,2), unit_price numeric(12,2), subtotal numeric(12,2)
);
create table public.request_events (id bigint generated always as identity primary key, request_id uuid not null references public.supply_requests(id) on delete cascade, actor_id uuid references public.profiles(id), status public.request_status not null, note text, created_at timestamptz not null default now());
create table public.admin_notifications (id uuid primary key default gen_random_uuid(), recipient_id uuid not null references public.profiles(id), request_id uuid not null references public.supply_requests(id) on delete cascade, title text not null, body text not null, read_at timestamptz, created_at timestamptz not null default now());

create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public as $$ select exists(select 1 from profiles where id=auth.uid() and role='ADMIN' and active) $$;
create or replace function public.request_number() returns text language plpgsql as $$ declare next_no bigint; begin select count(*)+1 into next_no from supply_requests where extract(year from created_at)=extract(year from now()); return 'ORJ-' || extract(year from now())::text || '-' || lpad(next_no::text,6,'0'); end $$;
create or replace function public.set_item_snapshot() returns trigger language plpgsql security definer set search_path=public as $$ declare p record; begin select p.*, c.name category into p from products p left join categories c on c.id=p.category_id where p.id=new.product_id and p.active; if not found then raise exception 'Producto no disponible'; end if; new.code:=p.code; new.product_name:=p.name; new.category_name:=p.category; new.unit:=p.unit; new.unit_price:=p.unit_price; new.subtotal:=new.requested_qty*p.unit_price; return new; end $$;
create trigger supply_item_snapshot before insert or update of product_id,requested_qty on public.supply_request_items for each row execute function public.set_item_snapshot();
create or replace function public.finalize_supply_request(p_request_id uuid) returns void language plpgsql security definer set search_path=public as $$ declare r record; begin select * into r from supply_requests where id=p_request_id for update; if not found or (r.user_id<>auth.uid() and not is_admin()) then raise exception 'Solicitud no autorizada'; end if; if not exists(select 1 from supply_request_items where request_id=p_request_id) then raise exception 'Agregue al menos un producto'; end if; update supply_requests set number=coalesce(number,request_number()), total=(select coalesce(sum(subtotal),0) from supply_request_items where request_id=p_request_id), status='ENVIADA', submitted_at=now() where id=p_request_id; insert into request_events(request_id,actor_id,status,note) values(p_request_id,auth.uid(),'ENVIADA','Solicitud enviada'); insert into admin_notifications(recipient_id,request_id,title,body) select id,p_request_id,'Nueva solicitud de suministros','Solicitud ' || (select number from supply_requests where id=p_request_id) from profiles where role='ADMIN' and active; end $$;

alter table public.branches enable row level security; alter table public.areas enable row level security; alter table public.categories enable row level security; alter table public.profiles enable row level security; alter table public.products enable row level security; alter table public.product_scopes enable row level security; alter table public.supply_requests enable row level security; alter table public.supply_request_items enable row level security; alter table public.request_events enable row level security; alter table public.admin_notifications enable row level security;
create policy "authenticated read lookups" on branches for select to authenticated using(true); create policy "admin branches" on branches for all to authenticated using(is_admin()) with check(is_admin());
create policy "authenticated read areas" on areas for select to authenticated using(true); create policy "admin areas" on areas for all to authenticated using(is_admin()) with check(is_admin());
create policy "authenticated read categories" on categories for select to authenticated using(true); create policy "admin categories" on categories for all to authenticated using(is_admin()) with check(is_admin());
create policy "profiles self or admin" on profiles for select to authenticated using(id=auth.uid() or is_admin()); create policy "profiles admin write" on profiles for all to authenticated using(is_admin()) with check(is_admin());
create policy "read products by scope" on products for select to authenticated using(active and (is_admin() or not exists(select 1 from product_scopes s where s.product_id=products.id) or exists(select 1 from product_scopes s join profiles pr on pr.id=auth.uid() where s.product_id=products.id and s.branch_id=pr.branch_id and s.area_id=pr.area_id))); create policy "products admin write" on products for all to authenticated using(is_admin()) with check(is_admin());
create policy "read product scopes" on product_scopes for select to authenticated using(is_admin() or exists(select 1 from profiles p where p.id=auth.uid() and p.branch_id=branch_id and p.area_id=area_id)); create policy "scopes admin write" on product_scopes for all to authenticated using(is_admin()) with check(is_admin());
create policy "requests owner or admin" on supply_requests for select to authenticated using(user_id=auth.uid() or is_admin()); create policy "requests create own" on supply_requests for insert to authenticated with check(user_id=auth.uid() and (is_admin() or exists(select 1 from profiles p where p.id=auth.uid() and p.branch_id=branch_id and p.area_id=area_id))); create policy "requests admin update" on supply_requests for update to authenticated using(is_admin()) with check(is_admin());
create policy "items owner or admin read" on supply_request_items for select to authenticated using(is_admin() or exists(select 1 from supply_requests r where r.id=request_id and r.user_id=auth.uid())); create policy "items owner draft insert" on supply_request_items for insert to authenticated with check(exists(select 1 from supply_requests r where r.id=request_id and r.user_id=auth.uid() and r.status='BORRADOR')); create policy "events owner or admin" on request_events for select to authenticated using(is_admin() or exists(select 1 from supply_requests r where r.id=request_id and r.user_id=auth.uid()));
create policy "admin notifications only" on admin_notifications for select to authenticated using(recipient_id=auth.uid() and is_admin());

insert into public.branches(name) values ('Orujos Plaza Ciudad Nueva'),('Orujos Plaza Lara');
insert into public.areas(name) values ('Cocina'),('Bar'),('Salón'),('Limpieza'),('Administración'),('Otros');
insert into public.categories(name) values ('Cocina'),('Bar'),('Limpieza'),('Salón'),('Otros');
insert into public.products(code,name,category_id,unit,unit_price) values ('COC001','Aceite vegetal',(select id from categories where name='Cocina'),'Galón',350),('COC002','Arroz',(select id from categories where name='Cocina'),'Libra',18),('BAR001','Cerveza',(select id from categories where name='Bar'),'Caja',800),('LIM001','Detergente',(select id from categories where name='Limpieza'),'Galón',280);
-- Crear el primer perfil ADMIN después de crear el usuario en Authentication:
-- insert into public.profiles(id,full_name,role) select id,'Administrador de Compras','ADMIN' from auth.users where email='TU_CORREO@EJEMPLO.COM';
