/**
 * Motor de backtesting (puro, sin I/O).
 *
 * Usa EXACTAMENTE las mismas funciones que el motor en vivo:
 *  - `senalDe` (src/lib/indicators) para decidir entrada y salida.
 *  - `decidir` y `registrarResultado` (src/lib/strategies) para el tamano y
 *    el estado de la estrategia (rachas, martingala).
 *
 * MODELO DE EJECUCION (conservador, sin mirar al futuro)
 *  - La senal de la vela i se calcula con las velas CERRADAS 0..i-1.
 *  - La entrada se ejecuta a la APERTURA de la vela i (no al cierre): se
 *    asume que se pudo colocar la orden al abrir, sin ventaja por mirar el
 *    cierre antes de entrar.
 *  - El stop-loss y el take-profit se comprueban dentro de la vela con el
 *    maximo y el minimo. Si la vela toca los dos, se asume el peor caso
 *    (stop loss): es lo honesto con velas de 1 minuto.
 *  - Una senal de venta sin posicion abierta se ignora (en spot no se puede
 *    vender lo que no se tiene), igual que en el motor en vivo.
 */

import { buscarIndicador, senalDe } from "../indicators";
import type { PriceSeries } from "../indicators/types";
import { decidir, estadoInicial, type StrategyDef, type StrategyState } from "../strategies/types";
import { ensamblarResultado } from "./metrics";
import type { ConfigBacktest, Operacion, ResultadoBacktest, Vela } from "./types";

/** Cuantas velas hacia atras se le pasan a los indicadores (suficiente para el mas lento). */
export const VENTANA_SERIE = 400;

type Posicion = {
  cantidad: number;
  precioEntrada: number;
  entrada: number;
  costeEntrada: number;
};

/** Serie de precios para los indicadores, con las velas ya cerradas. */
export function serieDesde(velas: readonly Vela[], hasta: number): PriceSeries {
  const desde = Math.max(0, hasta - VENTANA_SERIE + 1);
  const trozo = velas.slice(desde, hasta + 1);
  return {
    open: trozo.map((v) => v.open),
    closes: trozo.map((v) => v.close),
    highs: trozo.map((v) => v.high),
    lows: trozo.map((v) => v.low),
    volumes: trozo.map((v) => v.volume),
    times: trozo.map((v) => new Date(v.time).toISOString()),
  };
}

/** Cantidad que se puede comprar con un importe, respetando stepSize y minNotional. */
export function calcularCantidad(args: {
  monto: number;
  precio: number;
  stepSize: number;
  minQty: number;
  minNotional: number;
}): number {
  const { monto, precio, stepSize, minQty, minNotional } = args;
  if (!(monto > 0) || !(precio > 0) || !(stepSize > 0)) return 0;
  const cruda = monto / precio;
  const cantidad = Math.floor(cruda / stepSize) * stepSize;
  if (cantidad < minQty) return 0;
  if (cantidad * precio < minNotional) return 0;
  // Redondeo a los decimales del stepSize para no arrastrar error de coma flotante.
  const decimales = Math.max(0, (String(stepSize).split(".")[1] ?? "").length);
  return Number(cantidad.toFixed(decimales));
}

/** Dia UTC (YYYY-MM-DD) de una vela, para el limite de operaciones por dia. */
function diaUtc(time: number): string {
  return new Date(time).toISOString().slice(0, 10);
}

/**
 * Ejecuta el backtest. Puro: misma entrada => mismo resultado.
 */
export function ejecutarBacktest(
  velas: readonly Vela[],
  config: ConfigBacktest,
  opciones: { simbolo?: string; fueraDeMuestra?: boolean; operacionesMinimas?: number } = {},
): ResultadoBacktest {
  const simbolo = opciones.simbolo ?? "SIMBOLO";
  const comisionEfectiva = config.costes.comision * (1 - config.costes.descuentoBnb);
  const reglas = config.reglas ?? { stepSize: 0.00001, minQty: 0, minNotional: 0 };
  const operativas = config.maxOperacionesDia ?? 0;

  let capital = config.capitalInicial;
  let posicion: Posicion | null = null;
  let estrategia: StrategyState = estadoInicial();
  const operaciones: Operacion[] = [];
  const curva: number[] = [];
  const operacionesPorDia = new Map<string, number>();

  const serie = serieDesde(velas, 0);
  const minSamples = Math.max(
    1,
    ...config.indicadores.map((id) => buscarIndicador(id)?.minSamples ?? 2),
  );
  void serie;

  for (let i = 0; i < velas.length; i++) {
    const vela = velas[i]!;

    // ── 1) Senal con las velas CERRADAS anteriores (sin mirar la vela actual).
    let senal: "buy" | "sell" | null = null;
    if (i > 0) {
      const previa = serieDesde(velas, i - 1);
      if (previa.closes.length >= minSamples) {
        senal = senalDe(config.indicadores, previa, config.parametros ?? {});
      }
    }
    void serie;

    // ── 2) Gestion de la posicion abierta.
    if (posicion) {
      const stop = posicion.precioEntrada * (1 - config.stopLossPct / 100);
      const take = posicion.precioEntrada * (1 + config.takeProfitPct / 100);
      const tocaStop = config.stopLossPct > 0 && vela.low <= stop;
      const tocaTake = config.takeProfitPct > 0 && vela.high >= take;

      if (tocaStop || tocaTake) {
        // Peor caso primero: si la vela toca los dos, se asume el stop loss.
        const precioSalida = tocaStop ? stop : take;
        operaciones.push(
          cerrarOperacion({
            posicion,
            precioSalida,
            slippage: config.costes.slippage,
            comisionEfectiva,
            salida: vela.time,
            motivo: tocaStop ? "stop_loss" : "take_profit",
          }),
        );
        const cerrada = operaciones[operaciones.length - 1]!;
        // Al abrir se reste el nocional de la caja; al cerrar se suma el
        // efectivo de la venta menos la comision de salida.
        capital = capitalTrasCierre(capital, cerrada, posicion.costeEntrada);
        const resultadoEstrategia = config.estrategia
          ? config.estrategia.registrarResultado(
              estrategia,
              cerrada.pnl,
              config.parametrosEstrategia ?? {},
            )
          : null;
        if (resultadoEstrategia) estrategia = resultadoEstrategia.estado;
        posicion = null;
      } else if (senal === "sell") {
        const operacionesDia = operacionesPorDia.get(diaUtc(vela.time)) ?? 0;
        if (operativas === 0 || operacionesDia < operativas) {
          operaciones.push(
            cerrarOperacion({
              posicion,
              precioSalida: vela.open,
              slippage: config.costes.slippage,
              comisionEfectiva,
              salida: vela.time,
              motivo: "senal",
            }),
          );
          const cerrada = operaciones[operaciones.length - 1]!;
          capital = capitalTrasCierre(capital, cerrada, posicion.costeEntrada);
          const resultadoEstrategia = config.estrategia
            ? config.estrategia.registrarResultado(
                estrategia,
                cerrada.pnl,
                config.parametrosEstrategia ?? {},
              )
            : null;
          if (resultadoEstrategia) estrategia = resultadoEstrategia.estado;
          posicion = null;
        }
      }
    }

    // ── 3) Apertura (solo con senal de compra y sin posicion).
    if (!posicion && senal === "buy") {
      const dia = diaUtc(vela.time);
      const operacionesDia = operacionesPorDia.get(dia) ?? 0;
      if (operativas === 0 || operacionesDia < operativas) {
        if (config.maxCapital && capital > config.maxCapital) {
          // Capital por encima del tope: no se abre nada mas.
        } else {
          const precioEntrada = vela.open * (1 + config.costes.slippage);
          const montoBruto = capital * config.fraccionPorOperacion;
          const decision = config.estrategia
            ? decidir(
                config.estrategia,
                {
                  base: montoBruto,
                  capital,
                  minNotional: reglas.minNotional,
                },
                estrategia,
                config.parametrosEstrategia ?? {},
              )
            : null;
          const tope = config.topeFraccionCapital ?? 1;
          const monto = decision?.monto ?? Math.min(montoBruto, capital * tope);
          const cantidad = calcularCantidad({
            monto,
            precio: precioEntrada,
            stepSize: reglas.stepSize,
            minQty: reglas.minQty,
            minNotional: reglas.minNotional,
          });
          if (cantidad > 0) {
            const notional = cantidad * precioEntrada;
            const costeEntrada = notional * comisionEfectiva;
            capital -= notional + costeEntrada;
            posicion = {
              cantidad,
              precioEntrada,
              entrada: vela.time,
              costeEntrada,
            };
            // Una operacion cuenta para el limite diario cuando se ABRE.
            operacionesPorDia.set(dia, operacionesDia + 1);
          }
        }
      }
    }

    // ── 4) Capital mark-to-market al cierre de la vela.
    const valorPosicion = posicion ? posicion.cantidad * vela.close - posicion.costeEntrada : 0;
    curva.push(Number((capital + valorPosicion).toFixed(8)));
  }

  // ── 5) Posicion abierta al final: se cierra al ultimo cierre (motivo fin_datos).
  if (posicion) {
    const ultima = velas[velas.length - 1]!;
    operaciones.push(
      cerrarOperacion({
        posicion,
        precioSalida: ultima.close,
        slippage: config.costes.slippage,
        comisionEfectiva,
        salida: ultima.time,
        motivo: "fin_datos",
      }),
    );
    const cerrada = operaciones[operaciones.length - 1]!;
    capital = capitalTrasCierre(capital, cerrada, posicion.costeEntrada);
  }

  // Una operacion cuenta para el limite diario cuando se ABRE (contado arriba).

  const capitalFinal = Number(capital.toFixed(8));
  return ensamblarResultado({
    etiqueta: config.etiqueta ?? "backtest",
    simbolo,
    velas,
    operaciones,
    curva,
    capitalInicial: config.capitalInicial,
    capitalFinal,
    duracionMs: (velas[velas.length - 1]?.time ?? 0) - (velas[0]?.time ?? 0),
    comision: config.costes.comision,
    slippage: config.costes.slippage,
    descuentoBnb: config.costes.descuentoBnb,
    operacionesMinimas: opciones.operacionesMinimas,
    fueraDeMuestra: opciones.fueraDeMuestra,
  });
}

/**
 * Caja tras cerrar una operacion.
 *
 * Al abrir se restaron de la caja el nocional y la comision de entrada; al
 * cerrar entra el efectivo de la venta y sale la comision de salida.
 */
function capitalTrasCierre(capital: number, operacion: Operacion, costeEntrada: number): number {
  const comisionSalida = operacion.comisiones - costeEntrada;
  return capital + operacion.efectivo - comisionSalida;
}

/**
 * Cierra una posicion y calcula el P&L neto (con comisiones y slippage).
 *
 * `efectivo` es lo que entra en la caja al cerrar (antes de la comision de
 * salida): el notional de la entrada YA se habia restado de la caja al
 * abrir, asi que al cerrar se suma el efectivo, no el P&L.
 */
function cerrarOperacion(args: {
  posicion: Posicion;
  precioSalida: number;
  slippage: number;
  comisionEfectiva: number;
  salida: number;
  motivo: Operacion["motivo"];
}): Operacion {
  const { posicion, slippage, comisionEfectiva, salida, motivo } = args;
  const precioReal = args.precioSalida * (1 - slippage);
  const efectivo = posicion.cantidad * precioReal;
  const comisionSalida = efectivo * comisionEfectiva;
  const comisionTotal = posicion.costeEntrada + comisionSalida;
  // El bruto se mide SIN slippage: asi el coste de slippage queda visible.
  const precioEntradaSinSlippage = posicion.precioEntrada / (1 + slippage);
  const bruto = posicion.cantidad * (args.precioSalida - precioEntradaSinSlippage);
  const pnl = efectivo - posicion.cantidad * posicion.precioEntrada - comisionTotal;
  const slippageCoste = Math.abs(bruto - (efectivo - posicion.cantidad * precioEntradaSinSlippage));
  return {
    lado: "buy",
    precioEntrada: posicion.precioEntrada,
    precioSalida: precioReal,
    cantidad: posicion.cantidad,
    pnl: Number(pnl.toFixed(8)),
    pnlBruto: Number(bruto.toFixed(8)),
    comisiones: Number(comisionTotal.toFixed(8)),
    costeSlippage: Number(slippageCoste.toFixed(8)),
    costes: Number((comisionTotal + slippageCoste).toFixed(8)),
    efectivo: Number(efectivo.toFixed(8)),
    entrada: posicion.entrada,
    salida,
    motivo,
    duracionMs: salida - posicion.entrada,
  };
}

/** Exportado para reutilizarlo en el panel de metricas. */
export type { StrategyDef };
