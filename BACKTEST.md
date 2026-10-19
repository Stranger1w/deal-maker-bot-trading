# Backtest: cómo probarlo (y qué significa)

El backtest usa **las mismas funciones que el motor en vivo**: los mismos
indicadores (`senalDe`) y las mismas estrategias (`decidir`). Por eso lo que
mides aquí es lo que hará el motor.

## Ejecutar (PowerShell, un solo bloque)

```powershell
cd C:\Users\Usuario\.copilot\repos\deal-maker-bot-trading
$env:PATH = "C:\Users\Usuario\.bun\bin;" + $env:PATH

# BTCUSDT, velas de 1 hora, 3000 velas (unas 4 meses), estrategia por defecto
bun run backtest -- --simbolo BTCUSDT --intervalo 1h --velas 3000 --indicadores close_price --capital 1000 --stop 2 --take 4

# Con validación fuera de muestra (walk-forward) en 4 bloques
bun run backtest -- --simbolo BTCUSDT --intervalo 1h --velas 3000 --indicadores close_price --capital 1000 --stop 2 --take 4 --walk-forward 4

# Varios indicadores (solo se opera si TODOS coinciden)
bun run backtest -- --simbolo ETHUSDT --intervalo 4h --velas 3000 --indicadores rsi,macd --capital 1000 --stop 3 --take 6 --comision 0.001 --slippage 0.0005

# Parámetros de un indicador en concreto
bun run backtest -- --simbolo BTCUSDT --intervalo 1h --velas 3000 --indicadores rsi --parametros '{\"rsi\":{\"periodo\":21,\"sobreventa\":25,\"sobrecompra\":75}}'
```

Opciones: `--simbolo --intervalo --velas --indicadores --parametros --capital
--fraccion --stop --take --comision --slippage --descuento-bnb --estrategia
--walk-forward --archivo`.

### Sin internet (en tu PC o en el servidor)

Si no hay conexión, el backtest sigue funcionando con las velas ya
descargadas. En `datos/` hay un dataset de ejemplo (BTCUSDT 1h, 3000 velas,
junio–octubre de 2026):

```powershell
bun run backtest -- --archivo datos/btcusdt-1h.json --indicadores close_price --capital 1000 --stop 2 --take 4 --walk-forward 4
```

Para otros pares o intervalos, descarga las velas **cuando tengas internet**
y guárdalas para después:

```powershell
bun scripts/guardar-velas.ts --simbolo ETHUSDT --intervalo 1h --velas 3000
bun run backtest -- --archivo datos/ethusdt-1h.json --indicadores rsi
```

Sin internet se usan las reglas por defecto del símbolo (stepSize 0.00001,
minNotional 5 USDT) y el aviso lo dice.

## Qué mirar (y qué NO mirar)

| Métrica | Qué significa |
|---|---|
| Retorno neto | Después de comisiones y slippage. Esta es la cifra que cuenta. |
| Operaciones | Con menos de 100 operaciones el azar manda: el resultado no vale. |
| Win rate | Menos del 50 % es normal si el profit factor es > 1. |
| Profit factor | Ganancia total ÷ pérdida total. Por debajo de 1 se pierde dinero de media. |
| Max drawdown | Lo peor que se habría livingido el capital. |
| Coste total | Lo que se comen comisiones y slippage. Si es grande, la estrategia no tiene espacio. |
| Sharpe / Sortino | Solo para comparar estrategias entre sí, no son retornos annualizados. |
| Comprar y mantener | El rival mínimo. Si no lo superas, no hay ventaja. |

El informe incluye además los **avisos**: lo que el resultado NO demuestra.

## Reglas del modelo (conservadoras a propósito)

- La señal se calcula con las velas **cerradas anteriores** y se ejecuta a la
  apertura de la vela siguiente: nunca se mira el futuro.
- Si una vela toca stop-loss y take-profit a la vez, se asume el **stop loss**.
- Una señal de venta sin posición abierta se ignora (en spot no se vende lo
  que no se tiene).
- Se respetan `stepSize`, `minQty` y `minNotional` reales del símbolo.
- Se modelan comisiones y slippage por lado (0,1 % y 0,05 % por defecto).

## Resultado honesto de la estrategia por defecto (19-oct-2026)

BTCUSDT, velas de 1 hora, 3000 velas, `close_price`, 0,1 % de comisión y
0,05 % de slippage por lado:

- **−1,42 %** de retorno neto · 272 operaciones · win rate 18,75 % ·
  profit factor 0,45 · drawdown máximo 1,47 %
- Comprar y mantener en el mismo periodo: **+24,07 %**
- Walk-forward de 4 bloques: **0 de 4 bloques positivos**

Es decir: **la estrategia por defecto no tiene ventaja demostrada**. No la
subas a Real hasta que alguna configuración supere al benchmark en varios
bloques fuera de muestra.
