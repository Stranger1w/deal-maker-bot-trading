import { describe, expect, test } from "bun:test";
import {
  cerrarSesion,
  calcularPnlPorRango,
  expiraPorTimer,
  iniciarSesion,
  marcarSesionParaCierre,
  obtenerSesionActiva,
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
  pnlEjecuciones?: Fila[];
  insertaConFLICTO?: boolean;
}) {
  const sesiones: Fila[] = (opts.sesiones ?? []).map((f) => ({ ...f }));
  const pnlEjecuciones = opts.pnlEjecuciones ?? [];
  const ops: Ops[] = [];

  const resultado = (data: unknown) => ({ data, error: null });

  function builder(tabla: string) {
    let op = "select";
    let payload: Fila | undefined;
    const filtros: [string, unknown][] = [];
    const rango: { gte?: unknown; lte?: unknown } = {};

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
          } else if (m === "single" || m === "maybeSingle" || m === "then") {
            // resueltos abajo
          }
          return encadenable;
        };
      return encadenable;
    };
    cadena(["insert", "update", "select", "eq", "in", "gte", "lte", "limit"]);

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
      if (tabla === "engine_sessions") {
        const filas = sesiones.filter((f) =>
          filtros.every(([col, v]) => {
            if (Array.isArray(v)) return v.includes(f[col]);
            return f[col] === v;
          }),
        );
        return resultado(filas);
      }
      let filas = pnlEjecuciones;
      if (rango.gte !== undefined)
        filas = filas.filter(
          (f) => Date.parse(String(f["created_at"])) >= Date.parse(String(rango.gte)),
        );
      if (rango.lte !== undefined)
        filas = filas.filter(
          (f) => Date.parse(String(f["created_at"])) <= Date.parse(String(rango.lte)),
        );
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
    await marcarSesionParaCierre(db, "s1");
    expect(sesiones[0]!["status"]).toBe("closing");
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
    await marcarSesionParaCierre(db, "s1");
    expect(sesiones[0]!["status"]).toBe("closed");
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
