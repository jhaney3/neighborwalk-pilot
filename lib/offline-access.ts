export const OFFLINE_MEMBERSHIP_WINDOW_MS = 24 * 60 * 60 * 1000;
export function offlineMembershipValid(verifiedAt: string | undefined, now = Date.now()) {
  const verified = verifiedAt ? Date.parse(verifiedAt) : NaN;
  return Number.isFinite(verified) && verified <= now && now - verified < OFFLINE_MEMBERSHIP_WINDOW_MS;
}
