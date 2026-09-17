import { createClient } from '@supabase/supabase-js';

// ⚠️ Ce client utilise la clé SERVICE_ROLE : il contourne toutes les
// règles de sécurité (RLS) de Supabase. Il ne doit JAMAIS être utilisé
// côté navigateur — seulement ici, dans du code qui tourne sur Vercel.
export const supabaseAdmin = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);
