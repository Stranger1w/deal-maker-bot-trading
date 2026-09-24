// Validación local de direcciones Monero (XMR). Sin dependencias externas y sin red,
// así que se puede usar tanto en el navegador (formulario) como en el servidor.
//
// Una dirección Monero son 69 bytes codificados con el base58 propio de Monero:
//   [prefijo de red 1B][clave de gasto 32B][clave de vista 32B][checksum 4B]
// El checksum son los primeros 4 bytes de Keccak-256 (Keccak, NO SHA3-256) del cuerpo.
// Las direcciones integradas (con payment id) ocupan 77 bytes.
//
// Validar aquí tiene dos ventajas: no se envían direcciones mal escritas a la API
// pública de la pool y se puede distinguir "dirección inválida" de "dirección válida
// pero todavía sin actividad en la pool".

/** Longitudes válidas: 69 bytes -> 95 caracteres, 77 bytes (integrada) -> 106. */
export const MONERO_ADDRESS_LENGTH = { standard: 95, integrated: 106 } as const;

export type MoneroAddressKind = "standard" | "subaddress" | "integrated";

/** Primer byte de la dirección (red principal). Testnet (53/54/63) queda fuera. */
const NETWORK_PREFIXES: Record<number, MoneroAddressKind> = {
  18: "standard",
  19: "integrated",
  42: "subaddress",
};

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

/** Bytes que representa un bloque final de N caracteres (bloques completos: 11 -> 8). */
const ENCODED_TO_BYTES: Record<number, number> = {
  2: 1,
  3: 2,
  5: 3,
  6: 4,
  7: 5,
  9: 6,
  10: 7,
  11: 8,
};

/* ------------------------------ Keccak-256 ------------------------------ */

const MASK64 = (1n << 64n) - 1n;

const ROUND_CONSTANTS = [
  0x0000000000000001n,
  0x0000000000008082n,
  0x800000000000808an,
  0x8000000080008000n,
  0x000000000000808bn,
  0x0000000080000001n,
  0x8000000080008081n,
  0x8000000000008009n,
  0x000000000000008an,
  0x0000000000000088n,
  0x0000000080008009n,
  0x000000008000000an,
  0x000000008000808bn,
  0x800000000000008bn,
  0x8000000000008089n,
  0x8000000000008003n,
  0x8000000000008002n,
  0x8000000000000080n,
  0x000000000000800an,
  0x800000008000000an,
  0x8000000080008081n,
  0x8000000000008080n,
  0x0000000080000001n,
  0x8000000080008008n,
];

const ROTATION = [
  1, 3, 6, 10, 15, 21, 28, 36, 45, 55, 2, 14, 27, 41, 56, 8, 25, 43, 62, 18, 39, 61, 20, 44,
];

const PERMUTATION = [
  10, 7, 11, 17, 18, 3, 5, 16, 8, 21, 24, 4, 15, 23, 19, 13, 12, 2, 20, 14, 22, 9, 6, 1,
];

const rotateLeft = (value: bigint, bits: number): bigint =>
  ((value << BigInt(bits)) | (value >> BigInt(64 - bits))) & MASK64;

const lane = (state: bigint[], index: number): bigint => state[index] ?? 0n;

function keccakF(state: bigint[]): void {
  const column = new Array<bigint>(5).fill(0n);
  for (let round = 0; round < 24; round++) {
    for (let i = 0; i < 5; i++) {
      column[i] =
        lane(state, i) ^
        lane(state, i + 5) ^
        lane(state, i + 10) ^
        lane(state, i + 15) ^
        lane(state, i + 20);
    }
    for (let i = 0; i < 5; i++) {
      const theta = lane(column, (i + 4) % 5) ^ rotateLeft(lane(column, (i + 1) % 5), 1);
      for (let j = 0; j < 25; j += 5) {
        state[j + i] = (lane(state, j + i) ^ theta) & MASK64;
      }
    }
    let carry = lane(state, 1);
    for (let i = 0; i < 24; i++) {
      const target = PERMUTATION[i] ?? 0;
      const previous = lane(state, target);
      state[target] = rotateLeft(carry, ROTATION[i] ?? 0);
      carry = previous;
    }
    for (let j = 0; j < 25; j += 5) {
      for (let i = 0; i < 5; i++) column[i] = lane(state, j + i);
      for (let i = 0; i < 5; i++) {
        state[j + i] =
          (lane(state, j + i) ^ (~lane(column, (i + 1) % 5) & MASK64 & lane(column, (i + 2) % 5))) &
          MASK64;
      }
    }
    state[0] = (lane(state, 0) ^ (ROUND_CONSTANTS[round] ?? 0n)) & MASK64;
  }
}

/** Keccak-256 (variante usada por Monero, con padding 0x01). */
export function keccak256(input: Uint8Array): Uint8Array {
  const rate = 136;
  const state = new Array<bigint>(25).fill(0n);
  const total = Math.ceil((input.length + 1) / rate) * rate;
  const padded = new Uint8Array(total);
  padded.set(input);
  padded[input.length] = (padded[input.length] ?? 0) ^ 0x01;
  padded[total - 1] = (padded[total - 1] ?? 0) ^ 0x80;

  for (let offset = 0; offset < total; offset += rate) {
    for (let index = 0; index < rate / 8; index++) {
      let value = 0n;
      for (let byte = 7; byte >= 0; byte--) {
        value = (value << 8n) | BigInt(padded[offset + index * 8 + byte] ?? 0);
      }
      state[index] = (lane(state, index) ^ value) & MASK64;
    }
    keccakF(state);
  }

  const digest = new Uint8Array(32);
  for (let index = 0; index < 4; index++) {
    for (let byte = 0; byte < 8; byte++) {
      digest[index * 8 + byte] = Number((lane(state, index) >> BigInt(byte * 8)) & 0xffn);
    }
  }
  return digest;
}

/* --------------------------- base58 de Monero --------------------------- */

/** Decodifica base58 de Monero (bloques de 11 caracteres -> 8 bytes). `null` si no es válido. */
export function moneroBase58Decode(value: string): Uint8Array | null {
  const bytes: number[] = [];
  let index = 0;

  const decodeChunk = (chunk: string, size: number): number[] | null => {
    let accumulator = 0n;
    for (const char of chunk) {
      const order = ALPHABET.indexOf(char);
      if (order < 0) return null;
      accumulator = accumulator * 58n + BigInt(order);
    }
    if (accumulator >= 1n << BigInt(8 * size)) return null;
    const out: number[] = [];
    for (let byte = size - 1; byte >= 0; byte--) {
      out.push(Number((accumulator >> BigInt(byte * 8)) & 0xffn));
    }
    return out;
  };

  while (value.length - index >= 11) {
    const chunk = decodeChunk(value.slice(index, index + 11), 8);
    if (!chunk) return null;
    bytes.push(...chunk);
    index += 11;
  }

  const rest = value.slice(index);
  if (rest.length > 0) {
    const size = ENCODED_TO_BYTES[rest.length];
    if (!size) return null;
    const chunk = decodeChunk(rest, size);
    if (!chunk) return null;
    bytes.push(...chunk);
  }

  return Uint8Array.from(bytes);
}

/* ------------------------------ Validación ----------------------------- */

export type MoneroAddressCheck =
  | {
      ok: true;
      address: string;
      kind: MoneroAddressKind;
      length: number;
      prefix: number;
      /** Texto listo para mostrar en la UI. */
      message: string;
    }
  | {
      ok: false;
      address: string;
      length: number;
      reason: string;
      /** Texto listo para mostrar en la UI. */
      message: string;
    };

/**
 * Valida formato, longitud, prefijo de red y checksum de una dirección Monero.
 * Nunca lanza: devuelve `ok:false` con el motivo exacto.
 */
export function validateMoneroAddress(value: string | null | undefined): MoneroAddressCheck {
  const address = String(value ?? "").trim();
  const fail = (reason: string, message: string): MoneroAddressCheck => ({
    ok: false,
    address,
    length: address.length,
    reason,
    message,
  });

  if (!address) return fail("vacia", "Escribe tu dirección de wallet Monero (XMR).");
  if (/\s/.test(address)) {
    return fail("espacios", "La dirección no puede tener espacios ni saltos de línea.");
  }
  if (
    address.length !== MONERO_ADDRESS_LENGTH.standard &&
    address.length !== MONERO_ADDRESS_LENGTH.integrated
  ) {
    return fail(
      "longitud",
      `Una dirección Monero tiene 95 caracteres (la tuya tiene ${address.length}).`,
    );
  }
  if (!/^[48]/.test(address)) {
    return fail("prefijo", "Debe empezar por 4 (dirección principal) u 8 (subdirección).");
  }

  const bytes = moneroBase58Decode(address);
  if (!bytes) {
    return fail("base58", "Caracteres no válidos de base58: revisa que la copiaste completa.");
  }
  if (bytes.length !== 69 && bytes.length !== 77) {
    return fail("bytes", `Decodificación inesperada (${bytes.length} bytes en lugar de 69 o 77).`);
  }

  const prefix = bytes[0] ?? -1;
  const kind = NETWORK_PREFIXES[prefix];
  if (!kind) {
    return fail(
      "red",
      "No es una dirección de la red principal de Monero (las de testnet no sirven en nanopool).",
    );
  }

  const checksum = bytes.slice(bytes.length - 4);
  const expected = keccak256(bytes.slice(0, bytes.length - 4)).slice(0, 4);
  const checksumOk = checksum.every((byte, i) => byte === expected[i]);
  if (!checksumOk) {
    return fail("checksum", "El checksum no cuadra: hay un carácter mal copiado en la dirección.");
  }

  return {
    ok: true,
    address,
    kind,
    length: address.length,
    prefix,
    message:
      kind === "subaddress"
        ? "Subdirección Monero válida (checksum correcto)."
        : kind === "integrated"
          ? "Dirección Monero integrada válida (checksum correcto)."
          : "Dirección Monero válida (checksum correcto).",
  };
}

export function isMoneroAddress(value: string | null | undefined): boolean {
  return validateMoneroAddress(value).ok;
}

/** Etiqueta corta y legible del tipo de dirección. */
export function moneroAddressKindLabel(kind: string | null | undefined): string {
  if (kind === "subaddress") return "subdirección";
  if (kind === "integrated") return "integrada";
  if (kind === "standard") return "principal";
  return "desconocida";
}

/** Dirección abreviada para la UI: 44AFFq…BEP3A */
export function shortMoneroAddress(address: string, head = 6, tail = 4): string {
  const value = String(address ?? "").trim();
  if (value.length <= head + tail) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}
