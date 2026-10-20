/**
 * Estado de la base de datos: que migraciones faltan por aplicar.
 *
 * POR QUE ESTO EXISTE
 * Las migraciones las aplica el dueno a mano en el SQL Editor de Supabase.
 * Mientras falte alguna, el motor funciona (todo lo nuevo esta hecho para
 * degradar sin romperse) pero se pierden cosas: el desglose por indicador,
 * el diario del motor, el tamano por riesgo...
 *
 * En vez de pedirle que mire una lista, la app comprueba el esquema REAL con
 * un par de consultas y le dice exactamente que SQL le falta.
 */

type Db = Awaited<ReturnType<typeof getDb>>;

/**
 * Cliente minimo para las comprobaciones de esquema: aqui se consulta con
 * nombres de tabla y columna DINAMICOS (el cliente tipado solo acepta
 * literales, y justamente lo que hay que probar son columnas que puede que
 * no existan). El unico cast del modulo esta en la firma.
 */
export type ClienteEsquema = {
  from: (tabla: string) => ConstructorEsquema;
};

type RespuestaEsquema = { error: { message: string } | null; data: unknown };

export type ConstructorEsquema = {
  select: (columnas: string) => ConstructorEsquema;
  eq: (columna: string, valor: string) => ConstructorEsquema;
  limit: (n: number) => Promise<RespuestaEsquema>;
  /** El constructor de PostgREST se puede esperar en cualquier punto. */
  then: <T1 = RespuestaEsquema, T2 = never>(
    onCumplido?: ((valor: RespuestaEsquema) => T1 | PromiseLike<T1>) | null,
    onRechazado?: ((razon: unknown) => T2 | PromiseLike<T2>) | null,
  ) => Promise<T1 | T2>;
};

async function getDb() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export type Migracion = {
  /** Fichero .sql (en supabase/migrations/). */
  fichero: string;
  titulo: string;
  /** Que se pierde si no se aplica. */
  paraQueSirve: string;
  aplicada: boolean;
  /** Que se ha comprobado para decidirlo. */
  comprobacion: string;
};

/** Una columna existe si la consulta con esa columna no falla. */
async function existeColumna(db: ClienteEsquema, tabla: string, columna: string): Promise<boolean> {
  const { error } = await db.from(tabla).select(columna).limit(1);
  return !error;
}

/** Una tabla existe si la consulta no falla. */
async function existeTabla(db: ClienteEsquema, tabla: string): Promise<boolean> {
  const { error } = await db.from(tabla).select("*").limit(1);
  return !error;
}

/** Comprueba las seis migraciones pendientes, una por una. */
export async function comprobarMigraciones(db: ClienteEsquema): Promise<Migracion[]> {
  const registro = await db.from("app_settings").select("value").eq("key", "public_signup_enabled");
  const filas = Array.isArray(registro.data) ? registro.data : [];
  const hayInterruptorRegistro = !registro.error && filas.length > 0;

  const senal = await existeColumna(db, "bot_executions", "signal_indicators");
  const estrategia = await existeColumna(db, "engine_strategies", "indicator_ids");
  const riesgo = await existeColumna(db, "automation_settings", "riesgo_por_operacion");
  const spread = await existeColumna(db, "engine_config", "auto_symbol_max_spread_pct");
  const diario = await existeTabla(db, "engine_cycles");

  return [
    {
      fichero: "20261020000000_app_settings_registro_publico.sql",
      titulo: "Interruptor de registro público",
      paraQueSirve:
        "Cierra (o abre) el alta de usuarios nuevos. Sin el, el registro se queda cerrado por defecto.",
      aplicada: hayInterruptorRegistro,
      comprobacion: "app_settings con la clave public_signup_enabled",
    },
    {
      fichero: "20261021000000_engine_strategies_por_bot.sql",
      titulo: "Indicadores y estrategia por bot",
      paraQueSirve:
        "Cada bot puede usar sus propios indicadores y su propia estrategia. Sin esto, todos los bots usan la configuración de la plataforma.",
      aplicada: estrategia,
      comprobacion: "columna indicator_ids en engine_strategies",
    },
    {
      fichero: "20261022000000_bot_executions_senal.sql",
      titulo: "Registro de la señal de cada operación",
      paraQueSirve:
        "Guarda qué indicadores dispararon cada operación. Sin esto, el panel de métricas no puede agrupar por indicador.",
      aplicada: senal,
      comprobacion: "columna signal_indicators en bot_executions",
    },
    {
      fichero: "20261023000000_realismo_ejecucion.sql",
      titulo: "Realismo en la ejecución (tamaño por riesgo, régimen, enfriamiento)",
      paraQueSirve:
        "El motor calcula el tamaño de cada operación según el riesgo y filtra regímenes malos. Sin esto, el motor opera con un tamaño fijo.",
      aplicada: riesgo,
      comprobacion: "columna riesgo_por_operacion en automation_settings",
    },
    {
      fichero: "20261024000000_auto_symbol_spread.sql",
      titulo: "Filtro de spread en el selector automático",
      paraQueSirve:
        "El selector automático de pares descarta los que se mueven mucho (spread alto).",
      aplicada: spread,
      comprobacion: "columna auto_symbol_max_spread_pct en engine_config",
    },
    {
      fichero: "20261025000000_engine_cycles.sql",
      titulo: "Diario del motor",
      paraQueSirve:
        "Guarda un registro de cada ciclo del motor para poder auditar qué decidió y por qué. Opcional: sin ella el motor sigue igual.",
      aplicada: diario,
      comprobacion: "tabla engine_cycles",
    },
  ];
}
