export const env = {
  supabaseUrl: (import.meta.env.VITE_SUPABASE_URL as string | undefined) || '',
  supabaseKey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined) || (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || '',
  siteUrl: (import.meta.env.VITE_SITE_URL as string | undefined) || 'http://localhost:3000',
}

export const isCloudConfigured = Boolean(env.supabaseUrl && env.supabaseKey)
