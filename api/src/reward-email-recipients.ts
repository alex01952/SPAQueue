import { BadRequestException } from '@nestjs/common';

export function normalizeRewardEmailList(
  value: unknown,
  label: string,
  required = false,
): string {
  if (value === undefined && !required) return '';
  if (
    typeof value !== 'string' ||
    value.length > 10_000 ||
    /[\r\n]/.test(value)
  )
    throw new BadRequestException(
      `${label} must be a comma- or semicolon-separated email list (up to 10,000 characters).`,
    );
  if (!value.trim() && !required) return '';
  const emails = value.split(/[,;]/).map((email) => email.trim());
  if (
    emails.some(
      (email) =>
        email.length > 254 ||
        !/^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(email),
    )
  )
    throw new BadRequestException(
      `${label} must contain valid email addresses separated by commas or semicolons.`,
    );
  const seen = new Set<string>();
  const normalized = emails
    .filter((email) => {
      const key = email.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join(', ');
  if (normalized.length > 10_000)
    throw new BadRequestException(
      `${label} must not exceed 10,000 characters after formatting.`,
    );
  return normalized;
}
