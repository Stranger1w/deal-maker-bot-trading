/**
 * Credenciales de exchange cifradas (server-only).
 *
 * Las claves se guardan cifradas en binance_credentials y se descifran solo
 * en memoria, en el servidor, con CREDENTIALS_ENCRYPTION_KEY. Nunca se
 * registran en logs ni se devuelven al navegador (solo los ultimos 4
 * caracteres).
 *
 * REGLA: solo se usan las credenciales DEL DUEÑO del bot. Un bot jamas
 * opera con las claves de otro usuario.
 */

type Db = Awaited<ReturnType<typeof getDb>>;

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/**
 * Descifra las credenciales Binance de un dueño. Devuelve null si no tiene
 * (o si no se pueden descifrar): quien llama decide que hacer.
 */
export async function loadBinanceSecret(
  db: Db,
  ownerId: string | null,
): Promise<{ apiKey: string; apiSecret: string } | null> {
  if (!ownerId) return null;
  const { data } = await db
    .from("binance_credentials")
    .select("api_key_cipher,api_secret_cipher")
    // types.ts aun no incluye binance_credentials.user_id: cast.
    .eq("user_id" as never, ownerId as never)
    .limit(1)
    .maybeSingle();
  const row = data as { api_key_cipher?: string; api_secret_cipher?: string } | null;
  if (!row?.api_key_cipher || !row?.api_secret_cipher) return null;
  const { decryptSecret } = await import("./crypto.server");
  try {
    return {
      apiKey: await decryptSecret(row.api_key_cipher),
      apiSecret: await decryptSecret(row.api_secret_cipher),
    };
  } catch {
    return null;
  }
}
