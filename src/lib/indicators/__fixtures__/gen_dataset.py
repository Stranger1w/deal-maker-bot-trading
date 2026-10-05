"""Genera el dataset determinista de 1000 velas OHLCV.

El LCG es explicito (no se usa random) para que Python y TypeScript produzcan
exactly la misma serie sin depender de ninguna implementacion de RNG.

Por que 1000 velas y corte en 500:
  `ta` inicializa el RSI con ewm(alpha=1/14) y la EMA del MACD con
  ewm(span=26) SIN semilla SMA. Nuestro codigo usa la definicion clasica de
  Wilder (semilla SMA). Esa diferencia de semilla decae de forma geometrica:
    RSI  ~ (13/14)^n      MACD ~ (25/27)^n
  Medido empiricamente el ratio de decaimiento es 0.925923 frente al teorico
  0.925926. A 500 velas el residuo cae por debajo de 1e-6, que es la tolerancia
  exigida en paridad.test.ts.

Tramos designed para que existan puntos de sobreventa (RSI<30) y de
sobrecompra (RSI>70) DENTRO del tramo comparado (desde la vela 500).
"""
import csv

N = 1000
CORTE = 500

#  0- 99  ruido    -> calentamiento
# 100-599  CAIDA    -> 500 velas: la diferencia de semilla decae aqui
#                    -> y dentro de [500,600) el RSI queda por debajo de 30
# 600-899  SUBIDA   -> el RSI sube por encima de 70
# 900- 99  ruido    -> cola
TRAMOS = [(0, 100, "ruido"), (100, 600, "caida"), (600, 900, "subida"), (900, N, "ruido")]

# Paso de tendencia 0.35 y ruido +-0.25: el trend domina, asi el RSI llega a
# saturar (0 y 100) en los tramos monotonos.
STEP = 0.35
RUIDO = 0.5

x = 42.0


def u():
    """Uniforme en [0,1) del LCG de Numerical Recipes."""
    global x
    x = (1103515245.0 * x + 12345.0) % 2147483648.0
    return x / 2147483648.0


closes = []
for ini, fin, modo in TRAMOS:
    for k in range(fin - ini):
        if modo == "ruido":
            closes.append(round(200.0 + 25.0 * u() - 12.5, 8))
        elif modo == "caida":
            closes.append(round(300.0 - STEP * k + RUIDO * (u() - 0.5), 8))
        else:
            closes.append(round(125.0 + STEP * k + RUIDO * (u() - 0.5), 8))

assert len(closes) == N, len(closes)
assert min(closes) > 1.0, min(closes)

with open("_fase1-verify/dataset.csv", "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["index", "open", "high", "low", "close", "volume"])
    for i, c in enumerate(closes):
        w.writerow([i, c, round(c * 1.004, 8), round(c * 0.996, 8), c, 1000.0 + (i % 37) * 7.0])

print(f"dataset: {N} velas  corte={CORTE}")
print(f"min={min(closes):.2f}  max={max(closes):.2f}")
print(f"close[499]={closes[499]}  close[500]={closes[500]}  close[-1]={closes[-1]}")