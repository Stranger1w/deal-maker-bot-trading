// Tipos minimos de bun:test para que `tsc` compile los tests sin anadir
// "bun" a compilerOptions.types: los tipos globales de Bun redefinen `fetch`
// y chocan con el DOM en los clientes autogenerados de Supabase.
//
// Solo se declara la superficie que usamos. bun:test funciona igual en
// ejecucion (bun test src) porque Bun no lee esta declaracion: es solo
// satisfaccion de tipos para el chequeo estatico.
declare module "bun:test" {
  type TestFn = () => void | Promise<void>;
  export function test(name: string, fn: TestFn): void;
  export function describe(name: string, fn: () => void): void;
  export function expect(actual: unknown): {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeNull(): void;
    toBeUndefined(): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    toContain(expected: unknown): void;
    toBeGreaterThan(expected: number): void;
    toBeGreaterThanOrEqual(expected: number): void;
    toBeLessThan(expected: number): void;
    toBeLessThanOrEqual(expected: number): void;
    toBeCloseTo(expected: number, precision?: number): void;
    toBeInstanceOf(expected: unknown): void;
    toHaveLength(expected: number): void;
    toMatch(expected: string | RegExp): void;
    toThrow(expected?: unknown): void;
    not: {
      toBe(expected: unknown): void;
      toEqual(expected: unknown): void;
      toBeNull(): void;
      toBeUndefined(): void;
      toContain(expected: unknown): void;
      toBeGreaterThan(expected: number): void;
      toBeLessThan(expected: number): void;
      toBeLessThanOrEqual(expected: number): void;
      toBeInstanceOf(expected: unknown): void;
      toThrow(expected?: unknown): void;
    };
  };
  export const mock: (() => void) & { module: (fn: unknown) => void };
}

declare module "bun:test" {
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  export type Mock = ReturnType<typeof mock>;
}
