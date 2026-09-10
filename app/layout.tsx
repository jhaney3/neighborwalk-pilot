import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { isProductionApp } from "../lib/environment";
import { InstallPromptCapture } from "../components/InstallPromptCapture";

const PRODUCTION_ORIGIN = "https://neighborwalk-pilot.vercel.app";

function metadataOrigin(): URL {
  try {
    return new URL(process.env.NEXT_PUBLIC_SITE_URL?.trim() || PRODUCTION_ORIGIN);
  } catch {
    return new URL(PRODUCTION_ORIGIN);
  }
}

const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
});

const plexMono = IBM_Plex_Mono({
  variable: "--font-plex-mono",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  metadataBase: metadataOrigin(),
  title: "NeighborWalk — Go together. Follow through personally.",
  description: "Turn neighborhood conversations into personal follow-through. Shared outings, owned next steps, and thoughtful care handoffs for church teams.",
  applicationName: "NeighborWalk",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "NeighborWalk" },
  formatDetection: { telephone: false },
  icons: { icon: "/favicon.svg", apple: "/apple-touch-icon.png" },
  openGraph: {
    title: "NeighborWalk",
    description: "Turn neighborhood conversations into personal follow-through.",
    type: "website",
    images: [{ url: "/og.png", width: 1728, height: 909, alt: "NeighborWalk neighborhood outreach field app" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "NeighborWalk",
    description: "Turn neighborhood conversations into personal follow-through.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className={`${archivo.variable} ${plexMono.variable}`}>
        <InstallPromptCapture />
        {!isProductionApp && <div className="sandbox-banner" role="status">Test workspace · Changes stay separate from production</div>}
        {children}
      </body>
    </html>
  );
}
