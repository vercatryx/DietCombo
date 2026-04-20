import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getSupabaseServerSecretKey } from '../supabase-env';

export function getSupabaseAdmin(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = getSupabaseServerSecretKey();
  if (!url) throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL');
  if (!key) throw new Error('Missing Supabase server secret key (set SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY)');
  return createClient(url, key, { auth: { persistSession: false } });
}

