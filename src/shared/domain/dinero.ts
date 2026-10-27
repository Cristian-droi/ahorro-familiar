// Integer pesos formatted for user-facing messages, e.g. 1200000 → "1.200.000"
// (docs/convenciones.md: "Primero debes pagar los intereses de este préstamo (20.000)").
// Built by hand so the output never depends on the runtime's locale data.

export function formatearPesos(pesos: number): string {
  const signo = pesos < 0 ? '-' : '';
  const digitos = String(Math.abs(pesos));
  return signo + digitos.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}
