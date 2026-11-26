// Crawlers: the public auth pages are indexable; every authenticated surface
// and the internal API route are disallowed.
// Keep this list in sync with src/app/(protected)/ route names.
export default function robots() {
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/collection",
          "/tasks/",
          "/today",
          "/profile",
          "/onboarding",
          "/roadmap/",
          "/progress",
          "/practice",
          "/tutor",
          "/dashboard", // merged into /today; keep disallowed for strays
          "/settings", // merged into /profile; keep disallowed for strays
        ],
      },
    ],
    ...(siteUrl ? { sitemap: `${siteUrl}/sitemap.xml` } : {}),
  };
}
