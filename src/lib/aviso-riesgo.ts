/**
 * Aviso de riesgo: hay que leerlo y aceptarlo antes de operar con dinero
 * real.
 *
 * POR QUE
 * La app opera fondos de la persona que la usa. Activar un bot en modo Real
 * sin decir claramente que se puede perder TODO el capital no es honesto:
 * el backtest, el paper trading y los tests de testnet prueban la
 * PLOMERIA, no que la estrategia gane dinero. Casi ninguna estrategia de
 * spot minorista gana tras comisiones, y el que la usa tiene que saberlo
 * antes de pulsar el boton.
 *
 * La aceptacion queda auditada (audit_events), con la VERSION del aviso:
 * si el texto cambia, hay que volver a aceptarlo.
 *
 * Nota: este aviso NO es una garantia de que la estrategia gane, ni una
 * promesa de resultados. Es lo contrario: es la advertencia de que puede
 * no ganar.
 */

/** Version del aviso: si cambia el texto, hay que volver a aceptarlo. */
export const AVISO_RIESGO_VERSION = "v1";

/** Texto que ve el usuario antes de activar bots reales. */
export const AVISO_RIESGO_TEXTO = [
  "Puedes perder TODO el capital de los bots que pongas en modo Real.",
  "Los resultados de backtest, paper trading y testnet prueban que la mecánica funciona, NO que la estrategia gane dinero: con comisiones y slippage, casi ninguna estrategia de spot minorista gana.",
  "No hay ninguna garantía de ganancias, y ninguna estimación de rentabilidad que valga.",
  "El motor puede abrir y cerrar posiciones automáticamente, sin que estés mirando, y una estrategia que funciona en un par o un mes puede perder en otro.",
  "Empieza con un solo bot y una cantidad que puedas perder entera. Si la compuerta de promoción (demo, operaciones mínimas, P&L positivo y superar al mercado) no se cumple, el bot no debería pasar a Real.",
].join(" ");

/** Accion de auditoria con la que se registra la aceptacion. */
export const ACCION_ACEPTACION = "risk.notice_accepted";
