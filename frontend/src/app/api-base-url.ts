export function getApiBaseUrl() {
  const { hostname, port, protocol } = window.location;
  const isLocalDevelopmentHost =
    hostname === 'localhost' || hostname === '127.0.0.1';

  if (isLocalDevelopmentHost && port !== '3000') {
    return `${protocol}//${hostname}:3000`;
  }

  return '';
}
