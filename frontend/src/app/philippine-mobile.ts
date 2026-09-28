export function isValidPhilippineMobile(value: string): boolean {
  return /^9\d{9}$/.test(value);
}

export function normalizePhilippineMobile(value: string): string {
  if (/^\+639\d{9}$/.test(value)) return value.slice(3);
  if (/^09\d{9}$/.test(value)) return value.slice(1);
  return value;
}

export function toPhilippineMobile(value: string): string {
  return `+63${value}`;
}