import { isGoldMembershipActive } from './gold-membership';

describe('Gold membership expiry', () => {
  const now = Date.parse('2026-10-28T15:00:00Z');

  it.each([undefined, null, '', 'not-a-date', '2027-02-29', '2027-04-31', '2027-1-01'])(
    'does not activate missing or invalid expiry %s', (date) => {
      expect(isGoldMembershipActive(date, now)).toBe(false);
    },
  );

  it('is active through the entire UTC expiry date, and inactive at the next midnight', () => {
    expect(isGoldMembershipActive('2026-10-28', Date.parse('2026-10-28T23:59:59.999Z'))).toBe(true);
    expect(isGoldMembershipActive('2026-10-28', Date.parse('2026-10-29T00:00:00Z'))).toBe(false);
    expect(isGoldMembershipActive('2026-10-27', now)).toBe(false);
    expect(isGoldMembershipActive('2028-02-29', now)).toBe(true);
  });
});
