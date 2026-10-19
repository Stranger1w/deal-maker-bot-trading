-- ============================================================
-- app_settings · interruptor del registro publico de usuarios
--
-- NO abre el registro: solo deja preparada la fila y explica como
-- abrirla y cerrarla. El valor por defecto (sin fila o "false") es
-- registro CERRADO, que es lo que quiere el dueno mientras el
-- multiusuario no este probado.
--
-- El control de verdad esta en Supabase Auth (Authentication -> Sign-ups):
-- si Sign-ups esta apagado ahi, NADIE puede registrarse aunque la app
-- muestre el boton. La app solo refleja el estado (src/lib/registro.functions.ts).
--
-- ABRIR el registro (cuando el multiusuario este probado y el dueno lo
-- decida). Pegar esto en el SQL Editor:
--
--   insert into public.app_settings (key, value, updated_at)
--   values ('public_signup_enabled', 'true', now())
--   on conflict (key) do update set value = 'true', updated_at = now();
--
-- O bien, sin tocar la base, con la variable de entorno PUBLIC_SIGNUP=true
-- en el entorno del servidor (tiene prioridad sobre la fila).
--
-- CERRARLO de nuevo:
--
--   update public.app_settings
--      set value = 'false', updated_at = now()
--    where key = 'public_signup_enabled';
-- ============================================================

begin;

-- La fila NO se inserta activa: se deja en "false" para que el estado
-- inicial sea explicito y consultable.
insert into public.app_settings (key, value, updated_at)
values ('public_signup_enabled', 'false', now())
on conflict (key) do update
  set value = case when public.app_settings.value in ('true', '1', 'si', 'yes') then 'true' else 'false' end,
      updated_at = now();

commit;

-- ------------------------------------------------------------
-- Verificacion (pegar en el SQL Editor):
--
--   select key, value, updated_at from public.app_settings
--   where key = 'public_signup_enabled';
--
-- Lo esperado: una fila con value = 'false' (registro cerrado).
-- Para abrirlo, cambia el value a 'true' como se explica arriba.
-- ------------------------------------------------------------
