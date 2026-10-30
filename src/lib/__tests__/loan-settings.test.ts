import { describe, it, expect } from 'vitest';
import {
  accionesPorPrestamo,
  desembolsoDePrestamo,
  reglasDeInteresDesdeAjuste,
  tasaCuatroPorMilDesdeAjuste,
  tasaEnPuntosBasicosDesdeAjuste,
} from '@/lib/loan-settings';

describe('tasaCuatroPorMilDesdeAjuste (RN-4.16)', () => {
  it('converts the stored fraction 0.004 into 4 thousandths', () => {
    expect(tasaCuatroPorMilDesdeAjuste(0.004)).toBe(4);
    expect(tasaCuatroPorMilDesdeAjuste('0.004')).toBe(4);
  });

  it('keeps an explicit zero rate', () => {
    expect(tasaCuatroPorMilDesdeAjuste(0)).toBe(0);
  });

  it('uses the default 4 when the setting is missing or invalid', () => {
    for (const valor of [null, undefined, '', 'abc', -0.004, Number.NaN]) {
      expect(tasaCuatroPorMilDesdeAjuste(valor)).toBe(4);
    }
  });
});

describe('accionesPorPrestamo (RN-4.10)', () => {
  it('rounds the shares up with a 500.000 step', () => {
    expect(accionesPorPrestamo(1_200_000, 25_000)).toEqual({ ok: true, value: { cantidad: 3, valor: 75_000 } });
    expect(accionesPorPrestamo(900_000, 50_000)).toEqual({ ok: true, value: { cantidad: 2, valor: 100_000 } });
  });
});

describe('desembolsoDePrestamo (RN-4.14, RN-4.16)', () => {
  const base = {
    monto: 1_000_000,
    accionesPorPrestamo: 100_000,
    pagadasPorAdelantado: false,
    accionesVencidas: 0,
    multas: 0,
    intereses: 0,
    capital: 0,
    tasaPorMil: 4,
  };

  it('taxes the net after the loan shares: 1.000.000 − 100.000 → 4x1000 3.600 → 896.400', () => {
    const r = desembolsoDePrestamo(base);
    expect(r.ok && r.value).toMatchObject({ netoAntesDeImpuesto: 900_000, cuatroPorMil: 3_600, seTransfiere: 896_400 });
  });

  it('does not deduct loan shares paid upfront', () => {
    const r = desembolsoDePrestamo({ ...base, pagadasPorAdelantado: true });
    expect(r.ok && r.value).toMatchObject({ netoAntesDeImpuesto: 1_000_000, cuatroPorMil: 4_000, seTransfiere: 996_000 });
  });

  it('adds overdue shares, fines, interest and capital to the deductions', () => {
    const r = desembolsoDePrestamo({
      ...base,
      monto: 2_000_000,
      accionesPorPrestamo: 40_000,
      accionesVencidas: 50_000,
      multas: 10_000,
      intereses: 30_000,
      capital: 500_000,
    });
    expect(r.ok && r.value).toMatchObject({ totalDeducciones: 630_000, cuatroPorMil: 5_480, seTransfiere: 1_364_520 });
  });

  it('returns the domain error when the deductions exceed the amount', () => {
    const r = desembolsoDePrestamo({ ...base, capital: 950_000 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.codigo).toBe('deducciones_mayores_al_monto');
  });
});

describe('tasaEnPuntosBasicosDesdeAjuste (RN-4.18)', () => {
  it('converts the stored fraction 0.02 into 200 basis points', () => {
    expect(tasaEnPuntosBasicosDesdeAjuste(0.02)).toBe(200);
    expect(tasaEnPuntosBasicosDesdeAjuste('0.02')).toBe(200);
    expect(tasaEnPuntosBasicosDesdeAjuste(0.0125)).toBe(125);
  });

  it('keeps an explicit zero rate', () => {
    expect(tasaEnPuntosBasicosDesdeAjuste(0)).toBe(0);
  });

  it('uses the default 2% when the setting is missing or invalid', () => {
    for (const valor of [null, undefined, '', 'abc', -0.02, Number.NaN]) {
      expect(tasaEnPuntosBasicosDesdeAjuste(valor)).toBe(200);
    }
  });
});

describe('reglasDeInteresDesdeAjuste (RN-4.15, RN-4.18, RN-4.20)', () => {
  it('uses the stored rate with the default day 15 and cut-off day 25', () => {
    expect(reglasDeInteresDesdeAjuste(0.03)).toEqual({
      tasaEnPuntosBasicos: 300,
      diaLimiteTasaCompleta: 15,
      diaDeCorte: 25,
    });
  });
});
