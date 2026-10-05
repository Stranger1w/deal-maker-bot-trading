import { describe, expect, test } from "bun:test";
import {
  aperturasPermitidas,
  botTienePosicionAbierta,
  cerrarSesion,
  calcularPnlPorRango,
  contarPosicionesAbiertas,
  expiraPorTimer,
  iniciarSesion,
  listarSesiones,
  marcarSesionParaCierre,
  obtenerSesionActiva,
  registrarTickSesion,
  resumenPnl,
  type EngineSession,
} from "./engine-sessions.server";

/**
 * Fake en memoria de la capa PostgREST: aplica de verdad los filtros .eq() de
 * cada UPDATE, de modo que WHERE status='closing' se comporta como en la nube
 * (una sesion ya cerrada no vuelve a casar y el cierre queda idempotente).
 */

type Fila = Record<string, unknown>;

type Ops = { tabla: string; op: string; payload?: Fila | undefined; filtros: [string, unknown][] };

function crearFakeDb(opts: {
  sesiones?: Fila[];
  bots?: Fila[];
  pnlEjecuciones?: Fila[];
  insertaConFLICTO?: boolean;
}) {
  const sesiones: Fila[] = (opts.sesiones ?? []).map((f) => ({ ...f }));
  const bots: Fila[] = (opts.bots ?? []).map((f) => ({ ...f }));
  const pnlEjecuciones = opts.pnlEjecuciones ?? [];
  const ops: Ops[] = [];

  const resultado = (data: unknown) => ({ data, error: null });

  function builder(tabla: string) {
    let op = "select";
    let payload: Fila | undefined;
    const filtros: [string, unknown][] = [];
    const rango: { gte?: unknown; lte?: unknown } = {};
    let orden: { col: string; asc: boolean } | null = null;
    let limite: number | null = null;

    const registrar = () => ops.push({ tabla, op, payload, filtros: [...filtros] });

    const aplicarFiltros = (filas: Fila[]) =>
      filas.filter((f) => filtros.every(([col, v]) => f[col] === v));

    const encadenable: Record<string, unknown> = {};
    const cadena = (metodos: string[]) => {
      for (const m of metodos)
        encadenable[m] = (...args: unknown[]) => {
          if (m === "insert") {
            op = "insert";
            payload = args[0] as Fila;
          } else if (m === "update") {
            op = "update";
            payload = args[0] as Fila;
          } else if (m === "eq") {
            filtros.push(args as [string, unknown]);
          } else if (m === "in") {
            const [col, vals] = args as [string, unknown[]];
            filtros.push([col, vals]);
          } else if (m === "gte") {
            rango.gte = args[1];
          } else if (m === "lte") {
            rango.lte = args[1];
          } else if (m === "order") {
            const [col, opciones] = args as [string, { ascending?: boolean } | undefined];
            orden = { col, asc: opciones?.ascending !== false };
          } else if (m === "limit") {
            limite = args[0] as number;
          } else if (m === "single" || m === "maybeSingle" || m === "then") {
            // resueltos abajo
          }
          return encadenable;
        };
      return encadenable;
    };
    cadena(["insert", "update", "select", "eq", "in", "gte", "lte", "order", "limit"]);

    const resolver = () => {
      registrar();
      if (op === "insert") {
        if (opts.insertaConFLICTO) {
          return { data: null, error: { code: "23505", message: "duplicate key" } };
        }
        const fila = {
          id: `s${sesiones.length + 1}`,
          created_at: new Date().toISOString(),
          ...payload,
        };
        sesiones.push(fila);
        return resultado(fila);
      }
      if (op === "update") {
        const [primera] = aplicarFiltros(sesiones);
        if (!primera) return { data: null, error: null };
        Object.assign(primera, payload);
        return resultado(primera);
      }
      // select
      const coincide = (f: Fila) =>
        filtros.every(([col, v]) => {
          if (Array.isArray(v)) return v.includes(f[col]);
          return f[col] === v;
        });
      let filas: Fila[];
      if (tabla === "engine_sessions") filas = sesiones.filter(coincide);
      else if (tabla === "bots") filas = bots.filter(coincide);
      else {
        filas = pnlEjecuciones.filter(coincide);
        if (rango.gte !== undefined)
          filas = filas.filter(
            (f) => Date.parse(String(f["created_at"])) >= Date.parse(String(rango.gte)),
          );
        if (rango.lte !== undefined)
          filas = filas.filter(
            (f) => Date.parse(String(f["created_at"])) <= Date.parse(String(rango.lte)),
          );
      }
      if (orden) {
        const { col, asc } = orden;
        filas = [...filas].sort((a, b) => {
          const av = a[col];
          const bv = b[col];
          const cmp =
            typeof av === "number" && typeof bv === "number"
              ? av - bv
              : String(av ?? "").localeCompare(String(bv ?? ""));
          return asc ? cmp : -cmp;
        });
      }
      if (limite !== null) filas = filas.slice(0, limite);
      return resultado(filas);
    };

    encadenable["single"] = async () => devolver();
    encadenable["maybeSingle"] = async () => devolver();
    encadenable["then"] = (ok: (v: unknown) => unknown) => Promise.resolve(resolver()).then(ok);
    return encadenable;

    // single/maybeSingle sobre select devuelven la primera fila (o null), como PostgREST.
    function devolver() {
      const r = resolver() as { data: unknown; error: unknown };
      if (op === "insert" || op === "update" || !Array.isArray(r.data)) return r;
      return { data: (r.data as Fila[])[0] ?? null, error: null };
    }
  }

  const db = { from: (tabla: string) => builder(tabla) };
  return { db: db as unknown as Parameters<typeof cerrarSesion>[0], ops, sesiones };
}

const AHORA = new Date("2026-10-05T12:00:00.000Z");
const SESION_BASE: EngineSession = {
  id: "s1",
  mode: "timer",
  status: "active",
  session_started_at: "2026-10-05T10:00:00.000Z",
  session_ends_at: "2026-10-05T14:00:00.000Z",
  session_stopped_at: null,
  close_reason: null,
  runs_count: 0,
  orders_count: 0,
  errors_count: 0,
  pnl_total: 0,
  last_tick_at: null,
};

describe("resumenPnl", () => {
  test("suma los pnl del rango", () => {
    expect(resumenPnl([1.5, -2, 0.25])).toBe(-0.25);
  });

  test("redondea a 2 decimales (evita error binario)", () => {
    expect(resumenPnl([0.1, 0.2])).toBe(0.3);
    expect(resumenPnl([1.005, 1.005])).toBe(2.01);
  });

  test("rango vacio es 0", () => {
    expect(resumenPnl([])).toBe(0);
  });
});

describe("expiraPorTimer", () => {
  test("timer vencido y activo expira", () => {
    expect(
      expiraPorTimer({ ...SESION_BASE, session_ends_at: "2026-10-05T11:00:00.000Z" }, AHORA),
    ).toBe(true);
  });

  test("timer aun en curso no expira", () => {
    expect(expiraPorTimer(SESION_BASE, AHORA)).toBe(false);
  });

  test("modo 24x7 nunca expira por timer", () => {
    expect(
      expiraPorTimer(
        { ...SESION_BASE, mode: "24x7", session_ends_at: "2026-10-05T11:00:00.000Z" },
        AHORA,
      ),
    ).toBe(false);
  });

  test("sesion closing o closed no expira", () => {
    expect(expiraPorTimer({ ...SESION_BASE, status: "closing" }, AHORA)).toBe(false);
    expect(expiraPorTimer({ ...SESION_BASE, status: "closed" }, AHORA)).toBe(false);
  });

  test("timer sin session_ends_at no expira (lo prohibio la constraint)", () => {
    expect(expiraPorTimer({ ...SESION_BASE, session_ends_at: null }, AHORA)).toBe(false);
  });
});

describe("iniciarSesion", () => {
  test("abre una sesion active con los defaults de la tabla", async () => {
    const { db, sesiones } = crearFakeDb({});
    const s = await iniciarSesion(db, { mode: "24x7" });
    expect(s.status).toBe("active");
    expect(sesiones).toHaveLength(1);
    expect(sesiones[0]!["session_ends_at"]).toBeNull();
  });

  test("timer guarda session_ends_at; 24x7 lo ignora", async () => {
    const { db, sesiones } = crearFakeDb({});
    await iniciarSesion(db, { mode: "timer", session_ends_at: "2026-10-05T14:00:00.000Z" });
    expect(sesiones[0]!["session_ends_at"]).toBe("2026-10-05T14:00:00.000Z");

    const { db: db2, sesiones: sesiones2 } = crearFakeDb({});
    await iniciarSesion(db2, { mode: "24x7", session_ends_at: "2026-10-05T14:00:00.000Z" });
    expect(sesiones2[0]!["session_ends_at"]).toBeNull();
  });

  test("conflicto 23505 (indice unico de una sola sesion) devuelve la existente", async () => {
    const existente = { ...SESION_BASE, id: "s-ya" };
    const { db } = crearFakeDb({
      sesiones: [existente as unknown as Fila],
      insertaConFLICTO: true,
    });
    const s = await iniciarSesion(db, { mode: "24x7" });
    expect(s.id).toBe("s-ya");
    expect(s.status).toBe("active");
  });
});

describe("obtenerSesionActiva", () => {
  test("devuelve la sesion active o closing", async () => {
    const { db } = crearFakeDb({
      sesiones: [{ ...SESION_BASE, status: "closing" } as unknown as Fila],
    });
    const s = await obtenerSesionActiva(db);
    expect(s?.status).toBe("closing");
  });

  test("devuelve null sin sesion vigente", async () => {
    const { db } = crearFakeDb({
      sesiones: [{ ...SESION_BASE, status: "closed" } as unknown as Fila],
    });
    expect(await obtenerSesionActiva(db)).toBeNull();
  });
});

describe("marcarSesionParaCierre", () => {
  test("active -> closing", async () => {
    const { db, sesiones } = crearFakeDb({ sesiones: [{ ...SESION_BASE } as unknown as Fila] });
    await marcarSesionParaCierre(db, "s1", "manual");
    expect(sesiones[0]!["status"]).toBe("closing");
    expect(sesiones[0]!["close_reason"]).toBe("manual");
  });

  test("persiste el motivo del cierre (timer/kill_switch) en la transicion", async () => {
    for (const motivo of ["timer", "kill_switch"] as const) {
      const { db, sesiones } = crearFakeDb({ sesiones: [{ ...SESION_BASE } as unknown as Fila] });
      await marcarSesionParaCierre(db, "s1", motivo);
      expect(sesiones[0]!["status"]).toBe("closing");
      expect(sesiones[0]!["close_reason"]).toBe(motivo);
    }
  });

  test("no reabre ni toca una sesion closed (UPDATE exige status='active')", async () => {
    const { db, sesiones } = crearFakeDb({
      sesiones: [
        {
          ...SESION_BASE,
          status: "closed",
          close_reason: "manual",
          session_stopped_at: AHORA.toISOString(),
        } as unknown as Fila,
      ],
    });
    await marcarSesionParaCierre(db, "s1", "manual");
    expect(sesiones[0]!["status"]).toBe("closed");
    expect(sesiones[0]!["close_reason"]).toBe("manual");
  });
});

describe("cerrarSesion", () => {
  const cerrada = () => ({
    ...SESION_BASE,
    status: "closing",
    session_stopped_at: null,
  });

  test("closing -> closed guarda close_reason y session_stopped_at (closed_has_reason)", async () => {
    const { db, sesiones } = crearFakeDb({ sesiones: [cerrada() as unknown as Fila] });
    const s = await cerrarSesion(db, "s1", "timer");
    expect(s?.status).toBe("closed");
    expect(s?.close_reason).toBe("timer");
    expect(s?.session_stopped_at).not.toBeNull();
    expect(sesiones[0]!["status"]).toBe("closed");
  });

  test("el cierre es idempotente: la segunda llamada no altera nada", async () => {
    const { db, sesiones } = crearFakeDb({ sesiones: [cerrada() as unknown as Fila] });
    const primera = await cerrarSesion(db, "s1", "kill_switch");
    expect(primera).not.toBeNull();
    const snapshot = JSON.stringify(sesiones[0]);

    const segunda = await cerrarSesion(db, "s1", "manual");
    expect(segunda).toBeNull();
    expect(JSON.stringify(sesiones[0])).toBe(snapshot);
  });

  test("una sesion active no se cierra directamente (debe pasar por closing)", async () => {
    const { db } = crearFakeDb({ sesiones: [{ ...SESION_BASE } as unknown as Fila] });
    expect(await cerrarSesion(db, "s1", "error")).toBeNull();
  });
});

describe("calcularPnlPorRango", () => {
  const sesionRango = {
    id: "s1",
    session_started_at: "2026-10-05T10:00:00.000Z",
    session_stopped_at: "2026-10-05T12:00:00.000Z",
  };

  test("suma solo los bot_executions dentro de [session_started_at, session_stopped_at]", async () => {
    const { db } = crearFakeDb({
      pnlEjecuciones: [
        { pnl: 1, created_at: "2026-10-05T09:59:59.000Z" }, // antes del rango
        { pnl: 2, created_at: "2026-10-05T10:00:00.000Z" }, // limite inferior incluido
        { pnl: -0.5, created_at: "2026-10-05T11:00:00.000Z" },
        { pnl: 4, created_at: "2026-10-05T12:00:00.000Z" }, // limite superior incluido
        { pnl: 8, created_at: "2026-10-05T12:00:01.000Z" }, // despues del rango
      ],
    });
    expect(await calcularPnlPorRango(db, sesionRango)).toBe(5.5);
  });

  test("sesion sin session_stopped_at devuelve 0 y ni siquiera consulta", async () => {
    const { db, ops } = crearFakeDb({
      pnlEjecuciones: [{ pnl: 9, created_at: "2026-10-05T11:00:00.000Z" }],
    });
    const v = await calcularPnlPorRango(db, { ...sesionRango, session_stopped_at: null });
    expect(v).toBe(0);
    expect(ops).toHaveLength(0);
  });

  test("rango sin ejecuciones es 0", async () => {
    const { db } = crearFakeDb({ pnlEjecuciones: [] });
    expect(await calcularPnlPorRango(db, sesionRango)).toBe(0);
  });
});

describe("listarSesiones", () => {
  test("ordena de mas reciente a mas antigua y respeta el limite", async () => {
    const { db } = crearFakeDb({
      sesiones: [
        { ...SESION_BASE, id: "s-antigua", session_started_at: "2026-10-05T08:00:00.000Z" },
        { ...SESION_BASE, id: "s-reciente", session_started_at: "2026-10-05T10:00:00.000Z" },
        { ...SESION_BASE, id: "s-media", session_started_at: "2026-10-05T09:00:00.000Z" },
      ] as unknown as Fila[],
    });
    const todas = await listarSesiones(db);
    expect(todas.map((s) => s.id)).toEqual(["s-reciente", "s-media", "s-antigua"]);

    const una = await listarSesiones(db, 1);
    expect(una.map((s) => s.id)).toEqual(["s-reciente"]);
  });

  test("devuelve las sesiones cerradas tambien (historial completo)", async () => {
    const { db } = crearFakeDb({
      sesiones: [
        {
          ...SESION_BASE,
          id: "s-cerrada",
          status: "closed",
          close_reason: "timer",
          session_stopped_at: AHORA.toISOString(),
        },
      ] as unknown as Fila[],
    });
    const todas = await listarSesiones(db);
    expect(todas).toHaveLength(1);
    expect(todas[0]!.close_reason).toBe("timer");
  });
});

describe("botTienePosicionAbierta", () => {
  test("true si la ultima ejecucion por fecha es una entrada buy", async () => {
    // Insertada deliberadamente fuera de orden: sin .order(created_at desc)
    // la primera fila seria la venta y devolveria false.
    const { db } = crearFakeDb({
      pnlEjecuciones: [
        {
          bot_id: "b1",
          symbol: "BTCUSDT",
          side: "sell",
          status: "filled",
          created_at: "2026-10-05T10:00:00.000Z",
        },
        {
          bot_id: "b1",
          symbol: "BTCUSDT",
          side: "buy",
          status: "filled",
          created_at: "2026-10-05T11:00:00.000Z",
        },
      ],
    });
    expect(await botTienePosicionAbierta(db, { id: "b1", pair: "BTCUSDT" })).toBe(true);
  });

  test("false tras la venta de salida y tambien en simulated (demo)", async () => {
    const { db } = crearFakeDb({
      pnlEjecuciones: [
        {
          bot_id: "b1",
          symbol: "BTCUSDT",
          side: "buy",
          status: "filled",
          created_at: "2026-10-05T10:00:00.000Z",
        },
        {
          bot_id: "b1",
          symbol: "BTCUSDT",
          side: "sell",
          status: "filled",
          created_at: "2026-10-05T11:00:00.000Z",
        },
        {
          bot_id: "b2",
          symbol: "ETHUSDT",
          side: "buy",
          status: "simulated",
          created_at: "2026-10-05T11:00:00.000Z",
        },
      ],
    });
    expect(await botTienePosicionAbierta(db, { id: "b1", pair: "BTCUSDT" })).toBe(false);
    expect(await botTienePosicionAbierta(db, { id: "b2", pair: "ETHUSDT" })).toBe(false);
  });
});

describe("contarPosicionesAbiertas", () => {
  const bots = [
    { id: "b1", pair: "BTCUSDT", status: "running", automation_enabled: true },
    { id: "b2", pair: "ETHUSDT", status: "running", automation_enabled: true },
    { id: "b3", pair: "SOLUSDT", status: "running", automation_enabled: false },
    { id: "b4", pair: "XRPUSDT", status: "stopped", automation_enabled: true },
  ];
  const ejecuciones = [
    // b1: entro y salio -> plana.
    {
      bot_id: "b1",
      symbol: "BTCUSDT",
      side: "buy",
      status: "filled",
      created_at: "2026-10-05T10:00:00.000Z",
    },
    {
      bot_id: "b1",
      symbol: "BTCUSDT",
      side: "sell",
      status: "filled",
      created_at: "2026-10-05T11:00:00.000Z",
    },
    // b2: entrada abierta (parcial).
    {
      bot_id: "b2",
      symbol: "ETHUSDT",
      side: "buy",
      status: "partially_filled",
      created_at: "2026-10-05T10:30:00.000Z",
    },
    // b3 sin automation y b4 detenido: el motor ya no los gestiona.
    {
      bot_id: "b3",
      symbol: "SOLUSDT",
      side: "buy",
      status: "filled",
      created_at: "2026-10-05T10:30:00.000Z",
    },
    {
      bot_id: "b4",
      symbol: "XRPUSDT",
      side: "buy",
      status: "filled",
      created_at: "2026-10-05T10:30:00.000Z",
    },
  ];

  test("cuenta solo bots running+automation con entrada abierta", async () => {
    const { db } = crearFakeDb({ bots, pnlEjecuciones: ejecuciones });
    expect(await contarPosicionesAbiertas(db)).toBe(1);
  });

  test("compras simuladas (demo) no cuentan: no bloquean el cierre", async () => {
    const { db } = crearFakeDb({
      bots: [{ id: "b5", pair: "ADAUSDT", status: "running", automation_enabled: true }],
      pnlEjecuciones: [
        {
          bot_id: "b5",
          symbol: "ADAUSDT",
          side: "buy",
          status: "simulated",
          created_at: "2026-10-05T10:00:00.000Z",
        },
      ],
    });
    expect(await contarPosicionesAbiertas(db)).toBe(0);
  });

  test("sin bots en ejecucion no hay nada abierto", async () => {
    const { db } = crearFakeDb({ bots: [], pnlEjecuciones: [] });
    expect(await contarPosicionesAbiertas(db)).toBe(0);
  });
});

describe("registrarTickSesion", () => {
  test("suma contadores y marca last_tick_at", async () => {
    const { db, sesiones } = crearFakeDb({
      sesiones: [
        { ...SESION_BASE, runs_count: 2, orders_count: 3, errors_count: 1 } as unknown as Fila,
      ],
    });
    await registrarTickSesion(db, sesiones[0] as unknown as EngineSession, {
      runsDelta: 1,
      ordersDelta: 4,
      errorsDelta: 2,
    });
    expect(sesiones[0]!["runs_count"]).toBe(3);
    expect(sesiones[0]!["orders_count"]).toBe(7);
    expect(sesiones[0]!["errors_count"]).toBe(3);
    expect(sesiones[0]!["last_tick_at"]).not.toBeNull();
  });

  test("el registro del tick es un UPDATE por id sobre engine_sessions", async () => {
    const { db, ops } = crearFakeDb({});
    await registrarTickSesion(
      db,
      { ...SESION_BASE },
      {
        runsDelta: 1,
        ordersDelta: 0,
        errorsDelta: 0,
      },
    );
    expect(ops).toHaveLength(1);
    expect(ops[0]!["tabla"]).toBe("engine_sessions");
    expect(ops[0]!["op"]).toBe("update");
  });
});

describe("aperturasPermitidas", () => {
  test("engine_enabled apagado nunca abre", () => {
    expect(
      aperturasPermitidas({ engineEnabled: false, sesion: { status: "active" }, sesionesOk: true }),
    ).toBe(false);
    expect(aperturasPermitidas({ engineEnabled: false, sesion: null, sesionesOk: true })).toBe(
      false,
    );
  });

  test("con sesiones solo abre la sesion active (closing/closed/null no)", () => {
    expect(
      aperturasPermitidas({ engineEnabled: true, sesion: { status: "active" }, sesionesOk: true }),
    ).toBe(true);
    expect(
      aperturasPermitidas({ engineEnabled: true, sesion: { status: "closing" }, sesionesOk: true }),
    ).toBe(false);
    expect(
      aperturasPermitidas({ engineEnabled: true, sesion: { status: "closed" }, sesionesOk: true }),
    ).toBe(false);
    expect(aperturasPermitidas({ engineEnabled: true, sesion: null, sesionesOk: true })).toBe(
      false,
    );
  });

  test("sin tabla de sesiones (migracion pendiente) decide solo engine_enabled", () => {
    expect(aperturasPermitidas({ engineEnabled: true, sesion: null, sesionesOk: false })).toBe(
      true,
    );
    expect(aperturasPermitidas({ engineEnabled: false, sesion: null, sesionesOk: false })).toBe(
      false,
    );
  });
});
