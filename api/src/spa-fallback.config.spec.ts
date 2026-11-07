import { describe, expect, it } from '@jest/globals';
import { shouldServeSpaFallback } from './spa-fallback.config';

describe('SPA fallback policy', () => {
  it('should serve the SPA for browser page navigation', () => {
    expect(
      shouldServeSpaFallback(
        'GET',
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        '/tournaments/event-1/roster',
      ),
    ).toBe(true);
  });

  it('should let frontend API requests reach Nest controllers', () => {
    const angularAcceptHeader = 'application/json, text/plain, */*';

    expect(shouldServeSpaFallback('GET', angularAcceptHeader, '/tournaments')).toBe(false);
    expect(shouldServeSpaFallback('POST', angularAcceptHeader, '/tournaments')).toBe(false);
  });

  it.each([
    '/admin/tournaments/event-1/registrations/team-1/player-ids/player-1',
    '/admin/tournament-archive/event-1/registrations/team-1/player-ids/player-1',
    '/admin/tournament-archive/event-1/registrations/team-1/payment-proofs/player-1',
    '/admin/tournament-archive/event-1/protests/protest-1/evidence/0',
    '/admin/tournament-archive/event-1/terms',
    '/tournaments/event-1/terms',
    '/tournaments/event-1/registrations/team-1/payment-proofs/player-1',
    '/tournaments/event-1/protests/protest-1/evidence/0',
  ])('lets browser document navigation reach the API: %s', (path) => {
    expect(shouldServeSpaFallback('GET', 'text/html,application/xhtml+xml,*/*', path)).toBe(false);
  });
});
