import { describe, expect, test } from "bun:test";

import { MOTIVOS, resumirCiclo, type DecisionMotor } from "./motor-decisiones";

function d(accion: DecisionMotor["accion"], motivo: string, bot = "b1"): DecisionMotor {
  return {
    bot_id: bot,
    bot,
    simbolo: "BTCUSDT",
    accion,
    motivo,
    detalle: null,
  };
}

describe("resumirCiclo", () => {
  test("cuenta bots revisados, operaron, omitieron y detenidos", () => {
    const r = resumirCiclo([
      d("entrada", "entrada"),
      d("salida", "salida"),
      d("omitido", "sin_senal"),
      d("omitido", "sin_senal"),
      d("detenido", "riesgo"),
      d("error", "error"),
    ]);
    expect(r.revisados).toBe(6);
    expect(r.operaron).toBe(2);
    expect(r.omitieron).toBe(2);
    expect(r.detenidos).toBe(1);
    expect(r.errores).toBe(1);
  });

  test("el motivo mas frecuente de los omitidos", () => {
    const r = resumirCiclo([
      d("omitido", "sin_senal"),
      d("omitido", "sin_senal"),
      d("omitido", "filtro_regimen"),
    ]);
    expect(r.motivoPrincipal).toEqual({ motivo: "sin_senal", veces: 2 });
  });

  test("sin omisiones no hay motivo principal", () => {
    const r = resumirCiclo([d("entrada", "entrada")]);
    expect(r.motivoPrincipal).toBeNull();
  });

  test("un ciclo vacio no rompe nada", () => {
    const r = resumirCiclo([]);
    expect(r.revisados).toBe(0);
    expect(r.motivoPrincipal).toBeNull();
  });
});

describe("MOTIVOS", () => {
  test("todos los motivos que usa el motor tienen etiqueta legible", () => {
    for (const motivo of [
      "sin_senal",
      "filtro_regimen",
      "enfriamiento",
      "limite_por_par",
      "sin_sesion",
      "dry_run",
      "real_bloqueado",
      "riesgo",
    ]) {
      expect(MOTIVOS[motivo]).toBeTruthy();
    }
  });
});
