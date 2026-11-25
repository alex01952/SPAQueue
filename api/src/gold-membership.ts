export function goldMembershipAnniversary(now = Date.now()): string {
  const anniversary = new Date(now);
  const month = anniversary.getUTCMonth();
  anniversary.setUTCFullYear(anniversary.getUTCFullYear() + 1);
  if (anniversary.getUTCMonth() !== month) anniversary.setUTCDate(0);
  return anniversary.toISOString().slice(0, 10);
}

export function isGoldMembershipActive(expiresOn: string | null, now = Date.now()): boolean {
  if (!expiresOn || !/^\d{4}-\d{2}-\d{2}$/.test(expiresOn)) return false;
  const expiry = new Date(`${expiresOn}T00:00:00Z`);
  return Number.isFinite(expiry.getTime()) && expiry.toISOString().slice(0, 10) === expiresOn &&
    now < expiry.getTime() + 86_400_000;
}
