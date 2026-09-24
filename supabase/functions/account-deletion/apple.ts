/** Apple tokens exist only for this request. Never log or persist them. */
export type AppleConfig = { teamId: string; keyId: string; clientId: string; privateKey: string };
const encode = (value: Uint8Array) => btoa(String.fromCharCode(...value)).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
const decode = (value: string) => Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), c => c.charCodeAt(0));
const json = (value: unknown) => encode(new TextEncoder().encode(JSON.stringify(value)));

export async function appleClientSecret(config: AppleConfig, now = Math.floor(Date.now() / 1000)) {
  if (!/^[A-Z0-9]{10}$/.test(config.teamId) || !/^[A-Z0-9]{10}$/.test(config.keyId)
    || config.clientId !== 'app.neighborwalk.ios') throw new Error('Apple deletion is not configured');
  const key = await crypto.subtle.importKey('pkcs8', decode(config.privateKey), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const input = `${json({ alg: 'ES256', kid: config.keyId })}.${json({ iss: config.teamId, sub: config.clientId, aud: 'https://appleid.apple.com', iat: now, exp: now + 300 })}`;
  const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(input));
  return `${input}.${encode(new Uint8Array(signature))}`;
}

export async function verifyAppleIdentity(token: string, subject: string, clientId: string, nonce: string, fetcher: typeof fetch = fetch, now = Math.floor(Date.now() / 1000)) {
  const parts = token.split('.');
  if (parts.length !== 3 || token.length > 16384) throw new Error('Invalid Apple identity');
  const header = JSON.parse(new TextDecoder().decode(decode(parts[0])));
  const claims = JSON.parse(new TextDecoder().decode(decode(parts[1])));
  if (header.alg !== 'RS256' || typeof header.kid !== 'string' || claims.iss !== 'https://appleid.apple.com'
    || claims.sub !== subject || claims.aud !== clientId || claims.nonce !== nonce
    || typeof claims.exp !== 'number' || claims.exp <= now
    || typeof claims.iat !== 'number' || claims.iat > now + 60 || claims.iat < now - 600) throw new Error('Invalid Apple identity');
  const response = await fetcher('https://appleid.apple.com/auth/keys', { signal: AbortSignal.timeout(8000), redirect: 'error' });
  if (!response.ok) throw new Error('Apple verification unavailable');
  const { keys } = await response.json() as { keys: (JsonWebKey & { kid: string })[] };
  const jwk = keys.find(key => key.kid === header.kid && key.kty === 'RSA' && key.alg === 'RS256' && key.use === 'sig');
  if (!jwk) throw new Error('Invalid Apple identity');
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, decode(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))) throw new Error('Invalid Apple identity');
}

export async function revokeAppleAuthorization(config: AppleConfig, subject: string, code: string, nonce: string, fetcher: typeof fetch = fetch) {
  if (!code || code.length > 4096 || !/^[a-f0-9]{64}$/.test(nonce)) throw new Error('Apple reauthorization required');
  const clientSecret = await appleClientSecret(config);
  const post = (path: string, body: Record<string, string>) => fetcher(`https://appleid.apple.com/auth/${path}`, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.clientId, client_secret: clientSecret, ...body }),
    signal: AbortSignal.timeout(8000), redirect: 'error',
  });
  const response = await post('token', { code, grant_type: 'authorization_code' });
  if (!response.ok) throw new Error('Apple reauthorization required');
  const tokens = await response.json();
  if (typeof tokens.id_token !== 'string' || typeof tokens.refresh_token !== 'string' || !tokens.refresh_token) throw new Error('Invalid Apple token response');
  // Do not revoke another Apple account accidentally selected in the system sheet.
  await verifyAppleIdentity(tokens.id_token, subject, config.clientId, nonce, fetcher);
  const revoked = await post('revoke', { token: tokens.refresh_token, token_type_hint: 'refresh_token' });
  if (revoked.status !== 200) throw new Error('Apple revocation unavailable');
}
