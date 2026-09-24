import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';
const apple = vi.hoisted(() => vi.fn());
vi.mock('../mobile/apple-auth', () => ({ appleDeletionCredential: apple }));
import { requestMobileAccountDeletion } from '../mobile/account-deletion';
const receipt = { request_id: 'request', requested_at: '2026-09-24', due_at: '2026-10-24' };
const getUser = vi.fn();
const invoke = vi.fn();
const client = { auth: { getUser }, functions: { invoke } } as unknown as SupabaseClient<Database>;
beforeEach(() => {
  vi.resetAllMocks();
  getUser.mockResolvedValue({ data: { user: { identities: [{ provider: 'apple' }] } }, error: null });
  apple.mockResolvedValue({ authorizationCode: 'short-lived', nonce: 'nonce' });
  invoke.mockResolvedValue({ data: receipt, error: null });
});
describe('mobile deletion client', () => {
  it('uses verified account identity, reauthorizes Apple and sends credentials only to the deletion service', async () => {
    expect(await requestMobileAccountDeletion(client)).toEqual(receipt);
    expect(apple).toHaveBeenCalledOnce();
    expect(invoke).toHaveBeenCalledExactlyOnceWith('account-deletion', { body: { authorizationCode: 'short-lived', nonce: 'nonce' } });
  });
  it('does not require Apple for email accounts', async () => {
    getUser.mockResolvedValue({ data: { user: { identities: [{ provider: 'email' }] } }, error: null });
    await requestMobileAccountDeletion(client);
    expect(apple).not.toHaveBeenCalled(); expect(invoke).toHaveBeenCalledWith('account-deletion', { body: {} });
  });
  it('does not submit when authentication or Apple confirmation fails', async () => {
    apple.mockRejectedValueOnce(new Error('Cancelled'));
    await expect(requestMobileAccountDeletion(client)).rejects.toThrow('Cancelled');
    expect(invoke).not.toHaveBeenCalled();
    getUser.mockResolvedValue({ data: { user: null }, error: new Error('expired') });
    await expect(requestMobileAccountDeletion(client)).rejects.toThrow('Sign in');
    expect(invoke).not.toHaveBeenCalled();
  });
  it('distinguishes a recorded request from failure without displaying provider secrets', async () => {
    invoke.mockResolvedValueOnce({ error: { context: Response.json({ request_recorded: true, error: 'secret-token' }) } });
    await expect(requestMobileAccountDeletion(client)).rejects.toThrow('request is recorded');
    invoke.mockResolvedValueOnce({ error: { context: Response.json({ error: 'secret-token' }) } });
    await expect(requestMobileAccountDeletion(client)).rejects.toThrow('could not be confirmed');
    invoke.mockResolvedValueOnce({ data: {}, error: null });
    await expect(requestMobileAccountDeletion(client)).rejects.toThrow('was not confirmed');
  });
});
