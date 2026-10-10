// Aislamiento por dueno de los calculos del tick del motor (puro, sin E/S).
//
// El tick procesa a la vez los bots de todos los usuarios. Estos helpers evitan
// que el capital, la concentracion o las perdidas de un usuario cuenten contra
// otro y que el limite de un usuario frene los bots (o el kill switch) del
// administrador.
//
// "Ambito del administrador": la fila de automation_settings pertenece al
// administrador. Si esa fila aun no tiene dueno (instalaciones anteriores a la
// fase 1), todo cuenta como administrador para no cambiar el comportamiento.

/** Clave para bots sin user_id (filas heredadas). */
export const SIN_DUENO = "_sin_dueno";

export type BotCapital = {
  pair: string;
  capital: number | string | null;
  user_id?: string | null;
};

export type CapitalDueno = {
  /** Capital total de los bots del dueno. */
  squad: number;
  /** Capital del dueno por par. */
  pares: Record<string, number>;
};

/** user_id de una fila cualquiera (types.ts aun no declara user_id en todas las tablas). */
export function duenoDe(fila: unknown): string | null {
  const valor = (fila as { user_id?: unknown } | null | undefined)?.user_id;
  return typeof valor === "string" ? valor : null;
}

export function claveDueno(userId: string | null | undefined): string {
  return userId ?? SIN_DUENO;
}

/** true si la clave pertenece al ambito del administrador. */
export function esDelAdmin(clave: string, adminId: string | null | undefined): boolean {
  return adminId == null || clave === adminId || clave === SIN_DUENO;
}

/** Capital total y por par, agrupado por dueno. */
export function capitalPorDueno(bots: readonly BotCapital[]): Map<string, CapitalDueno> {
  const mapa = new Map<string, CapitalDueno>();
  for (const bot of bots) {
    const clave = claveDueno(bot.user_id);
    const actual = mapa.get(clave) ?? { squad: 0, pares: {} };
    const capital = Number(bot.capital ?? 0);
    actual.squad += capital;
    actual.pares[bot.pair] = (actual.pares[bot.pair] ?? 0) + capital;
    mapa.set(clave, actual);
  }
  return mapa;
}

/** Porcentaje del capital del dueno concentrado en un par (0 si no tiene capital). */
export function concentracionPct(capital: CapitalDueno | undefined, pair: string): number {
  if (!capital || capital.squad <= 0) return 0;
  return ((capital.pares[pair] ?? 0) / capital.squad) * 100;
}

/** Acumula una perdida (valor positivo) en el dueno indicado. */
export function sumarPerdida(
  mapa: Map<string, number>,
  userId: string | null | undefined,
  perdida: number,
): void {
  if (!(perdida > 0)) return;
  const clave = claveDueno(userId);
  mapa.set(clave, (mapa.get(clave) ?? 0) + perdida);
}

/** Perdida acumulada dentro del ambito del administrador. */
export function perdidaDelAdmin(
  mapa: ReadonlyMap<string, number>,
  adminId: string | null | undefined,
): number {
  let total = 0;
  for (const [clave, valor] of mapa) {
    if (esDelAdmin(clave, adminId)) total += valor;
  }
  return total;
}

/** Duenos que NO son el administrador y alcanzaron el limite de perdida. */
export function duenosQueSuperan(
  mapa: ReadonlyMap<string, number>,
  limite: number,
  adminId: string | null | undefined,
): string[] {
  const superan: string[] = [];
  for (const [clave, valor] of mapa) {
    if (esDelAdmin(clave, adminId)) continue;
    if (valor >= limite) superan.push(clave);
  }
  return superan.sort();
}
