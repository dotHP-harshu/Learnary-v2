// Sitemap: only the public, indexable pages. Authenticated surfaces are
// behind the client-side guard and disallowed in src/app/robots.js.
// The site origin comes from NEXT_PUBLIC_SITE_URL (set in Vercel env vars);
// without it an empty sitemap is served rather than a wrong origin.
export default function sitemap() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) return [];
  const now = new Date();
  return ["", "/signin", "/signup", "/forgot-password", "/reset-password"].map(
    (path) => ({
      url: `${siteUrl}${path}`,
      lastModified: now,
      changeFrequency: "monthly",
      priority: path === "" ? 1 : 0.5,
    })
  );
}
