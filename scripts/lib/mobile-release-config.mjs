export function publicHttpsOrigin(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error(`${name} must be a public HTTPS origin.`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' || url.search || url.hash
    || !url.hostname.includes('.') || /(?:^|\.)(?:localhost|local|test|invalid|example)(?:\.|$)/i.test(url.hostname)
    || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) throw new Error(`${name} must be a public HTTPS origin without a path or credentials.`);
  return url.origin;
}

export function mobileReleaseConfig(env) {
  const inviteOrigin = publicHttpsOrigin(env.NEXT_PUBLIC_INVITE_ORIGIN, 'NEXT_PUBLIC_INVITE_ORIGIN');
  const serviceOrigin = publicHttpsOrigin(env.NEXT_PUBLIC_SERVICE_ORIGIN, 'NEXT_PUBLIC_SERVICE_ORIGIN');
  if (inviteOrigin === serviceOrigin) throw new Error('Use the dedicated invitation handoff origin, separate from the website.');
  const key = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';
  if (key.startsWith('sb_secret_')) throw new Error('Never bundle a Supabase secret key.');
  if (!key.startsWith('sb_publishable_')) {
    try {
      const claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8'));
      if (claims.role !== 'anon') throw new Error();
    } catch { throw new Error('Use a Supabase publishable key or legacy anon key.'); }
  }
  return { inviteOrigin, serviceOrigin };
}
