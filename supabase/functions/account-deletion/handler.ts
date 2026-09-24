export type DeletionReceipt = { request_id: string; requested_at: string; due_at: string };
export type DeletionDependencies = {
  user: () => Promise<{ id: string; appleSubject?: string } | null>;
  request: () => Promise<DeletionReceipt>;
  revokeApple: (subject: string, code: string, nonce: string) => Promise<void>;
  recordRevocation: (requestId: string, subject: string) => Promise<void>;
};

// Authentication and live-session authorization occur before any Apple call.
// Failed revocation leaves a real queued request for the operator, never a false
// completion receipt. Retrying with a fresh Apple code uses the same request.
export async function handleDeletion(request: Request, dependencies: DeletionDependencies) {
  const headers = { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': 'capacitor://localhost',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  const reply = (body: unknown, status: number) => Response.json(body, { status, headers });
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (request.method !== 'POST') return reply({ error: 'Method not allowed' }, 405);
  try {
    const user = await dependencies.user();
    if (!user) return reply({ error: 'Sign in before requesting deletion.' }, 401);
    const raw = await request.text();
    if (raw.length > 8192) return reply({ error: 'Invalid request' }, 413);
    const body = JSON.parse(raw || '{}');
    if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'Invalid request' }, 400);
    if (user.appleSubject && (typeof body.authorizationCode !== 'string' || !body.authorizationCode || body.authorizationCode.length > 4096
      || typeof body.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(body.nonce))) return reply({ error: 'Confirm your Apple account to request deletion.' }, 400);
    const receipt = await dependencies.request();
    if (!receipt.request_id || !receipt.requested_at || !receipt.due_at) throw new Error('No receipt');
    if (user.appleSubject) {
      try {
        await dependencies.revokeApple(user.appleSubject, body.authorizationCode, body.nonce);
        await dependencies.recordRevocation(receipt.request_id, user.appleSubject);
      } catch {
        return reply({ error: 'Your deletion request is recorded, but Apple authorization could not be revoked. Try again to confirm your Apple account.', request_recorded: true }, 409);
      }
    }
    return reply(receipt, 200);
  } catch {
    return reply({ error: 'Your deletion request could not be confirmed. Reconnect and try again.' }, 400);
  }
}
