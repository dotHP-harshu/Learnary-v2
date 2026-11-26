import { createClient } from "@supabase/supabase-js";

// Without the env vars the app still builds and renders, but every Supabase
// call fails — same contract as before the Next.js migration. The fallbacks
// exist only so the client can be constructed during build-time prerendering.
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL || "https://placeholder.supabase.co",
  process.env.NEXT_PUBLIC_SUPABASE_API || "placeholder-anon-key"
);

export default supabase;
