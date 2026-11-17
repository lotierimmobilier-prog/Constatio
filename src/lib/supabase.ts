import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const cle = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

if (!url || !cle) {
  throw new Error(
    'Configuration manquante : renseignez VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY (voir .env.example).',
  );
}

export const supabase = createClient(url, cle, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
