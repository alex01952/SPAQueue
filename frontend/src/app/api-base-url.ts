export function getApiBaseUrl() {
  const { hostname, port } = window.location;

  if (hostname === 'localhost' && port !== '3000') {
    return 'http://localhost:3000';
  }

  return '';
}
