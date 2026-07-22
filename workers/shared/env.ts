// Bindings every Worker gets, regardless of its own business (AD-7). A Worker
// adds its own extra bindings (R2, KV, secrets) on top of this base in its own
// wrangler.toml + a local `type Bindings = BaseEnv & { ... }`.
export interface BaseEnv {
  SUPABASE_URL: string;
  SUPABASE_SERVICE_ROLE_KEY: string;
}
