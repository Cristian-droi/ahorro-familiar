import { describe, it, expect } from 'vitest';
import { formatearPesos } from '@/shared/domain/dinero';

describe('formatearPesos', () => {
  it.each([
    [0, '0'],
    [999, '999'],
    [1000, '1.000'],
    [20000, '20.000'],
    [1200000, '1.200.000'],
    [-24389, '-24.389'],
  ])('formats %i as %s', (pesos, esperado) => {
    expect(formatearPesos(pesos)).toBe(esperado);
  });
});
