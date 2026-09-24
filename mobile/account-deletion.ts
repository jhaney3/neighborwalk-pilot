import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../lib/database.types';
import { appleDeletionCredential } from './apple-auth';

export async function requestMobileAccountDeletion(client: SupabaseClient<Database>) {
  const { data: account, error: identityError } = await client.auth.getUser();
  if (identityError || !account.user) throw new Error('Sign in before requesting deletion.');
  const apple = account.user.identities?.some(identity => identity.provider === 'apple');
  const body = apple ? await appleDeletionCredential() : {};
  const { data, error } = await client.functions.invoke('account-deletion', { body });
  if (error) {
    // Only display fixed messages; never show provider details or echoed tokens.
    let recorded = false;
    try { recorded = (await error.context?.json())?.request_recorded === true; } catch { /* no response */ }
    throw new Error(recorded
      ? 'Your deletion request is recorded, but Apple confirmation needs another attempt. Wait one minute, then confirm the same Apple account again.'
      : 'Your deletion request could not be confirmed. Reconnect and try again. Your account has not been deleted.');
  }
  if (!data?.request_id || !data?.requested_at || !data?.due_at) throw new Error('Your deletion request was not confirmed. Please try again.');
  return data as { request_id: string; requested_at: string; due_at: string };
}
