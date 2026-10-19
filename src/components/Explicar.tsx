import { CircleHelp } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

/**
 * Explicacion de un termino tecnico, en una frase.
 *
 * La app usa jerga de trading (drawdown, profit factor, slippage...). Quien
 * no es trader no puede saber si una cifra es buena o mala. Con un "?" al
 * lado, el termino se explica donde aparece, sin obligar a buscar en otro
 * sitio.
 */

export const GLOSARIO: Record<string, string> = {
  drawdown:
    "Caida desde el maximo de capital. Es la peor racha que habrias vivido: un 20 % de drawdown significa que 100 se.Convertian en 80.",
  "profit factor":
    "Cuanto ganas por cada euro que pierdes. Por encima de 1 ganas; por debajo de 1 pierdes. Menos de 1,2 con pocas operaciones suele ser ruido.",
  win_rate:
    "Porcentaje de operaciones que cerraron en ganancia. No dice lo importante: un 30 % puede ser rentable si las ganancias son grandes.",
  expectancy:
    "Ganancia media por operacion. Es la cifra que resume si una estrategia tiene o no ventaja.",
  take_profit:
    "El precio al que se cierra la posicion en ganancia. Si es muy pequeno, los costes se lo comen antes de empezar.",
  stop_loss:
    "El precio al que se cierra la posicion en perdida. Es tu limite de riesgo por operacion.",
  slippage:
    "La diferencia entre el precio que querias y el precio que te dieron. En pares volatiles puede ser de varias décimas.",
  spread:
    "La diferencia entre el precio de compra y el de venta. Es un coste que pagas al entrar y al salir.",
  testnet:
    "La cuenta de pruebas de Binance: los precios son reales pero el dinero no existe. Ideal para probar sin riesgo.",
  "dry-run":
    "El motor calcula la operacion pero no la envia. Ves lo que habria hecho sin tocar tu cuenta.",
  heartbeat:
    "La señal de vida del motor: la deja en cada ciclo. Si deja de llegar, el motor esta parado.",
  "kill switch":
    "La parada de emergencia: detiene todos los bots al instante y no deja abrir posiciones nuevas.",
  sharpe:
    "Cuanto ganas por cada unidad de riesgo. Sirve para comparar estrategias, no es una rentabilidad anual.",
  "walk-forward":
    "Probar la estrategia por bloques, usando solo el pasado para decidir y el futuro para medir. Es lo que separa una estrategia de una coincidencia.",
  benchmark:
    "Comprar y mantener. El rival minimo: si tu bot no lo supera, no esta haciendo nada especial.",
  "orden maker":
    "Una orden que se queda en el libro y espera a que otro la ejecute. Paga menos comisiones, pero puede no ejecutarse.",
  slippage_real:
    "El slippage que de verdad se dio, frente al que se estimo. Sirve para ver si el backtest fue optimista.",
};

export function Explicar({
  termino,
  className,
}: {
  /** La clave del glosario (o un texto libre: se usa como titulo). */
  termino: string;
  className?: string;
}) {
  const definicion = GLOSARIO[termino] ?? GLOSARIO[termino.toLowerCase()];
  if (!definicion) return null;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={`size-4 shrink-0 text-muted-foreground/70 hover:text-foreground ${className ?? ""}`}
          aria-label={`Qué es ${termino}`}
        >
          <CircleHelp className="size-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 text-xs leading-relaxed" align="start">
        <p className="mb-1 font-medium">{termino.replace(/_/g, " ")}</p>
        <p className="text-muted-foreground">{definicion}</p>
      </PopoverContent>
    </Popover>
  );
}

/** Titulo con un "?" que explica el termino. */
export function Termino({
  children,
  termino,
  className,
}: {
  children: React.ReactNode;
  termino: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-1 ${className ?? ""}`}>
      <span>{children}</span>
      <Explicar termino={termino} />
    </span>
  );
}
