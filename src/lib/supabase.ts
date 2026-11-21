import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const cle = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

/**
 * Faux tant que le site est publié sans son service de données : seule la vitrine
 * s'affiche alors, et l'espace client annonce son ouverture prochaine (voir App.tsx).
 * Un site qui plante à blanc faute de configuration ne dit rien à personne.
 */
export const configure = !!(url && cle);
if (!configure) console.warn('Constatio : VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY absents, espace client fermé (voir .env.example).');

export const supabase = createClient(url || 'https://non-configure.invalid', cle || 'non-configure', {
  auth: { persistSession: configure, autoRefreshToken: configure, detectSessionInUrl: configure },
});
