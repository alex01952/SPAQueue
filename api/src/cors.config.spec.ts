import { isAllowedCorsOrigin } from './cors.config';

describe('CORS origin policy', () => {
  it('should allow local development origins on different ports', () => {
    expect(isAllowedCorsOrigin('http://localhost:4200', new Set())).toBe(true);
    expect(isAllowedCorsOrigin('http://127.0.0.1:4200', new Set())).toBe(true);
    expect(isAllowedCorsOrigin('https://localhost:4300', new Set())).toBe(true);
  });

  it('should allow configured deployed origins and reject unknown origins', () => {
    const configuredOrigins = new Set(['https://spa.example.com']);

    expect(
      isAllowedCorsOrigin('https://spa.example.com', configuredOrigins),
    ).toBe(true);
    expect(
      isAllowedCorsOrigin('https://unexpected.example.com', configuredOrigins),
    ).toBe(false);
  });

  it('should allow requests without an Origin header', () => {
    expect(isAllowedCorsOrigin(undefined, new Set())).toBe(true);
  });
});