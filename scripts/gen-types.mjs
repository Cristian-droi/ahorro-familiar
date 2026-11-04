// Regenera src/types/database.ts desde la base local de Supabase.
//
// Uso:
//   npm run gen:types
//
// - Usa --local: nunca lee el proyecto en la nube.
// - Usa el CLI `supabase` instalado globalmente (scoop). Se quita
//   node_modules/.bin del PATH para que un CLI instalado vía npm no lo
//   reemplace: esa versión genera el archivo sin formatear. Para usar otro
//   binario, definir SUPABASE_CLI.
// - Si el CLI falla o no devuelve nada, no se toca database.ts.

import { spawnSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const OUTPUT = 'src/types/database.ts';
const cli = process.env.SUPABASE_CLI ?? 'supabase';

const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
const cleanPath = (process.env[pathKey] ?? '')
  .split(path.delimiter)
  .filter((dir) => !dir.replace(/\\/g, '/').includes('node_modules/.bin'))
  .join(path.delimiter);

// En Windows el CLI es un shim (.exe/.cmd) que se resuelve por la shell. Los
// argumentos son fijos, así que se pasa un solo comando en vez de un arreglo.
const command = `${cli} gen types typescript --local --schema public`;

const result = spawnSync(command, {
  encoding: 'utf8',
  maxBuffer: 64 * 1024 * 1024,
  shell: true,
  env: { ...process.env, [pathKey]: cleanPath },
  stdio: ['ignore', 'pipe', 'inherit'],
});

if (result.error) {
  console.error(`No se pudo ejecutar "${cli}": ${result.error.message}`);
  process.exit(1);
}
if (result.status !== 0) {
  console.error(`"${cli} gen types" terminó con código ${result.status}. ${OUTPUT} no se modificó.`);
  process.exit(result.status ?? 1);
}
if (!result.stdout.trim()) {
  console.error(`"${cli} gen types" no devolvió nada. ${OUTPUT} no se modificó.`);
  process.exit(1);
}

writeFileSync(OUTPUT, result.stdout);
console.log(`${OUTPUT} actualizado.`);
