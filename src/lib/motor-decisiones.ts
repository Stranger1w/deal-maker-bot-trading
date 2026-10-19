/**
 * Diario del motor: que hizo (y que NO hizo) cada bot en el ultimo ciclo.
 *
 * QUE PROBLEMA RESUELVE
 * "Mi bot no opera y no se por que" es la pregunta mas frustrante de las
 * que se le hacen a un bot. Las razones son muchas y todas legitimas:
 * sin senal de compra, filtro de regimen, enfriamiento tras rachas, limite
 * por par, sesion cerrada, kill switch... y hasta ahora solo se podian
 * ver dispersas en el log de cada bot.
 *
 * Aqui se recoge UNA linea por bot y ciclo, con el motivo, para poder
 * mostrarlas juntas en la pestana Motor.
 *
 * Puro: solo tipos y funciones de resumen, sin base de datos.
 */

export type AccionMotor = "entrada" | "salida" | "omitido" | "detenido" | "error";

export type DecisionMotor = {
  bot_id: string;
  bot: string;
  simbolo: string | null;
  accion: AccionMotor;
  /** Codigo corto del motivo (para filtrar y comparar). */
  motivo: string;
  /** Explicacion legible en una linea. */
  detalle: string | null;
};

export type ResumenCiclo = {
  /** Bots revisados. */
  revisados: number;
  /** Bots que operaron (entrada o salida). */
  operaron: number;
  /** Bots omitidos (no operaron, y no es un problema). */
  omitieron: number;
  /** Bots detenidos por un limite de riesgo. */
  detenidos: number;
  /** Errores. */
  errores: number;
  /** Motivo mas frecuente de los omitidos. */
  motivoPrincipal: { motivo: string; veces: number } | null;
};

/** Resumen de un ciclo a partir de las decisiones. */
export function resumirCiclo(decisiones: readonly DecisionMotor[]): ResumenCiclo {
  const porMotivo = new Map<string, number>();
  let operaron = 0;
  let omitieron = 0;
  let detenidos = 0;
  let errores = 0;

  for (const d of decisiones) {
    if (d.accion === "entrada" || d.accion === "salida") operaron++;
    else if (d.accion === "omitido") {
      omitieron++;
      porMotivo.set(d.motivo, (porMotivo.get(d.motivo) ?? 0) + 1);
    } else if (d.accion === "detenido") detenidos++;
    else errores++;
  }

  let principal: { motivo: string; veces: number } | null = null;
  for (const [motivo, veces] of porMotivo) {
    if (!principal || veces > principal.veces) principal = { motivo, veces };
  }

  return {
    revisados: decisiones.length,
    operaron,
    omitieron,
    detenidos,
    errores,
    motivoPrincipal: principal,
  };
}

/** Etiquetas legibles de los motivos (para la UI). */
export const MOTIVOS: Record<string, string> = {
  sin_senal: "Sin señal de compra",
  sin_datos: "Sin datos del mercado",
  filtro_regimen: "Filtrado por régimen de mercado",
  enfriamiento: "Enfriamiento tras racha de pérdidas",
  limite_por_par: "Límite de operaciones por par",
  limite_diario: "Límite de operaciones por día",
  sin_sesion: "Sin sesión de motor abierta",
  dry_run: "Orden no enviada (dry-run)",
  sin_operacion: "La señal no pedía operar",
  kill_switch: "Kill switch global activado",
  real_bloqueado: "Trading real bloqueado (sin credenciales o sin autorización)",
  riesgo: "Detenido por un límite de riesgo",
  error: "Error en el ciclo",
  entrada: "Entrada",
  salida: "Salida",
};
