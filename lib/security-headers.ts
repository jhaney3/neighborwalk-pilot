import { PRODUCTION_SUPABASE_HOST, SANDBOX_CONTENT_SECURITY_POLICY } from "./environment";

export function securityHeaders(production: boolean) {
  const productionCsp = [
    "default-src 'self'",
    // Next's static shell contains inline bootstrap scripts. Nonces can replace
    // this allowance if the authenticated shell becomes request-rendered.
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' blob: data: https://api.maptiler.com https://*.maptiler.com",
    `connect-src 'self' blob: https://${PRODUCTION_SUPABASE_HOST} wss://${PRODUCTION_SUPABASE_HOST} https://api.maptiler.com https://*.maptiler.com https://tiles.openfreemap.org https://fonts.openmaptiles.org`,
    "worker-src 'self' blob:",
    "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
  return [
    { key: "Content-Security-Policy", value: production ? productionCsp : `${SANDBOX_CONTENT_SECURITY_POLICY}; object-src 'none'; frame-ancestors 'none'` },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "no-referrer" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(self)" },
    ...(production ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
  ];
}
