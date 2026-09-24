import { createClient } from '@supabase/supabase-js';
import { handleDeletion, type DeletionReceipt } from './handler.ts';
import { revokeAppleAuthorization } from './apple.ts';

declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (request: Request) => Response | Promise<Response>): void };
Deno.serve((request: Request) => {
  const url = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
  const authorization = request.headers.get('authorization') ?? '';
  // OPTIONS never accesses the service. Missing configuration fails closed.
  if (!url || !serviceKey) return Response.json({ error: 'Deletion service unavailable' }, { status: 503 });
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const client = createClient(url, serviceKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false, autoRefreshToken: false } });
  let currentRequestId: string | undefined;
  return handleDeletion(request, {
    async user() {
      const token = /^Bearer (\S+)$/i.exec(authorization)?.[1];
      if (!token) return null;
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data.user || data.user.is_anonymous) return null;
      const apple = data.user.identities?.find(identity => identity.provider === 'apple');
      const subject = apple?.identity_data?.sub;
      if (apple && (typeof subject !== 'string' || !subject)) return null;
      return { id: data.user.id, appleSubject: subject };
    },
    async request() {
      const { data, error } = await client.rpc('request_account_deletion');
      if (error) throw new Error('Deletion request unavailable');
      currentRequestId = (data as DeletionReceipt)?.request_id;
      return data as DeletionReceipt;
    },
    async revokeApple(subject, code, nonce) {
      if (!currentRequestId) throw new Error("No deletion request");
      const { error } = await admin.rpc("begin_account_deletion_apple_attempt", { request_id: currentRequestId });
      if (error) throw new Error("Apple confirmation is temporarily unavailable");
      return revokeAppleAuthorization({ teamId: Deno.env.get('APPLE_TEAM_ID') ?? '', keyId: Deno.env.get('APPLE_KEY_ID') ?? '',
        clientId: Deno.env.get('APPLE_CLIENT_ID') ?? '', privateKey: Deno.env.get('APPLE_PRIVATE_KEY_PKCS8_BASE64') ?? '' }, subject, code, nonce);
    },
    async recordRevocation(requestId, subject) {
      const { error } = await admin.rpc('record_account_deletion_apple_revocation', { request_id: requestId, apple_subject: subject });
      if (error) throw new Error('Revocation receipt unavailable');
    },
  });
});
