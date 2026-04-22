// Crea el primer admin de Ahorro Familiar.
// Usa la service_role key — ejecutar SOLO local, nunca en cliente.
//
// Uso:
//   node scripts/seed-admin.mjs <documento> <password> <first_name> [last_name]
//
// Ejemplo:
//   node scripts/seed-admin.mjs 123456789 cambiar123 Carlos "García López"

import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const [,, document, password, firstName, lastName = ''] = process.argv;

if (!document || !password || !firstName) {
  console.error('Uso: node scripts/seed-admin.mjs <documento> <password> <first_name> [last_name]');
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY en .env.local');
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const email = `${document}@ahorro.com`;

let userId;

const { data: created, error: createErr } = await admin.auth.admin.createUser({
  email,
  password,
  email_confirm: true,
  user_metadata: { first_name: firstName, last_name: lastName, role: 'admin' },
});

if (createErr) {
  if (!/already been registered/i.test(createErr.message)) {
    console.error('Error creando usuario:', createErr.message);
    process.exit(1);
  }
  // Usuario ya existe — lo buscamos y reseteamos la contraseña.
  console.log('ℹ Usuario ya existía en Auth, reutilizando.');
  const { data: list, error: listErr } = await admin.auth.admin.listUsers();
  if (listErr) {
    console.error('Error listando usuarios:', listErr.message);
    process.exit(1);
  }
  const existing = list.users.find((u) => u.email === email);
  if (!existing) {
    console.error(`No se encontró el usuario ${email} pese al error de duplicado`);
    process.exit(1);
  }
  userId = existing.id;
  const { error: updateErr } = await admin.auth.admin.updateUserById(userId, {
    password,
    user_metadata: { first_name: firstName, last_name: lastName, role: 'admin' },
  });
  if (updateErr) {
    console.error('Error actualizando usuario:', updateErr.message);
    process.exit(1);
  }
} else {
  userId = created.user?.id;
}

if (!userId) {
  console.error('No se pudo obtener userId');
  process.exit(1);
}

const { error: profileErr } = await admin.from('profiles').upsert(
  {
    id: userId,
    first_name: firstName,
    last_name: lastName,
    identity_document: document,
    role: 'admin',
  },
  { onConflict: 'id' },
);

if (profileErr) {
  console.error('Error creando profile:', profileErr.message);
  process.exit(1);
}

console.log(`✔ Admin creado: ${email} (id: ${userId})`);
