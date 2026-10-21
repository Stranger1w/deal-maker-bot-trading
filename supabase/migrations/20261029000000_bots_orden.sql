-- ============================================================
-- ORDEN DE LOS BOTS (21-oct)
--
-- Que hace:
--   - bots.sort_order: la posicion del bot en el escuadron (1, 2, 3...).
--     El dueno puede moverlos (arriba/abajo) para tenerlos ordenados como
--     quiera, en vez de por fecha de creacion.
--
-- Que NO hace (a proposito):
--   - No toca ninguna fila de forma permanente: el UPDATE inicial solo fija
--     el orden actual (por created_at) para que nada cambie de sitio.
--   - No toca flags de trading ni credenciales.
--
-- Es idempotente: si la repites, no se rompe nada.
--
-- La app funciona SIN esta migracion: si la columna no existe, se ordena
-- por created_at y los botones de mover avisan de que falta aplicarla.
-- ============================================================

begin;

alter table public.bots add column if not exists sort_order integer;

-- El orden inicial es el actual (por fecha de creacion), asi la migracion
-- no reordena nada: solo deja el numero guardado para poder moverlos luego.
with orden as (
  select id,
         row_number() over (order by created_at asc, id asc)::integer as posicion
    from public.bots
)
update public.bots b
   set sort_order = orden.posicion
  from orden
 where b.id = orden.id
   and b.sort_order is distinct from orden.posicion;

create index if not exists bots_sort_order_idx on public.bots (sort_order);

commit;

-- ============================================================
-- COMPROBACION (pegar despues de aplicar y ejecutar)
-- ============================================================
select column_name, data_type
  from information_schema.columns
  where table_name = 'bots' and column_name = 'sort_order';
-- debe salir: sort_order | integer
