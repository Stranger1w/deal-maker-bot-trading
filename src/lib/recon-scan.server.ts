/**
 * ESCANEO DEL ESCUADRON DE RECONOCIMIENTO (servidor).
 *
 * QUE HACE
 * 1) Cada bot de reconocimiento mira su lista de activos con velas REALES de
 *    Binance (endpoint publico, sin credenciales) y aplica los detectores
 *    que le tocan segun su enfoque.
 * 2) Cada hallazgo guarda el precio de referencia y la direccion esperada.
 * 3) Los hallazgos viejos (los que ya tienen pasado el horizonte) se
 *    EVALUAN: se mira donde estaba el precio ese numero de velas despues y
 *    se anota si acerto.
 * 4) Se calcula la TASA BASE: que tanto subio el mercado de verdad en ese
 *    mismo periodo. Sin esa referencia, "acierta el 55%" no significa nada.
 *
 * NO ABRE NI CIERRA POSICIONES. Solo observa.
 */
import {
  detectarEnVelas,
  evaluarDeteccion,
  tasaBase,
  type Deteccion,
  type Vela,
} from "./recon-deteccion";
import { velasDeBinance } from "./velas.server";

export type AjustesEscaneo = {
  intervalo: string;
  lookback: number;
  horizonte: number;
  minMovePct: number;
  umbralVolumen: number;
  umbralTendenciaPct: number;
};

export const AJUSTES_POR_DEFECTO: AjustesEscaneo = {
  intervalo: "15m",
  lookback: 24,
  horizonte: 6,
  minMovePct: 0.2,
  umbralVolumen: 1.6,
  umbralTendenciaPct: 1.5,
};

/** Cuantas velas se piden: el lookback, el horizonte y un margen. */
export function velasNecesarias(ajustes: AjustesEscaneo): number {
  return Math.min(1000, ajustes.lookback + ajustes.horizonte + 20);
}

export type ResultadoSimbolo = {
  simbolo: string;
  velas: number;
  detecciones: Deteccion[];
  /** Tasa base del activo en la ventana (cuanto subio de verdad). */
  baseRatePct: number;
  error: string | null;
};

/**
 * Analiza un activo con velas reales.
 * No lanza nunca: si el simbolo no existe o falla la red, lo dice.
 */
export async function analizarSimbolo(
  simbolo: string,
  ajustes: AjustesEscaneo,
  enfoque: string,
): Promise<ResultadoSimbolo> {
  const vacio: ResultadoSimbolo = {
    simbolo,
    velas: 0,
    detecciones: [],
    baseRatePct: 0,
    error: null,
  };
  let velas: Vela[];
  try {
    velas = await velasDeBinance({
      simbolo,
      intervalo: ajustes.intervalo,
      limite: velasNecesarias(ajustes),
      mercado: "spot",
    });
  } catch (e) {
    return {
      ...vacio,
      error: e instanceof Error ? e.message.slice(0, 160) : "no se pudieron descargar las velas",
    };
  }
  if (velas.length < ajustes.lookback + 2) {
    return { ...vacio, error: `solo ${velas.length} velas disponibles` };
  }
  const detecciones = detectarEnVelas(
    velas,
    {
      lookback: ajustes.lookback,
      minMovePct: ajustes.minMovePct,
      umbralVolumen: ajustes.umbralVolumen,
      umbralTendenciaPct: ajustes.umbralTendenciaPct,
    },
    enfoque,
  );
  return {
    simbolo,
    velas: velas.length,
    detecciones,
    baseRatePct: tasaBase(velas, ajustes.horizonte, ajustes.minMovePct),
    error: null,
  };
}

/**
 * Evalua un hallazgo ya pasado de tiempo con las velas actuales.
 * Devuelve null si todavia no se puede saber (faltan velas).
 */
export function evaluarHallazgo(
  finding: {
    direction: string | null;
    reference_price: number | null;
    horizon_candles: number | null;
  },
  velas: Vela[],
  minMovePct: number,
): { outcome: string; outcomePct: number; hit: boolean } | null {
  if (!finding.direction || !finding.reference_price) return null;
  const horizonte = finding.horizon_candles ?? AJUSTES_POR_DEFECTO.horizonte;
  const ev = evaluarDeteccion(
    {
      direction: finding.direction as "alcista" | "bajista",
      referencePrice: Number(finding.reference_price),
    },
    velas,
    horizonte,
    minMovePct,
  );
  if (!ev) return null;
  return { outcome: ev.outcome, outcomePct: ev.outcomePct, hit: ev.hit };
}
