// Debt of each shareholder across their loans (RN-4.22, RN-4.27): every loan is
// independent, so the totals are plain sums of what each loan owes.

export interface DeudaDeUnPrestamo {
  accionistaId: string;
  saldoCapital: number;
  interesAdeudado: number;
}

export function deudaPorAccionista(
  prestamos: DeudaDeUnPrestamo[],
): Map<string, { saldoCapital: number; interesAdeudado: number }> {
  const total = new Map<string, { saldoCapital: number; interesAdeudado: number }>();
  for (const p of prestamos) {
    const actual = total.get(p.accionistaId) ?? { saldoCapital: 0, interesAdeudado: 0 };
    total.set(p.accionistaId, {
      saldoCapital: actual.saldoCapital + p.saldoCapital,
      interesAdeudado: actual.interesAdeudado + p.interesAdeudado,
    });
  }
  return total;
}
