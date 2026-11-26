// App manifest, served at /manifest.webmanifest.
export default function manifest() {
  return {
    name: "Learnary",
    short_name: "Learnary",
    description: "A Progressive Web App for tracking the learnings",
    theme_color: "#000",
    background_color: "#000",
    display: "standalone",
    start_url: "/today",
    id: "/today",
    // PWA icon set. "any" icons are the full white-disc mark; the maskable
    // variant is full-bleed white with the mark inside the 80% safe zone so
    // Android's adaptive-mask crops never clip the artwork.
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}
