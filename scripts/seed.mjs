import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.local' });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

async function createAdmin() {
  const { data, error } = await supabase.auth.signUp({
    email: '123456789@ahorro.com',
    password: '123456',
  });
  
  if (error) {
    console.error('Error signing up:', error.message);
  } else {
    console.log('User signed up. Need to confirm email in DB.', data.user?.id);
  }
}

createAdmin();
