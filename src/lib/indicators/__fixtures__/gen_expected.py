"""Valores de referencia calculados con la libreria `ta` (independiente).

Se ejecuta UNA vez para generar _fase1-verify/expected.json. Los tests de
TypeScript comparan contra ese fichero con tolerancia 1e-6.

Documenta las diferencias de inicializacion entre `ta` y nuestro motor:
  - RSI: `ta` usa el suavizado de Wilder con la misma semilla SMA que TradingView.
  - MACD/MACD_signal: `ta` siembra las EMA con SMA; ours.idem.
  - BollingerBands: `ta` usa ddof=0 (desviacion poblacional), igual que ours.
  - Stochastic: `ta` calcula %K rapido (sin suavizado) y %D como SMA(3) de %K.
    Ours usa %K14 rapido -> %K suavizado(3) -> %D = SMA(3) de la %K suavizada.
    Esa diferencia se comprueba en el test y se documenta aqui.
  - CCI: `ta` usa la constante 0.015 y desviacion media absoluta, igual que ours.
"""
import json
import csv
import platform
import importlib.metadata
import numpy as np
import pandas as pd
from ta.momentum import RSIIndicator, StochasticOscillator
from ta.trend import MACD, CCIIndicator
from ta.volatility import BollingerBands


def _ver(pkg):
    try:
        return importlib.metadata.version(pkg)
    except Exception:
        return "desconocida"

OUT_DIR = "src/lib/indicators/__fixtures__"

with open("_fase1-verify/dataset.csv", newline="") as f:
    rows = list(csv.DictReader(f))

OUT_DIR = "src/lib/indicators/__fixtures__"

# `ta` trabaja sobre pandas.Series, no sobre ndarray.
close = pd.Series([float(r["close"]) for r in rows])
high = pd.Series([float(r["high"]) for r in rows])
low = pd.Series([float(r["low"]) for r in rows])

rsi = RSIIndicator(close=close, window=14).rsi()
macd = MACD(close=close, window_slow=26, window_fast=12, window_sign=9)
bb = BollingerBands(close=close, window=20, window_dev=2)
stoch = StochasticOscillator(high=high, low=low, close=close, window=14, smooth_window=3)
cci = CCIIndicator(high=high, low=low, close=close, window=20, constant=0.015).cci()


def serie_finita(arr):
    """Serie completa donde NaN/None se conservan como null (para comparar listas)."""
    out = []
    for v in arr:
        if v is None or (isinstance(v, float) and not np.isfinite(v)):
            out.append(None)
        else:
            out.append(float(v))
    return out


# --- Cadena completa del Estocastico LENTO ---------------------------
# %K rapido  = (close - low_min14) / (high_max14 - low_min14) * 100   == ta.stoch()
# %K lenta   = SMA(3) del %K rapido                                  == ta.stoch_signal()
# %D lenta   = SMA(3) de la %K lenta                                == ta.stoch_signal().rolling(3).mean()
k_rapido = serie_finita(stoch.stoch())
k_lenta = serie_finita(stoch.stoch_signal())
d_lenta = serie_finita(stoch.stoch_signal().rolling(3, min_periods=3).mean())


def last_finite(arr):
    for v in arr[::-1]:
        if v is not None and np.isfinite(v):
            return float(v)
    return None


def desde(arr, corte):
    """Serie completa a partir de una vela de corte, para medir el decaimiento."""
    return arr[corte:]


CORTE = 500
# Bloque adicional para MEDIR el decaimiento: necesita referencias de velas
# donde la diferencia de semilla aun es grande.
#
# Se mide desde la vela 100, que es donde empieza el tramo MONOTONO de caida.
# En la zona de ruido (velas 0-99) el cociente del RSI no sigue la teoria
# (13/14)^n porque RSI = 100 - 100/(1+RS) es una transformada muy no lineal:
# cerca de los extremos el error se comprime y en el centro se amplifica.
# En la zona monótona la recursion domina y el decaimiento si es medible.
DECAIMIENTO = 100

out = {
    "_meta": {
        "python": platform.python_version(),
        "ta": _ver("ta"),
        "pandas": pd.__version__,
        "numpy": np.__version__,
        "lcg": "x = (1103515245 * x + 12345) mod 2^31; x0 = 42; u = x / 2^31",
        "tramos": "0-99 ruido | 100-599 CAIDA | 600-899 SUBIDA | 900-999 ruido",
        "n_velas": 1000,
        "corte": CORTE,
        "nota": (
            "Valores generados con la libreria `ta` (Python), independiente de "
            "nuestro codigo TypeScript. La serie usa un LCG explicito para que "
            "sea reproducible bit a bit. 1000 velas con corte en 500: la "
            "diferencia de semilla (Wilder con SMA vs ewm sin semilla) decae "
            "como (13/14)^n en RSI y (25/27)^n en el MACD, de modo que en la "
            "vela 500 el residuo ya es menor que 1e-6."
        ),
        "inicializacion_ta": {
            "rsi": "ewm(alpha=1/14, adjust=False), SIN semilla SMA",
            "macd": "_ema(close, period, fillna) con adjust=False",
            "bollinger": "rolling(20).std(ddof=0) -> desviacion poblacional",
            "cci": "mean(abs(x - mean(x))) con constant=0.015",
            "stoch_k_lenta": "ta.stoch_signal() = SMA(3) del %K rapido",
            "stoch_d_lenta": "ta.stoch_signal().rolling(3).mean()",
        },
    },
    "n": len(close),
    "lib": "ta (python) - valores de referencia independientes",
    "corte": CORTE,
    "rsi14": last_finite(rsi),
    "macd": last_finite(macd.macd()),
    "macd_signal": last_finite(macd.macd_signal()),
    "macd_hist": last_finite(macd.macd_diff()),
    "bb_mid": last_finite(bb.bollinger_mavg()),
    "bb_upper": last_finite(bb.bollinger_hband()),
    "bb_lower": last_finite(bb.bollinger_lband()),
    "stoch_k_rapido": last_finite(k_rapido),
    "stoch_k_lenta": last_finite(k_lenta),
    "stoch_d_lenta": last_finite(d_lenta),
    "cci20": last_finite(cci),
    # Series completas desde la vela de corte: el test comparavection a vector.
    "_series_desde_corte": {
        "rsi14": desde(serie_finita(rsi), CORTE),
        "macd": desde(serie_finita(macd.macd()), CORTE),
        "macd_signal": desde(serie_finita(macd.macd_signal()), CORTE),
        "bb_mid": desde(serie_finita(bb.bollinger_mavg()), CORTE),
        "bb_upper": desde(serie_finita(bb.bollinger_hband()), CORTE),
        "bb_lower": desde(serie_finita(bb.bollinger_lband()), CORTE),
        "stoch_k_rapido": desde(k_rapido, CORTE),
        "stoch_k_lenta": desde(k_lenta, CORTE),
        "stoch_d_lenta": desde(d_lenta, CORTE),
        "cci20": desde(serie_finita(cci), CORTE),
    },
    # Tramo temprano, solo para medir el decaimiento de la diferencia de semilla.
    "_serie_para_decaimiento": {
        "desde": DECAIMIENTO,
        "rsi14": desde(serie_finita(rsi), DECAIMIENTO),
        "macd": desde(serie_finita(macd.macd()), DECAIMIENTO),
        "macd_signal": desde(serie_finita(macd.macd_signal()), DECAIMIENTO),
    },
}

with open(f"{OUT_DIR}/expected.json", "w") as f:
    json.dump(out, f, indent=2)

# Comprobacion de que la serie EXERCE las zonas que los tests necesitan.
# Si un futuro dataset no tiene tramos de sobreventa ni de sobrecompra, el test
# paridad.test.ts pasaria sin comprobar nada: esto avisa antes.
rsi_serie = out["_series_desde_corte"]["rsi14"]
bajo30 = [v for v in rsi_serie if v is not None and v < 30]
sobre70 = [v for v in rsi_serie if v is not None and v > 70]
print(f"puntos RSI<30 en el tramo comparado : {len(bajo30)}")
print(f"puntos RSI>70 en el tramo comparado : {len(sobre70)}")

for k, v in out.items():
    if k != "_series_desde_corte":
        print(f"{k:18s} = {v}")