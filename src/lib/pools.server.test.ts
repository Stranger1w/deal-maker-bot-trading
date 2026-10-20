import { describe, expect, test } from "bun:test";

import {
  monedasDesdeConfigNanopool,
  monedasDesdeSitemap2Miners,
  listarPoolsReales,
  POOLS,
} from "./pools.server";

describe("monedas de 2miners (sitemap real)", () => {
  test("quita los idiomas y deja los pools de moneda", () => {
    const xml = `<?xml version="1.0"?>
      <urlset>
        <url><loc>https://2miners.com/</loc></url>
        <url><loc>https://2miners.com/es/</loc></url>
        <url><loc>https://2miners.com/de/</loc></url>
        <url><loc>https://2miners.com/btc-mining-pool</loc></url>
        <url><loc>https://2miners.com/solo-btc-mining-pool</loc></url>
        <url><loc>https://2miners.com/zec-mining-pool</loc></url>
        <url><loc>https://2miners.com/solo-zec-mining-pool</loc></url>
        <url><loc>https://2miners.com/kawpow-mining-pool</loc></url>
      </urlset>`;
    const monedas = monedasDesdeSitemap2Miners(xml);
    expect(monedas).toContain("BTC");
    expect(monedas).toContain("ZEC");
    expect(monedas).toContain("KAWPOW");
    // Ni los idiomas ni el HTML.
    expect(monedas).not.toContain("ES");
    expect(monedas).not.toContain("DE");
  });
});

describe("monedas de nanopool (config embebida)", () => {
  test("lee el objeto var config", () => {
    const html = `<html><script>var config = { "xmr" : {"shortNameUpper":"XMR"}, "rvn" : {"shortNameUpper":"RVN"} };</script></html>`;
    const monedas = monedasDesdeConfigNanopool(html);
    expect(monedas).toEqual(["RVN", "XMR"]);
  });

  test("si no hay config, devuelve lista vacia (no inventa)", () => {
    expect(monedasDesdeConfigNanopool("<html>nada</html>")).toEqual([]);
  });
});

describe("lista de pools", () => {
  test("son pools que existen (con su web)", () => {
    expect(POOLS.length).toBeGreaterThanOrEqual(8);
    for (const p of POOLS) {
      expect(p.url.startsWith("https://")).toBe(true);
      expect(p.nombre.length).toBeGreaterThan(2);
    }
  });

  test("cada pool dice de donde sale su lista de monedas", async () => {
    const pools = await listarPoolsReales();
    expect(pools.length).toBe(POOLS.length);
    for (const p of pools) {
      expect(p.fuente.length).toBeGreaterThan(0);
      // Si no se ha podido leer en vivo, la lista de monedas va vacia: no se
      // inventa que monedas tiene ese pool.
      if (!p.enVivo) expect(p.monedas).toEqual([]);
    }
  });
});
