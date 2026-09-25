-- ============================================================================
-- P1.2 — Lockdown de app_settings: lectura publica, escritura solo
-- service_role (bypass RLS) o usuarios administradores (tabla app_admins).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.app_admins (
  user_id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.app_admins TO service_role;
ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.is_app_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.app_admins WHERE user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.is_app_admin() FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.is_app_admin() TO authenticated, service_role;

DROP POLICY IF EXISTS "app_settings_select" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_upsert" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_update" ON public.app_settings;
DROP POLICY IF EXISTS "app_settings_write" ON public.app_settings;

CREATE POLICY "app_settings_read" ON public.app_settings
  FOR SELECT TO anon, authenticated USING (true);

REVOKE INSERT, UPDATE, DELETE ON public.app_settings FROM anon, authenticated;
GRANT SELECT ON public.app_settings TO anon, authenticated;
GRANT ALL ON public.app_settings TO service_role;

DROP POLICY IF EXISTS "app_settings_admin_write" ON public.app_settings;
CREATE POLICY "app_settings_admin_write" ON public.app_settings
  FOR ALL TO authenticated
  USING (public.is_app_admin())
  WITH CHECK (public.is_app_admin());
