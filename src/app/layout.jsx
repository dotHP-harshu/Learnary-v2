import { Inter } from "next/font/google";
import Providers from "./providers";
import "./globals.css";

// Brand typography (redesign): single premium-neutral family, weights 300–700.
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

// Canonical origin for absolute OG/social URLs; set NEXT_PUBLIC_SITE_URL in
// Vercel env vars to the production domain.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000";

export const metadata = {
  metadataBase: new URL(siteUrl),
  applicationName: "Learnary",
  title: {
    default: "Learnary",
    template: "%s - Learnary",
  },
  description: "A Progressive Web App for tracking the learnings",
  openGraph: {
    title: { default: "Learnary", template: "%s - Learnary" },
    description: "A Progressive Web App for tracking the learnings",
    url: "/",
    siteName: "Learnary",
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512, alt: "Learnary" }],
    type: "website",
  },
  twitter: {
    card: "summary",
    title: { default: "Learnary", template: "%s - Learnary" },
    description: "A Progressive Web App for tracking the learnings",
    images: ["/icons/icon-512.png"],
  },
  icons: {
    icon: "/icons/icon-192.png",
    apple: "/icons/icon-192.png",
  },
  appleWebApp: {
    capable: true,
    title: "Learnary",
    statusBarStyle: "default",
  },
  formatDetection: {
    telephone: false,
  },
};

export const viewport = {
  themeColor: "#000000",
};

// Applies the stored theme class before first paint to avoid a flash of the
// wrong theme (default is dark, matching the previous behavior).
const themeScript = `try {
  var theme = localStorage.getItem("theme");
  if (theme !== "light") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
} catch (e) {}`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning className={inter.variable}>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
