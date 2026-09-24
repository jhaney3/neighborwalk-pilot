import { describe, expect, it } from 'vitest';
import { mobileReleaseConfig, publicHttpsOrigin } from '../scripts/lib/mobile-release-config.mjs';
const env = { NEXT_PUBLIC_INVITE_ORIGIN: 'https://invite.neighborwalk.org', NEXT_PUBLIC_SERVICE_ORIGIN: 'https://neighborwalk.org', NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_public' };
describe('mobile release configuration', () => {
  it('requires distinct public HTTPS origins', () => {
    expect(mobileReleaseConfig(env)).toEqual({ inviteOrigin: env.NEXT_PUBLIC_INVITE_ORIGIN, serviceOrigin: env.NEXT_PUBLIC_SERVICE_ORIGIN });
    for (const value of ['', 'http://invite.neighborwalk.org', 'https://localhost', 'https://127.0.0.1', 'https://name:secret@invite.neighborwalk.org', 'https://invite.neighborwalk.org/path', 'https://invite.neighborwalk.org?q=1', 'https://example.com']) {
      expect(() => publicHttpsOrigin(value, 'origin')).toThrow();
    }
    expect(() => mobileReleaseConfig({ ...env, NEXT_PUBLIC_INVITE_ORIGIN: env.NEXT_PUBLIC_SERVICE_ORIGIN })).toThrow('separate');
  });
  it('rejects secret and service-role keys even under the public variable name', () => {
    for (const key of ['sb_secret_secret', 'invalid', `a.${Buffer.from(JSON.stringify({ role: 'service_role' })).toString('base64url')}.b`]) {
      expect(() => mobileReleaseConfig({ ...env, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: key })).toThrow();
    }
    expect(mobileReleaseConfig({ ...env, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: `a.${Buffer.from(JSON.stringify({ role: 'anon' })).toString('base64url')}.b` })).toBeTruthy();
  });
});
