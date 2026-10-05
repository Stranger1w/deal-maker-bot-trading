"""Calculo INDEPENDIENTE de los valores esperados de los tests de estrategias.

No usa el codigo TypeScript: son las formulas escritas a mano desde la
especificacion, para que los tests comparen contra numeros calculados aparte.

Ejecutar: python src/lib/strategies/gen_expected_strategies.py
"""


def conservadora(perdidas: int) -> float:
    return max(0.25, 0.75 ** (perdidas // 2))


def optima(ganadas: int, perdidas: int) -> float:
    return min(1.5, max(0.5, 1 + 0.10 * ganadas - 0.15 * perdidas))


def agresiva(nivel: int) -> float:
    return 2 ** nivel


print("=== CONSERVADORA: factor por perdidas consecutivas ===")
for p in [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 20]:
    print(f"  perdidas={p:3d}  factor={conservadora(p)}")

print("\n=== OPTIMA: factor (racha actual) ===")
for g, pe in [(0, 0), (1, 0), (3, 0), (5, 0), (0, 1), (0, 2), (0, 3), (2, 2), (10, 0), (0, 10)]:
    print(f"  ganadas={g:2d} perdidas={pe:2d}  factor={optima(g, pe)}")

print("\n=== AGRESIVA: secuencia de montos (base=20, saldo=1000, tope 10%) ===")
BASE, SALDO = 20.0, 1000.0
TOPE = round(SALDO * 0.10, 2)
print(f"  tope de capital = {TOPE}")
nivel = 0
for perdida in range(1, 6):
    bruto = round(BASE * agresiva(nivel), 2)
    monto = min(bruto, TOPE)
    recortado = monto < bruto
    print(
        f"  perdida {perdida}: nivel={nivel} factor={agresiva(nivel)} "
        f"bruto={bruto} monto={monto} recortado={recortado} -> nivel pasa a {nivel + 1}"
    )
    if perdida == 4:
        print("      -> MAXIMO DE PERDIDAS (4): el motor se pausa")
        break
    nivel = min(nivel + 1, 3)

print("\n=== CONSERVADORA: montos con base=20, saldo=1000 ===")
nivel = 0
for perdida in range(1, 6):
    f = conservadora(perdida - 1)
    bruto = round(BASE * f, 2)
    monto = min(bruto, round(SALDO * 0.10, 2))
    print(f"  antes de la perdida {perdida}: factor={f} monto={monto}")

print("\n=== TOPES: 1000 perdidas seguidas en la agresiva ===")
nivel = 0
max_factor = 0.0
max_monto = 0.0
for _ in range(1000):
    f = agresiva(nivel)
    monto = min(round(BASE * f, 2), round(SALDO * 0.10, 2))
    max_factor = max(max_factor, f)
    max_monto = max(max_monto, monto)
    nivel = min(nivel + 1, 3)
print(f"  factor maximo alcanzado = {max_factor}  (tope duro del nivel 3)")
print(f"  monto maximo alcanzado  = {max_monto}  (tope de capital)")

print("\n=== REDONDEO A 2 DECIMALES ===")
print(f"  round(20 * 0.5625, 2) = {round(20 * 0.5625, 2)}")
print(f"  round(20 * 0.421875, 2) = {round(20 * 0.421875, 2)}")