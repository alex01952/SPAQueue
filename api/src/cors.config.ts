import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

const localDevelopmentOrigin = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (isAllowedCorsOrigin(origin)) {
      callback(null, true);
      return;
    }

    callback(new Error(`Origin ${origin} is not allowed by CORS.`), false);
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'x-dashboard-password'],
};

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