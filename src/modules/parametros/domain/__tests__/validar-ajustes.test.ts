import { describe, it, expect } from 'vitest';
import {
  CLAVES_DE_AJUSTES_EDITABLES,
  validarAjustesAGuardar,
} from '@/modules/parametros/domain/validar-ajustes';

describe('CLAVES_DE_AJUSTES_EDITABLES', () => {
  it('lists exactly the keys the ajustes page saves', () => {
    expect([...CLAVES_DE_AJUSTES_EDITABLES].sort()).toEqual(
      [
        'allowed_share_values',
        'resumen_expenses_percentage',
        'resumen_next_year_shares_percentage',
        'next_year_capitalization_active',
        'four_per_thousand_rate',
        'default_loan_interest_rate',
        'max_active_loans_enabled',
        'max_active_loans_per_user',
        'loan_full_rate_day_limit',
        'loan_cutoff_day',
        'loan_extended_term_enabled',
      ].sort(),
    );
  });
});

describe('validarAjustesAGuardar', () => {
  const loteValido = [
    { key: 'allowed_share_values', value: [20000, 10000] },
    { key: 'resumen_expenses_percentage', value: 0.1 },
    { key: 'resumen_next_year_shares_percentage', value: 0.3 },
    { key: 'next_year_capitalization_active', value: false },
    { key: 'four_per_thousand_rate', value: 0.004 },
    { key: 'default_loan_interest_rate', value: 0.02 },
    { key: 'max_active_loans_enabled', value: true },
    { key: 'max_active_loans_per_user', value: 2 },
    { key: 'loan_full_rate_day_limit', value: 15 },
    { key: 'loan_cutoff_day', value: 25 },
    { key: 'loan_extended_term_enabled', value: false },
  ];

  it('accepts a valid batch and returns the typed values to store', () => {
    const r = validarAjustesAGuardar(loteValido, []);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toHaveLength(loteValido.length);
    expect(r.value.find((a) => a.key === 'allowed_share_values')?.value).toEqual([10000, 20000]);
    expect(r.value.find((a) => a.key === 'loan_cutoff_day')?.value).toBe(25);
  });

  it('rejects a key outside the whitelist', () => {
    const r = validarAjustesAGuardar([{ key: 'is_admin', value: true }], []);
    expect(r).toEqual({
      ok: false,
      error: { codigo: 'ajuste_no_editable', mensaje: 'El ajuste "is_admin" no se puede modificar desde esta pantalla.' },
    });
  });

  it('rejects a repeated key', () => {
    const r = validarAjustesAGuardar(
      [
        { key: 'loan_cutoff_day', value: 25 },
        { key: 'loan_cutoff_day', value: 20 },
      ],
      [],
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.codigo).toBe('ajuste_repetido');
  });

  it('rejects an empty batch', () => {
    const r = validarAjustesAGuardar([], []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.codigo).toBe('sin_ajustes');
  });

  it('returns the Spanish message of an invalid value', () => {
    const r = validarAjustesAGuardar([{ key: 'loan_cutoff_day', value: 40 }], []);
    expect(r).toEqual({
      ok: false,
      error: { codigo: 'dia_de_corte_invalido', mensaje: 'El día de corte debe ser un número entero entre 2 y 28.' },
    });
  });

  it.each([
    ['resumen_expenses_percentage', 1.5, 'El porcentaje de gastos debe estar entre 0% y 100%.'],
    ['four_per_thousand_rate', -0.1, 'El gravamen 4×1000 debe estar entre 0% y 100%.'],
    ['default_loan_interest_rate', 'x', 'La tasa de interés debe estar entre 0% y 100%.'],
    ['max_active_loans_per_user', 0, 'El máximo de préstamos activos debe ser un número entero de al menos 1.'],
    ['next_year_capitalization_active', 'sí', 'La capitalización del próximo año debe ser sí o no.'],
    ['max_active_loans_enabled', 1, 'El límite de préstamos activos debe ser sí o no.'],
  ])('rejects an invalid %s', (key, value, mensaje) => {
    const r = validarAjustesAGuardar([{ key, value }], []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.mensaje).toBe(mensaje);
  });

  it('rejects a day limit that is not before the cut-off day when both are sent', () => {
    const r = validarAjustesAGuardar(
      [
        { key: 'loan_full_rate_day_limit', value: 20 },
        { key: 'loan_cutoff_day', value: 20 },
      ],
      [],
    );
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: 'dias_de_prestamo_inconsistentes',
        mensaje: 'El día límite para la tasa completa (20) debe ser menor que el día de corte (20).',
      },
    });
  });

  it('checks a lone day limit against the stored cut-off day', () => {
    const guardados = [{ key: 'loan_cutoff_day', value: 10 }];
    const r = validarAjustesAGuardar([{ key: 'loan_full_rate_day_limit', value: 12 }], guardados);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.codigo).toBe('dias_de_prestamo_inconsistentes');
    expect(validarAjustesAGuardar([{ key: 'loan_full_rate_day_limit', value: 9 }], guardados).ok).toBe(true);
  });

  it('checks a lone cut-off day against the stored day limit', () => {
    const guardados = [{ key: 'loan_full_rate_day_limit', value: 20 }];
    const r = validarAjustesAGuardar([{ key: 'loan_cutoff_day', value: 18 }], guardados);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.codigo).toBe('dias_de_prestamo_inconsistentes');
  });

  it('checks a lone day against the default when the other day is not stored', () => {
    const r = validarAjustesAGuardar([{ key: 'loan_full_rate_day_limit', value: 26 }], []);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.mensaje).toBe('El día límite para la tasa completa (26) debe ser menor que el día de corte (25).');
  });
});
