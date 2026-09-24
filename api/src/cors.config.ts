const localDevelopmentOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function getAllowedCorsOrigins() {
  return new Set(
    (process.env.CORS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim().replace(/\/$/, ''))
      .filter(Boolean),
  );
}

export function isAllowedCorsOrigin(
  origin: string | undefined,
  configuredOrigins = getAllowedCorsOrigins(),
) {
  if (!origin) {
    return true;
  }

  const normalizedOrigin = origin.replace(/\/$/, '');
  return (
    localDevelopmentOrigin.test(normalizedOrigin) ||
    configuredOrigins.has(normalizedOrigin)
  );
}