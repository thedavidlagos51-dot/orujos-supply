-- ORUJOS SUPPLY 1.2.1 — módulo de edición y visibilidad por área.
-- Ejecute este archivo UNA VEZ en Supabase > SQL Editor.

insert into public.areas(name) values ('Servicio') on conflict (name) do nothing;

-- Un administrador ve todo el catálogo, incluidos productos inactivos.
-- Un encargado solo ve productos activos asignados exactamente a su sucursal y área.
drop policy if exists "read products by scope" on public.products;
create policy "read products by exact scope" on public.products for select to authenticated
using (
  public.is_admin()
  or (
    active and exists (
      select 1 from public.product_scopes s
      join public.profiles p on p.id = auth.uid()
      where s.product_id = products.id
        and s.branch_id = p.branch_id
        and s.area_id = p.area_id
    )
  )
);

-- Impide que un usuario agregue manualmente a una solicitud un producto ajeno a su área.
create or replace function public.set_item_snapshot()
returns trigger language plpgsql security definer set search_path=public as $$
declare p record;
begin
  select pr.*, c.name category into p
  from products pr left join categories c on c.id = pr.category_id
  where pr.id = new.product_id and pr.active;
  if not found then raise exception 'Producto no disponible'; end if;
  if not public.is_admin() and not exists (
    select 1 from product_scopes s join profiles u on u.id = auth.uid()
    where s.product_id = new.product_id
      and s.branch_id = u.branch_id and s.area_id = u.area_id
  ) then raise exception 'Producto no autorizado para tu área'; end if;
  new.code := p.code; new.product_name := p.name; new.category_name := p.category;
  new.unit := p.unit; new.unit_price := p.unit_price;
  new.subtotal := new.requested_qty * p.unit_price;
  return new;
end $$;

-- Asigna los productos de ejemplo de forma segura. Puedes modificar estas asignaciones
-- posteriormente desde Productos en la aplicación.
insert into public.product_scopes(product_id, branch_id, area_id)
select p.id, b.id, a.id
from public.products p
cross join public.branches b
join public.areas a on a.name = case
  when p.code like 'COC%' then 'Cocina'
  when p.code like 'BAR%' then 'Servicio'
  when p.code like 'LIM%' then 'Servicio'
  else 'Servicio'
end
on conflict do nothing;
