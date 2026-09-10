import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";
import { isProductionApp } from "../lib/environment";

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
  title: "NeighborWalk — Neighborhood outreach, kept in order",
  description: "An offline-ready territory, visit, follow-up, and conversation companion for church outreach teams.",
  applicationName: "NeighborWalk",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "NeighborWalk" },
  formatDetection: { telephone: false },
  icons: { icon: "/favicon.svg", apple: "/apple-touch-icon.png" },
  openGraph: {
    title: "NeighborWalk",
    description: "Neighborhood outreach, kept in order.",
    type: "website",
    images: [{ url: "/og.png", width: 1728, height: 909, alt: "NeighborWalk neighborhood outreach field app" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "NeighborWalk",
    description: "Neighborhood outreach, kept in order.",
    images: ["/og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className={`${archivo.variable} ${plexMono.variable}`}>
        {!isProductionApp && <div className="sandbox-banner" role="status">Test workspace · Changes stay separate from production</div>}
        {children}
      </body>
    </html>
  );
}
