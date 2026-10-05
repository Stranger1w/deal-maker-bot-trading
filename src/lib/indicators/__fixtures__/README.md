# Fixtures de referencia numerica

Estos archivos son la **unica fuente de verdad externa** con la que se valida el
motor de indicadores. Se generan con Python, pero **los tests no necesitan
Python**: `bun test` solo lee los JSON ya generados.

## Que hay aqui

| Archivo           | Que es                                                         |
| ----------------- | -------------------------------------------------------------- |
| `dataset.json`    | 1000 velas OHLCV deterministas (LCG con semilla fija)          |
| `expected.json`   | Valores de referencia calculados con la libreria `ta` (Python) |
| `gen_dataset.py`  | Genera el dataset (solo hace falta si hay que regenerarlo)     |
| `gen_expected.py` | Calcula los valores de referencia con `ta`                     |

## Como se regenera (opcional, requiere Python)

```bash
pip install numpy pandas ta

# 1. Dataset determinista de 1000 velas -> escribe _fase1-verify/dataset.csv
python src/lib/indicators/__fixtures__/gen_dataset.py

# 2. Volcado a JSON que consumen los tests
python - <<'PY'
import csv, json
rows = list(csv.DictReader(open('_fase1-verify/dataset.csv')))
json.dump(
    {
        "closes": [float(r["close"]) for r in rows],
        "highs":  [float(r["high"]) for r in rows],
        "lows":   [float(r["low"]) for r in rows],
    },
    open("src/lib/indicators/__fixtures__/dataset.json", "w"),
)
PY

# 3. Valores de referencia con `ta` -> escribe __fixtures__/expected.json
python src/lib/indicators/__fixtures__/gen_expected.py
```

## Por que 1000 velas y corte en la 500

`ta` inicializa el RSI con `ewm(alpha=1/14, adjust=False)` y las EMA del MACD
con `ewm(span=26, adjust=False)`, **sin semilla SMA**. Nuestro codigo usa la
definicion clasica de Wilder, **con semilla SMA**. Esa es la unica diferencia.

El error resultante decae de forma geometrica:

| Indicador | Tasa teorica           | Medido                           |
| --------- | ---------------------- | -------------------------------- |
| RSI       | `(13/14)^n = 0.928571` | fluctua (transformada no lineal) |
| MACD      | `(25/27)^n = 0.925926` | `0.925918`                       |

Con corte en la vela 500 el residuo ya es **menor que 1e-6**, que es la
tolerancia que exigen los tests. `expected.json` guarda ademas un bloque
`_serie_para_decaimiento` con referencias desde la vela 100, porque en la vela
500 el residuo (~1e-14) ya no permite medir el decaimiento.

## Tramos del dataset

El dataset NO es ruido puro: incluye dos tramos monotonicos a proposito.

```
   0- 99  ruido      calentamiento
 100-599  CAIDA      aqui decae la diferencia de semilla
                     y genera RSI < 30 dentro de [500,600)
 600-899  SUBIDA     genera RSI > 70
 900-999  ruido      cola
```

Si estos tramos desaparecieran, el RSI nunca saldria de la zona neutra y los
tests de sobreventa/sobrecompra **pasarian sin comprobar nada**. Por eso hay un
test que afirma explicitamente que existen puntos por debajo de 30 y por encima
de 70.

## IMPORTANTE sobre `high` y `low`

Los generadores escriben `high = close * 1.004` y `low = close * 0.996`, de modo
que **siempre hay `high > low`**. El Estocastico y el CCI los necesitan: si
`high == low` el denominador es cero y ambos devuelven `null` (nunca `NaN`).

## Tolerancias

Ningun test usa igualdad exacta. Las tolerancias actuales:

| Indicador   | Tolerancia | Razon                                             |
| ----------- | ---------- | ------------------------------------------------- |
| Bollinger   | 1e-6       | 偏差 de redondeo del CSV a 8 decimales            |
| MACD        | 1e-6       | tras el decaimiento de la semilla                 |
| RSI         | 1e-6       | tras el decaimiento de la semilla                 |
| Estocastico | 1e-6       | sin suavizado recursivo: cuadra al primer decimal |
| CCI         | 1e-6       | sin suavizado recursivo                           |

## Lo que NO esta validado

El **AI Indicator** no se puede validar contra `ta` porque no es un indicador
tecnico: lee el historial de operaciones del propio bot y calcula estadisticas.
Sus tests son **estructurales** (que devuelva `null` con menos de 30 muestras,
que filtre pares con rendimiento negativo, etc.), no numericos.
