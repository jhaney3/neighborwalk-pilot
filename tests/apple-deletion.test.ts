import { beforeAll, describe, expect, it, vi } from 'vitest';
import { appleClientSecret, revokeAppleAuthorization, verifyAppleIdentity, type AppleConfig } from '../supabase/functions/account-deletion/apple';
import { handleDeletion, type DeletionDependencies } from '../supabase/functions/account-deletion/handler';
let signing: CryptoKeyPair;
let appleSigning: CryptoKeyPair;
let jwk: JsonWebKey;
let config: AppleConfig;
const nonce = 'a'.repeat(64);
const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
async function identity(overrides = {}, signatureKey = appleSigning.privateKey) {
  const now = Math.floor(Date.now() / 1000);
  const input = `${b64({ alg: 'RS256', kid: 'apple-key' })}.${b64({ iss: 'https://appleid.apple.com', aud: config.clientId, sub: 'apple-person', nonce, exp: now + 300, iat: now, ...overrides })}`;
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', signatureKey, new TextEncoder().encode(input));
  return `${input}.${Buffer.from(signature).toString('base64url')}`;
}
beforeAll(async () => {
  signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  appleSigning = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1,0,1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
  jwk = await crypto.subtle.exportKey('jwk', appleSigning.publicKey);
  config = { teamId: 'TEAM123456', keyId: 'KEY1234567', clientId: 'app.neighborwalk.ios', privateKey: Buffer.from(await crypto.subtle.exportKey('pkcs8', signing.privateKey)).toString('base64') };
});
const keyFetch = async () => Response.json({ keys: [{ ...jwk, kid: 'apple-key', alg: 'RS256', use: 'sig' }] });
describe('Apple deletion authorization', () => {
  it('signs a short-lived Apple client secret with the server key', async () => {
    const token = await appleClientSecret(config, 12345);
    const [header, claims, signature] = token.split('.');
    expect(JSON.parse(Buffer.from(claims, 'base64url').toString())).toEqual({ iss: config.teamId, sub: config.clientId, aud: 'https://appleid.apple.com', iat: 12345, exp: 12645 });
    expect(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, signing.publicKey, Buffer.from(signature, 'base64url'), new TextEncoder().encode(`${header}.${claims}`))).toBe(true);
  });
  it('verifies signature, identity, audience, nonce and freshness before revoking', async () => {
    await expect(verifyAppleIdentity(await identity(), 'apple-person', config.clientId, nonce, keyFetch)).resolves.toBeUndefined();
    for (const claims of [{ sub: 'someone-else' }, { aud: 'another.app' }, { iss: 'https://evil.test' }, { nonce: 'b'.repeat(64) }, { exp: 1 }, { iat: 1 }]) {
      await expect(verifyAppleIdentity(await identity(claims), 'apple-person', config.clientId, nonce, keyFetch)).rejects.toThrow();
    }
    const token = await identity();
    const parts = token.split('.'); parts[1] = b64({ ...JSON.parse(Buffer.from(parts[1], 'base64url').toString()), email: 'tampered' });
    await expect(verifyAppleIdentity(parts.join('.'), 'apple-person', config.clientId, nonce, keyFetch)).rejects.toThrow();
  });
  it('exchanges a fresh native code and revokes only the returned verified refresh token', async () => {
    const token = await identity();
    const fetcher = vi.fn<typeof fetch>(async (url) => {
      if (String(url).endsWith('/keys')) return keyFetch();
      if (String(url).endsWith('/token')) return Response.json({ id_token: token, refresh_token: 'secret-refresh' });
      return new Response(null, { status: 200 });
    });
    await revokeAppleAuthorization(config, 'apple-person', 'one-use-code', nonce, fetcher);
    const calls = fetcher.mock.calls;
    expect(calls.map(call => call[0])).toEqual(['https://appleid.apple.com/auth/token', 'https://appleid.apple.com/auth/keys', 'https://appleid.apple.com/auth/revoke']);
    expect(new URLSearchParams(String(calls[0][1]?.body)).has('redirect_uri')).toBe(false);
    expect(new URLSearchParams(String(calls[2][1]?.body)).get('token')).toBe('secret-refresh');
  });
  it('never revokes another Apple identity and propagates provider failures', async () => {
    const token = await identity({ sub: 'someone-else' });
    const fetcher = vi.fn<typeof fetch>(async () => Response.json({ id_token: token, refresh_token: 'secret' }));
    await expect(revokeAppleAuthorization(config, 'apple-person', 'code', nonce, fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
    const failed = vi.fn<typeof fetch>(async () => new Response(null, { status: 503 }));
    await expect(revokeAppleAuthorization(config, 'apple-person', 'code', nonce, failed)).rejects.toThrow();
  });
});
const receipt = { request_id: 'request', requested_at: '2026-09-24', due_at: '2026-10-24' };
function dependencies(appleSubject: string | undefined = 'apple-person') {
  return { user: vi.fn<DeletionDependencies['user']>(async () => ({ id: 'user', appleSubject })), request: vi.fn(async () => receipt), revokeApple: vi.fn(async () => {}), recordRevocation: vi.fn(async () => {}) };
}
const request = (body: unknown = { authorizationCode: 'code', nonce }) => new Request('https://edge.test', { method: 'POST', body: JSON.stringify(body) });
describe('deletion Edge handler', () => {
  it('requires verified identity and live-session request authorization before contacting Apple', async () => {
    const d = dependencies(); d.user.mockResolvedValueOnce(null);
    expect((await handleDeletion(request(), d)).status).toBe(401); expect(d.request).not.toHaveBeenCalled();
    d.request.mockRejectedValueOnce(new Error('Revoked session'));
    expect((await handleDeletion(request(), d)).status).toBe(400); expect(d.revokeApple).not.toHaveBeenCalled();
  });
  it('records the request first and revocation proof last', async () => {
    const d = dependencies();
    const result = await handleDeletion(request(), d);
    expect(result.status).toBe(200); expect(await result.json()).toEqual(receipt);
    expect(d.request.mock.invocationCallOrder[0]).toBeLessThan(d.revokeApple.mock.invocationCallOrder[0]);
    expect(d.recordRevocation).toHaveBeenCalledWith('request', 'apple-person');
    expect(result.headers.get('cache-control')).toBe('no-store');
  });
  it('keeps a recorded request when Apple fails without claiming completion or exposing secrets', async () => {
    const d = dependencies(); d.revokeApple.mockRejectedValueOnce(new Error('secret-token'));
    const result = await handleDeletion(request(), d);
    expect(result.status).toBe(409); expect(await result.json()).toMatchObject({ request_recorded: true });
    expect(d.recordRevocation).not.toHaveBeenCalled();
  });
  it('rejects malformed Apple requests and processes non-Apple accounts without Apple keys', async () => {
    const d = dependencies(); expect((await handleDeletion(request({}), d)).status).toBe(400); expect(d.request).not.toHaveBeenCalled();
    const noApple = dependencies(); noApple.user.mockResolvedValue({ id: 'user', appleSubject: undefined });
    expect((await handleDeletion(request({}), noApple)).status).toBe(200); expect(noApple.revokeApple).not.toHaveBeenCalled();
  });
  it('does not call dependencies for preflight or unsupported methods', async () => {
    const d = dependencies() satisfies DeletionDependencies;
    expect((await handleDeletion(new Request('https://edge.test', { method: 'OPTIONS' }), d)).status).toBe(204);
    expect((await handleDeletion(new Request('https://edge.test'), d)).status).toBe(405);
    expect(d.user).not.toHaveBeenCalled();
  });
});
