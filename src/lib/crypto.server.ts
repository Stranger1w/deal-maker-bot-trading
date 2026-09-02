// AES-GCM encryption for Binance credentials. Server-only.
// The key never leaves the server and plaintext secrets are never returned to the client.

async function getKey(): Promise<CryptoKey> {
  const raw = process.env["CREDENTIALS_ENCRYPTION_KEY"];
  if (!raw) throw new Error("CREDENTIALS_ENCRYPTION_KEY missing");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(raw));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

export async function encryptSecret(plaintext: string): Promise<string> {
  const key = await getKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plaintext)),
  );
  const packed = new Uint8Array(iv.length + cipher.length);
  packed.set(iv, 0);
  packed.set(cipher, iv.length);
  return toBase64(packed);
}

export async function decryptSecret(payload: string): Promise<string> {
  const key = await getKey();
  const packed = fromBase64(payload);
  const iv = packed.slice(0, 12);
  const cipher = packed.slice(12);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, cipher);
  return new TextDecoder().decode(plain);
}

// HMAC-SHA256 signature used to sign Binance REST requests server-side.
export async function signBinanceQuery(query: string, apiSecret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(apiSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(query)));
  return Array.from(sig)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
