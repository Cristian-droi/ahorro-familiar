import { describe, it, expect } from 'vitest';
import { ESLint } from 'eslint';
import path from 'path';

// Layer boundaries from docs/convenciones.md, section 2, enforced by eslint.config.mjs.
const eslint = new ESLint({ cwd: path.resolve(__dirname, '../..') });

async function reglasQueFallan(codigo: string, archivo: string): Promise<string[]> {
  const [resultado] = await eslint.lintText(codigo, { filePath: archivo });
  return resultado.messages
    .filter((m) => m.ruleId === 'no-restricted-imports' || m.ruleId === 'no-restricted-syntax' || m.ruleId === 'no-restricted-globals')
    .map((m) => `${m.severity === 2 ? 'error' : 'warn'}:${m.ruleId}`);
}

const DOMINIO = 'src/modules/prestamos/domain/calcular-interes.ts';
const DOMINIO_COMPARTIDO = 'src/shared/domain/dinero.ts';
const APLICACION = 'src/modules/prestamos/application/solicitar-prestamo.ts';
const INFRA = 'src/modules/prestamos/infra/prestamos-repository.ts';
const RUTA_LEGADA = 'src/app/api/prestamos/route.ts';

describe('domain layer', () => {
  it.each([
    "import { createClient } from '@supabase/supabase-js';",
    "import { NextResponse } from 'next/server';",
    "import { useState } from 'react';",
    "import { repo } from '../infra/prestamos-repository';",
    "import { caso } from '@/modules/prestamos/application/solicitar-prestamo';",
    "import { checkUserObligations } from '@/lib/obligations';",
    "import Boton from '@/components/ui/boton';",
  ])('rejects: %s', async (importacion) => {
    expect(await reglasQueFallan(`${importacion}\nexport const x = 1;\n`, DOMINIO)).toContain(
      'error:no-restricted-imports',
    );
  });

  it('applies the same import rules to shared/domain', async () => {
    const codigo = "import { NextResponse } from 'next/server';\nexport const x = 1;\n";
    expect(await reglasQueFallan(codigo, DOMINIO_COMPARTIDO)).toContain('error:no-restricted-imports');
  });

  it.each([
    'export const hoy = new Date();',
    'export const ahora = Date.now();',
    'export const env = process.env.SECRET;',
    "export const r = fetch('https://x');",
  ])('rejects reading time, env or network: %s', async (codigo) => {
    const fallas = await reglasQueFallan(codigo, DOMINIO);
    expect(fallas.some((f) => f.startsWith('error:'))).toBe(true);
  });

  it('allows building a date from an explicit value', async () => {
    expect(await reglasQueFallan("export const d = new Date('2026-10-19');", DOMINIO)).toEqual([]);
  });

  it('allows importing shared/domain and the same module domain', async () => {
    const codigo = [
      "import { ok } from '@/shared/domain/result';",
      "import { hoyBogota } from '../../../shared/domain/fechas';",
      "import { tasa } from './tasa';",
      'export const x = [ok, hoyBogota, tasa];',
    ].join('\n');
    expect(await reglasQueFallan(codigo, DOMINIO)).toEqual([]);
  });
});

describe('application layer', () => {
  it.each([
    "import { repo } from '../infra/prestamos-repository';",
    "import { createClient } from '@supabase/supabase-js';",
    "import { NextResponse } from 'next/server';",
  ])('rejects: %s', async (importacion) => {
    expect(await reglasQueFallan(`${importacion}\nexport const x = 1;\n`, APLICACION)).toContain(
      'error:no-restricted-imports',
    );
  });

  it('allows importing the domain', async () => {
    const codigo = "import { calcular } from '../domain/calcular-interes';\nexport const x = calcular;\n";
    expect(await reglasQueFallan(codigo, APLICACION)).toEqual([]);
  });
});

describe('Supabase admin client', () => {
  const importacion = "import { createSupabaseAdminClient } from '@/lib/supabase/admin';\nexport const x = createSupabaseAdminClient;\n";

  it('is allowed in a module infra layer', async () => {
    expect(await reglasQueFallan(importacion, INFRA)).toEqual([]);
  });

  it('only warns in legacy route handlers until S4', async () => {
    expect(await reglasQueFallan(importacion, RUTA_LEGADA)).toEqual(['warn:no-restricted-imports']);
  });
});
