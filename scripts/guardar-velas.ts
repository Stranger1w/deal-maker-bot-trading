/**
 * Guarda las velas de un par en un fichero JSON para poder backtestear SIN
 * internet (el CLI puede leerlo con --archivo).
 *
 * Uso:
 *   bun scripts/guardar-velas.ts --simbolo BTCUSDT --intervalo 1h --velas 3000
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { velasDeBinance } from "../src/lib/velas.server";

function arg(nombre: string, porDefecto?: string): string | undefined {
  const i = process.argv.indexOf(`--${nombre}`);
  if (i === -1) return porDefecto;
  const valor = process.argv[i + 1];
  return valor && !valor.startsWith("--") ? valor : porDefecto;
}

const simbolo = (arg("simbolo", "BTCUSDT") ?? "BTCUSDT").toUpperCase();
const intervalo = arg("intervalo", "1h") ?? "1h";
const limite = Number(arg("velas", "3000") ?? 3000);
const salida = arg("salida", `datos/${simbolo.toLowerCase()}-${intervalo}.json`) ?? "";

const velas = await velasDeBinance({ simbolo, intervalo, limite });
if (velas.length === 0) {
  console.error("No se han descargado velas.");
  process.exit(1);
}

mkdirSync(dirname(salida), { recursive: true });
writeFileSync(
  salida,
  JSON.stringify(
    {
      simbolo,
      intervalo,
      descargado: new Date().toISOString(),
      velas,
    },
    null,
    0,
  ),
  "utf8",
);
console.log(
  `${velas.length} velas de ${simbolo} (${intervalo}) guardadas en ${salida} (${new Date(velas[0]!.time).toISOString().slice(0, 10)} → ${new Date(velas[velas.length - 1]!.time).toISOString().slice(0, 10)})`,
);
