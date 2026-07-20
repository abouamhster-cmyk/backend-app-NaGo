import { createClient } from '@supabase/supabase-js';
import { env } from './environment.js';

// Client standard (respecte les politiques de sécurité RLS)
export const supabase = createClient(env.SUPABASE_URL, env.SUPABASE_ANON_KEY, {
  auth: {
    persistSession: false,  
    autoRefreshToken: false,
  },
});

// Client d'administration (bypasse les politiques RLS pour les actions système sécurisées)
export const supabaseAdmin = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

console.log('✅ Supabase clients initialisés avec succès.');
