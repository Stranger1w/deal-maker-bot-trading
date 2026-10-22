/**
 * DETECTORES DEL ESCUADRON DE RECONOCIMIENTO.
 *
 * QUE SON
 * Reglas que miran velas REALES de Binance y dicen "ha pasado algo en este
 * activo". Cada deteccion dice:
 *   - que paso (kind),
 *   - en que direccion espera que siga (direction),
 *   - a que precio se detecto (referencePrice),
 *   - cuan fuerte es la senal (fuerza: 0..1).
 *
 * QUE NO ES "fuerza"
 * NO es la probabilidad de acertar. Es cuan lejos esta la senal de lo normal
 * (por ejemplo, quantas veces se multiplico el volumen). La probabilidad de
 * acertar se mide DESPUES, con `evaluarDeteccion` y `resumenAcierto`, sobre
 * hallazgos que ya se han resuelto. Confundir las dos cosas fue justo el
 * error que se corrigio antes con el "percentil" del sandbox.
 *
 * TODO ES PURO
 * Sin red y sin base de datos: se puede probar con velas falsas.
 */

export type Vela = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type Direccion = "alcista" | "bajista";

export type Severidad = "info" | "warning" | "critical";

export type Deteccion = {
  kind: string;
  direction: Direccion;
  severity: Severidad;
  /** Fuerza de la senal (0..1). NO es probabilidad de acierto. */
  fuerza: number;
  headline: string;
  detail: string;
  /** Precio de referencia: el del cierre en el que se detecto. */
  referencePrice: number;
  /** Momento (epoch ms) de la vela en la que se detecto. */
  detectadaEn: number;
};

export type OpcionesDeteccion = {
  /** Cuantas velas mira atras para comparar. */
  lookback: number;
  /** Movimiento minimo (en %) para que un hallazgo se considere acertado. */
  minMovePct: number;
  /** Cuantas veces la media el volumen tiene que multiplicarse. */
  umbralVolumen: number;
  /** Movimiento minimo (en %) de la tendencia para considerarla tendencia. */
  umbralTendenciaPct: number;
};

export const OPCIONES_POR_DEFECTO: OpcionesDeteccion = {
  lookback: 24,
  minMovePct: 0.2,
  umbralVolumen: 1.6,
  umbralTendenciaPct: 1.5,
};

export function media(xs: number[]): number {
  if (!xs.length) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

export function desviacion(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = media(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

function redondear(x: number, dec = 3): number {
  const f = 10 ** dec;
  return Math.round(x * f) / f;
}

/**
 * Detecciones sobre la ULTIMA vela de la serie.
 *
 * Devuelve las que aplican segun el enfoque del bot:
 *   - "volume"     -> solo pico de volumen.
 *   - "price"      -> roturas y tendencia.
 *   - "indicators" -> reversion a la media y tendencia.
 *   - "orderbook"  -> no hay order book real: se avisa con el dato de
 *                     volumen y tendencia (y la UI lo dice).
 *   - "news"       -> no hay feed de noticias real: idem.
 */
export function detectarEnVelas(
  velas: Vela[],
  opciones: Partial<OpcionesDeteccion> = {},
  enfoque: string = "price",
): Deteccion[] {
  const o = { ...OPCIONES_POR_DEFECTO, ...opciones };
  const n = velas.length;
  if (n < 5) return [];

  const ult = velas[n - 1]!;
  const cierre = ult.close;
  if (!Number.isFinite(cierre) || cierre <= 0) return [];

  const ventana = velas.slice(Math.max(0, n - 1 - o.lookback), n - 1);
  if (ventana.length < 4) return [];

  const cierres = ventana.map((v) => v.close);
  const volumenes = ventana.map((v) => v.volume);
  const salidas: Deteccion[] = [];

  const quiereVolumen = ["volume", "orderbook", "news"].includes(enfoque);
  const quierePrecio = ["price", "indicators", "orderbook", "news"].includes(enfoque);

  // ── 1) Pico de volumen ──────────────────────────────────────────────────
  if (quiereVolumen && volumenes.length >= 5) {
    const mediaVol = media(volumenes);
    if (mediaVol > 0) {
      const ratio = ult.volume / mediaVol;
      // La direccion es la del CUERPO de la vela (cierre frente a apertura).
      // Una vela plana no tiene direccion: no se inventa (no se avisa).
      const cuerpoPct = ((ult.close - ult.open) / ult.open) * 100;
      if (ratio >= o.umbralVolumen && Math.abs(cuerpoPct) >= 0.05) {
        const sube = cuerpoPct > 0;
        const fuerza = Math.min(1, (ratio - 1) / 3);
        salidas.push({
          kind: "volume_spike",
          direction: sube ? "alcista" : "bajista",
          severity: ratio >= o.umbralVolumen * 1.8 ? "warning" : "info",
          fuerza: redondear(fuerza),
          headline: `Pico de volumen ${redondear(ratio, 2)}x en la ultima vela`,
          detail:
            `El volumen de la ultima vela multiplica por ${redondear(ratio, 2)} la media de las ` +
            `${ventana.length} velas previas y el precio ${sube ? "subio" : "bajo"} ` +
            `${redondear(Math.abs(cuerpoPct), 2)}% dentro de la vela.`,
          referencePrice: cierre,
          detectadaEn: ult.time,
        });
      }
    }
  }

  // ── 2) Rotura del rango (soporte/resistencia) ──────────────────────────
  if (quierePrecio) {
    const maximo = Math.max(...ventana.map((v) => v.high));
    const minimo = Math.min(...ventana.map((v) => v.low));
    if (cierre > maximo) {
      const fuerza = Math.min(1, (((cierre - maximo) / maximo) * 100) / o.umbralTendenciaPct);
      salidas.push({
        kind: "breakout_alcista",
        direction: "alcista",
        severity: "warning",
        fuerza: redondear(fuerza),
        headline: `Ruptura al alza: cierra sobre el maximo de ${ventana.length} velas`,
        detail:
          `El cierre (${redondear(cierre, 2)}) supera el maximo anterior (${redondear(maximo, 2)}). ` +
          `Lo esperable es que la tendencia al alza continue.`,
        referencePrice: cierre,
        detectadaEn: ult.time,
      });
    } else if (cierre < minimo) {
      const fuerza = Math.min(1, (((minimo - cierre) / minimo) * 100) / o.umbralTendenciaPct);
      salidas.push({
        kind: "breakout_bajista",
        direction: "bajista",
        severity: "warning",
        fuerza: redondear(fuerza),
        headline: `Ruptura a la baja: cierra bajo el minimo de ${ventana.length} velas`,
        detail:
          `El cierre (${redondear(cierre, 2)}) pierde el minimo anterior (${redondear(minimo, 2)}). ` +
          `Lo esperable es que la tendencia a la baja continue.`,
        referencePrice: cierre,
        detectadaEn: ult.time,
      });
    }
  }

  // ── 3) Tendencia (momentum) ────────────────────────────────────────────
  if (quierePrecio && ventana.length >= 6) {
    const inicio = cierres[0]!;
    const cambio = ((cierre - inicio) / inicio) * 100;
    if (Math.abs(cambio) >= o.umbralTendenciaPct) {
      const fuerza = Math.min(1, Math.abs(cambio) / (o.umbralTendenciaPct * 3));
      salidas.push({
        kind: "tendencia",
        direction: cambio > 0 ? "alcista" : "bajista",
        severity: Math.abs(cambio) >= o.umbralTendenciaPct * 3 ? "warning" : "info",
        fuerza: redondear(fuerza),
        headline: `Tendencia ${cambio > 0 ? "alcista" : "bajista"} de ${redondear(cambio, 2)}% en ${ventana.length} velas`,
        detail:
          `El precio se ha movido ${redondear(cambio, 2)}% desde el inicio del tramo. ` +
          `Volatilidad media del tramo: ${redondear(desviacion(cierres.map((c, i) => (i ? (c - cierres[i - 1]!) / cierres[i - 1]! : 0))) * 100, 2)}%.`,
        referencePrice: cierre,
        detectadaEn: ult.time,
      });
    }
  }

  // ── 4) Reversion a la media ─────────────────────────────────────────────
  if (enfoque === "indicators" && cierres.length >= 10) {
    const m = media(cierres);
    const d = desviacion(cierres);
    if (d > 0) {
      const z = (cierre - m) / d;
      if (z <= -2) {
        salidas.push({
          kind: "reversion_alcista",
          direction: "alcista",
          severity: "info",
          fuerza: redondear(Math.min(1, Math.abs(z) / 4)),
          headline: `Precio ${redondear(Math.abs(z), 2)} desviaciones por debajo de la media`,
          detail:
            `El cierre esta ${redondear(Math.abs((cierre - m) / m) * 100, 2)}% por debajo de la media ` +
            `del tramo (${redondear(m, 2)}). Historicamente este tipo de exceso se corrige al alza.`,
          referencePrice: cierre,
          detectadaEn: ult.time,
        });
      } else if (z >= 2) {
        salidas.push({
          kind: "reversion_bajista",
          direction: "bajista",
          severity: "info",
          fuerza: redondear(Math.min(1, Math.abs(z) / 4)),
          headline: `Precio ${redondear(Math.abs(z), 2)} desviaciones por encima de la media`,
          detail:
            `El cierre esta ${redondear(Math.abs((cierre - m) / m) * 100, 2)}% por encima de la media ` +
            `del tramo (${redondear(m, 2)}). Historicamente este tipo de exceso se corrige a la baja.`,
          referencePrice: cierre,
          detectadaEn: ult.time,
        });
      }
    }
  }

  return salidas;
}

/** Resultado de comprobar si un hallazgo acertó. */
export type Evaluacion = {
  outcome: "sube" | "baja" | "plano";
  outcomePct: number;
  hit: boolean;
  precioFinal: number;
};

/**
 * Comprueba si un hallazgo acertó, mirando el cierre `horizonte` velas
 * despues de la deteccion.
 *
 * "Acertar" NO es simplemente que el precio suba: el movimiento tiene que
 * superar `minMovePct`. Sin ese minimo, acertar seria lo mismo que tirar una
 * moneda al aire.
 */
export function evaluarDeteccion(
  deteccion: Pick<Deteccion, "direction" | "referencePrice">,
  velas: Vela[],
  horizonte: number,
  minMovePct = OPCIONES_POR_DEFECTO.minMovePct,
): Evaluacion | null {
  if (velas.length < horizonte + 1) return null;
  const final = velas[velas.length - 1]!.close;
  const variacionPct = ((final - deteccion.referencePrice) / deteccion.referencePrice) * 100;
  const umbral = minMovePct;
  const hit = deteccion.direction === "alcista" ? variacionPct >= umbral : variacionPct <= -umbral;
  const outcome: Evaluacion["outcome"] =
    Math.abs(variacionPct) < umbral ? "plano" : variacionPct > 0 ? "sube" : "baja";
  return {
    outcome,
    outcomePct: redondear(variacionPct, 3),
    hit,
    precioFinal: final,
  };
}

/**
 * TASA BASE: cada cuanto se mueve el precio mas de `minMovePct` a la ALZA.
 *
 * Es la referencia honesta: un detector que acierta el 55% solo vale si el
 * mercado subia el 60% de las veces (o al reves). Sin esta referencia, un
 * "55% de acierto" suena a ventaja y puede no serlo.
 */
export function tasaBase(
  velas: Vela[],
  horizonte: number,
  minMovePct = OPCIONES_POR_DEFECTO.minMovePct,
): number {
  if (velas.length < horizonte + 2) return 0;
  let subidas = 0;
  let total = 0;
  for (let i = 0; i + horizonte < velas.length; i++) {
    const inicio = velas[i]!.close;
    const final = velas[i + horizonte]!.close;
    if (!Number.isFinite(inicio) || inicio <= 0) continue;
    total++;
    if (((final - inicio) / inicio) * 100 >= minMovePct) subidas++;
  }
  if (!total) return 0;
  return Math.round((subidas / total) * 1000) / 10;
}

/** Hallazgo ya evaluado (lo que hay en la base de datos). */
export type HallazgoEvaluado = {
  kind: string;
  direction: Direccion | null;
  hit: boolean | null;
  outcome: string | null;
};

/** Resumen por detector: cuantas señales, cuantas acertaron y contra que. */
export type ResumenDetector = {
  kind: string;
  señales: number;
  evaluadas: number;
  aciertos: number;
  /** % de acierto de las señales ya resueltas (null si no hay ninguna). */
  porcentajeAcierto: number | null;
  /** % de veces que el mercado subio de verdad en el mismo periodo (azar). */
  baseRatePct: number | null;
  /** Positivo = gana a la tasa base; null = no se puede afirmar. */
  ventaja: number | null;
  veredicto: "gana-al-azar" | "indistinguible" | "pierde-al-azar" | "sin-datos";
};

export function resumenAcierto(
  hallazgos: HallazgoEvaluado[],
  baseRatePct: number | null,
): ResumenDetector[] {
  const porKind = new Map<string, HallazgoEvaluado[]>();
  for (const h of hallazgos) {
    const lista = porKind.get(h.kind) ?? [];
    lista.push(h);
    porKind.set(h.kind, lista);
  }
  const salida: ResumenDetector[] = [];
  for (const [kind, lista] of porKind) {
    const evaluadas = lista.filter((h) => h.hit !== null && h.hit !== undefined);
    const aciertos = evaluadas.filter((h) => h.hit === true).length;
    const porcentajeAcierto = evaluadas.length
      ? Math.round((aciertos / evaluadas.length) * 1000) / 10
      : null;
    const ventaja =
      porcentajeAcierto !== null && baseRatePct !== null
        ? Math.round((porcentajeAcierto - baseRatePct) * 10) / 10
        : null;
    let veredicto: ResumenDetector["veredicto"] = "sin-datos";
    if (ventaja !== null && evaluadas.length >= 5) {
      veredicto =
        ventaja >= 2 ? "gana-al-azar" : ventaja <= -2 ? "pierde-al-azar" : "indistinguible";
    }
    // Las propiedades se asignan una a una (no con un literal) para que el
    // valor no dependa de como lo lea cada transpilador.
    const fila = {} as ResumenDetector;
    fila.kind = kind;
    fila.señales = lista.length;
    fila.evaluadas = evaluadas.length;
    fila.aciertos = aciertos;
    fila.porcentajeAcierto = porcentajeAcierto;
    fila.baseRatePct = baseRatePct;
    fila.ventaja = ventaja;
    fila.veredicto = veredicto;
    salida.push(fila);
  }
  return salida.sort((a, b) => (b.porcentajeAcierto ?? -1) - (a.porcentajeAcierto ?? -1));
}
