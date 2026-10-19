/**
 * Reconciliacion: el estado local frente al estado real del exchange.
 *
 * POR QUE
 * El motor guarda su propia idea de la posicion (la ultima compra en
 * bot_executions). Si algo se sale de esa idea - una venta manual desde la
 * app de Binance, una orden que se ejecuto a medias, un reinicio del motor
 * a mitad de un ciclo - el motor sigue creyendo que tiene una posicion que
 * no existe, o al reves, y puede abrir una segunda posicion encima.
 *
 * Con dinero real, eso son dos veces la posicion. Por eso antes de operar
 * un bot en Real se comprueba contra Binance.
 *
 * La comparacion es una funcion PURA (testeable) y la consulta al exchange
 * va aparte (server-only, con las credenciales del dueno del bot).
 */

export type PosicionLocal = {
  /** Cantidad del activo base. */
  cantidad: number;
  /** Precio de entrada. */
  precio: number;
};

export type TipoDiscrepancia =
  /** El motor cree que hay posicion y el exchange no. */
  | "posicion_sin_exchange"
  /** El exchange tiene una posicion que el motor no conoce. */
  | "sin_posicion_local"
  /** Las cantidades no coinciden. */
  | "cantidad_distinta";

export type Discrepancia = {
  tipo: TipoDiscrepancia;
  detalle: string;
  /** Cantidad local (la que el motor cree). */
  local: number;
  /** Cantidad en el exchange (la real). */
  exchange: number;
};

/** Tolerancia al comparar cantidades (por debajo, se consideran iguales). */
export const TOLERANCIA = 1e-8;

/**
 * Compara la posicion local con la cantidad real del exchange.
 *
 * `exchange` es null cuando no se pudo consultar (sin credenciales, sin
 * red, region bloqueada): en ese caso NO se inventa ninguna discrepancia,
 * pero se avisa con un tipo propio para que la UI diga "no se pudo
 * comprobar" en lugar de "todo correcto".
 */
export function compararPosicion(
  local: PosicionLocal | null,
  exchange: number | null,
): Discrepancia[] {
  if (exchange === null) {
    return [
      {
        tipo: "sin_posicion_local",
        detalle: "No se pudo consultar el exchange: la posición no se ha comprobado.",
        local: local?.cantidad ?? 0,
        exchange: 0,
      },
    ];
  }

  const discrepancias: Discrepancia[] = [];

  if (local === null || local.cantidad <= 0) {
    if (exchange > TOLERANCIA) {
      discrepancias.push({
        tipo: "sin_posicion_local",
        detalle: `El exchange tiene ${exchange} y el motor no registra ninguna posición: puede ser una compra manual.`,
        local: 0,
        exchange,
      });
    }
    return discrepancias;
  }

  if (exchange <= TOLERANCIA) {
    discrepancias.push({
      tipo: "posicion_sin_exchange",
      detalle: `El motor cree que tiene ${local.cantidad} y el exchange no tiene nada: la posición ya no existe.`,
      local: local.cantidad,
      exchange: 0,
    });
    return discrepancias;
  }

  if (Math.abs(exchange - local.cantidad) > TOLERANCIA) {
    discrepancias.push({
      tipo: "cantidad_distinta",
      detalle: `El motor cree que tiene ${local.cantidad} y el exchange tiene ${exchange}: la posición no cuadra.`,
      local: local.cantidad,
      exchange,
    });
  }

  return discrepancias;
}
