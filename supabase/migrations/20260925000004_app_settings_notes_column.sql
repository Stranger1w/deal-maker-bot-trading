-- ============================================================================
-- Formaliza la columna app_settings.notes, que existia en la base de datos
-- pero no estaba declarada en ninguna migracion (se agrego a mano). Con esto
-- un entorno nuevo reconstruido desde migraciones queda igual que el actual.
-- Idempotente: no falla si la columna ya existe.
-- ============================================================================
ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS notes text;