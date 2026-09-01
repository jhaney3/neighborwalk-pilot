import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { headers } from "next/headers";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

const PRODUCTION_ORIGIN = "https://neighborwalk-pilot.vercel.app";

function metadataOrigin(requestHost: string | null, forwardedProtocol: string | null): string {
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredOrigin) {
    try {
      return new URL(configuredOrigin).origin;
    } catch {
      // Fall back to the known production origin if an environment value is malformed.
    }
  }

  const localHost = requestHost && (/^localhost(?::\d+)?$/i.test(requestHost) || /^127\.0\.0\.1(?::\d+)?$/.test(requestHost));
  if (localHost) {
    return `${forwardedProtocol ?? "http"}://${requestHost}`;
  }
  return PRODUCTION_ORIGIN;
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

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  const protocol = requestHeaders.get("x-forwarded-proto");
  return {
    metadataBase: new URL(metadataOrigin(host, protocol)),
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
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body suppressHydrationWarning className={`${archivo.variable} ${plexMono.variable}`}>{children}</body>
    </html>
  );
}
