/**
 * Metricas honestas del motor (puras, sin I/O).
 *
 * QUE MIDE Y QUE NO
 * Mide lo que se puede medir de verdad: cuanto dinero gano o perdio cada
 * bot, cada indicador, cada par y cada hora del dia, cuantas operaciones
 * gano, cuanto se comieron los costes y si el resultado supera al
 * benchmark.
 *
 * NO mide "rentabilidad garantizada" ni "la estrategia que va a ganar".
 * Con pocas operaciones, estas cifras son RUIDO, y por eso cada grupo
 * lleva su numero de operaciones y el panel avisa cuando no hay suficientes.
 */

export type OperacionMedida = {
  botId: string;
  botName: string;
  simbolo: string;
  lado: string;
  pnl: number;
  modo: string;
  precio: number;
  cantidad: number;
  createdAt: string;
  /** Indicadores que dispararon la senal (vacio si no se registraron). */
  indicadores: string[];
  /** Motivo: compra, cierre_senal, stop_loss, take_profit... */
  motivo: string | null;
};

export type ResumenGrupo = {
  clave: string;
  operaciones: number;
  pnlNeto: number;
  ganadoras: number;
  perdedoras: number;
  winRatePct: number;
  /** Ganancia total / perdida total. */
  profitFactor: number;
  mejorOperacion: number;
  peorOperacion: number;
  /** true si el grupo no tiene suficientes operaciones para significar algo. */
  sinSignificado: boolean;
};

/** Operaciones minimas para que un grupo signifique algo. */
export const MINIMO_OPERACIONES = 30;

/** Agrupa operaciones por una clave y resume cada grupo. */
export function resumenPor(
  claveDe: (op: OperacionMedida) => string | null,
  operaciones: readonly OperacionMedida[],
  minimoOperaciones = MINIMO_OPERACIONES,
): ResumenGrupo[] {
  const grupos = new Map<string, OperacionMedida[]>();
  for (const op of operaciones) {
    const clave = claveDe(op);
    if (!clave) continue;
    const lista = grupos.get(clave);
    if (lista) lista.push(op);
    else grupos.set(clave, [op]);
  }

  const salida: ResumenGrupo[] = [];
  for (const [clave, lista] of grupos) {
    const pnls = lista.map((o) => o.pnl);
    const ganadoras = pnls.filter((p) => p > 0);
    const perdedoras = pnls.filter((p) => p < 0);
    const sumaGanadora = ganadoras.reduce((a, p) => a + p, 0);
    const sumaPerdedora = Math.abs(perdedoras.reduce((a, p) => a + p, 0));
    salida.push({
      clave,
      operaciones: lista.length,
      pnlNeto: Number(pnls.reduce((a, p) => a + p, 0).toFixed(4)),
      ganadoras: ganadoras.length,
      perdedoras: perdedoras.length,
      winRatePct: Number(((ganadoras.length / (pnls.length || 1)) * 100).toFixed(2)),
      profitFactor:
        sumaPerdedora > 0
          ? Number((sumaGanadora / sumaPerdedora).toFixed(4))
          : sumaGanadora > 0
            ? 999
            : 0,
      mejorOperacion: pnls.length ? Number(Math.max(...pnls).toFixed(4)) : 0,
      peorOperacion: pnls.length ? Number(Math.min(...pnls).toFixed(4)) : 0,
      sinSignificado: pnls.length < minimoOperaciones,
    });
  }
  // Primero los que mas ganan (o pierden) y despues los mas operados.
  salida.sort((a, b) => b.pnlNeto - a.pnlNeto || b.operaciones - a.operaciones);
  return salida;
}

/** Operaciones cerradas (ventas) de un conjunto: solo ellas tienen P&L. */
export function operacionesCerradas(operaciones: readonly OperacionMedida[]): OperacionMedida[] {
  return operaciones.filter((o) => o.lado === "sell" && Number.isFinite(o.pnl));
}

/** Hora del dia (UTC) de una operacion, como "14". */
export function horaDe(createdAt: string): string {
  const d = new Date(createdAt);
  if (Number.isNaN(d.getTime())) return "";
  return String(d.getUTCHours()).padStart(2, "0");
}

/** Indicadores que dispararon una operacion (vacio si no se registraron). */
export function indicadoresDe(op: OperacionMedida): string[] {
  return op.indicadores ?? [];
}

/**
 * Bots que llevan MUCHAS operaciones y siguen sin ventaja.
 *
 * Es la alerta que pide el plan: un bot con muchas operaciones y profit
 * factor por debajo de 1 esta quemando capital de forma sistematica. Con
 * pocas operaciones no se dice nada: seria ruido.
 */
export function botsSinVentaja(
  operaciones: readonly OperacionMedida[],
  opciones: { minimoOperaciones?: number; minimoProfitFactor?: number } = {},
): {
  botId: string;
  botName: string;
  operaciones: number;
  pnlNeto: number;
  profitFactor: number;
}[] {
  const minimo = opciones.minimoOperaciones ?? MINIMO_OPERACIONES;
  const minimoPf = opciones.minimoProfitFactor ?? 1;
  const cerradas = operacionesCerradas(operaciones);
  const porBot = resumenPor((o) => o.botId, cerradas);
  return porBot
    .filter((g) => g.operaciones >= minimo && g.profitFactor < minimoPf)
    .map((g) => {
      const op = cerradas.find((o) => o.botId === g.clave);
      return {
        botId: g.clave,
        botName: op?.botName ?? g.clave,
        operaciones: g.operaciones,
        pnlNeto: g.pnlNeto,
        profitFactor: g.profitFactor,
      };
    });
}

/** Coste estimado de la operacion: comisiones + slippage por lado. */
export function costeDeOperacion(
  op: { precio: number; cantidad: number },
  modelo: { comision?: number; slippage?: number; descuentoBnb?: number } = {},
): number {
  const comision = modelo.comision ?? 0.001;
  const slippage = modelo.slippage ?? 0.0005;
  const descuento = modelo.descuentoBnb ?? 0.1;
  const notional = op.precio * op.cantidad;
  return notional * comision * (1 - descuento) + notional * slippage;
}
