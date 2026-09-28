import { describe, expect, it } from '@jest/globals';
import { shouldServeSpaFallback } from './spa-fallback.config';

describe('SPA fallback policy', () => {
  it('should serve the SPA for browser page navigation', () => {
    expect(
      shouldServeSpaFallback(
        'GET',
        'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      ),
    ).toBe(true);
  });

  it('should let frontend API requests reach Nest controllers', () => {
    const angularAcceptHeader = 'application/json, text/plain, */*';

    expect(shouldServeSpaFallback('GET', angularAcceptHeader)).toBe(false);
    expect(shouldServeSpaFallback('POST', angularAcceptHeader)).toBe(false);
  });
});
