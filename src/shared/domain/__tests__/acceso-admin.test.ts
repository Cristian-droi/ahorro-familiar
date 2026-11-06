import { describe, expect, it } from 'vitest';
import {
  esRutaAdmin,
  puedeEscribirAdmin,
  puedeLeerAdmin,
  rutaDeInicio,
} from '../acceso-admin';

describe('puedeLeerAdmin', () => {
  it('lets the gerente and the tesorero read', () => {
    expect(puedeLeerAdmin('gerente')).toBe(true);
    expect(puedeLeerAdmin('tesorero')).toBe(true);
  });

  it('denies a shareholder without an administrative role', () => {
    expect(puedeLeerAdmin(null)).toBe(false);
  });
});

describe('puedeEscribirAdmin', () => {
  it('lets only the tesorero write', () => {
    expect(puedeEscribirAdmin('tesorero')).toBe(true);
    expect(puedeEscribirAdmin('gerente')).toBe(false);
    expect(puedeEscribirAdmin(null)).toBe(false);
  });
});

describe('esRutaAdmin', () => {
  it.each([
    '/dashboard/admin',
    '/dashboard/admin/prestamos/abc',
    '/dashboard/solicitudes',
    '/dashboard/miembros',
    '/dashboard/libro-caja',
  ])('treats %s as administrative', (ruta) => {
    expect(esRutaAdmin(ruta)).toBe(true);
  });

  it.each([
    '/dashboard/accionista',
    '/dashboard/prestamos',
    '/dashboard/compras',
    '/dashboard/ajustes',
    '/dashboard/administrar',
  ])('treats %s as shareholder or shared', (ruta) => {
    expect(esRutaAdmin(ruta)).toBe(false);
  });
});

describe('rutaDeInicio', () => {
  it('sends the gerente and the tesorero to the administration home', () => {
    expect(rutaDeInicio('gerente')).toBe('/dashboard/admin');
    expect(rutaDeInicio('tesorero')).toBe('/dashboard/admin');
  });

  it('sends a shareholder to their account', () => {
    expect(rutaDeInicio(null)).toBe('/dashboard/accionista');
  });
});
