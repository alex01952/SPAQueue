export function isGoldMembershipActive(
  expiresOn: string | null | undefined,
  now = Date.now(),
): boolean {
  if (!expiresOn || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return false;
  const expiry = new Date(`${expiresOn}T00:00:00Z`);
  return Number.isFinite(expiry.getTime()) &&
    expiry.toISOString().slice(0, 10) === expiresOn &&
    now < expiry.getTime() + 86_400_000;
}
