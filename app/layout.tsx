import type { Metadata } from "next";
import { Archivo, IBM_Plex_Mono } from "next/font/google";
import { headers } from "next/headers";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

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
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "neighborwalk-pilot.jhaney.chatgpt.site";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.includes("localhost") ? "http" : "https");
  return {
    metadataBase: new URL(`${protocol}://${host}`),
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
