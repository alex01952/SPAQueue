export function shouldServeSpaFallback(
  method: string,
  acceptHeader: string | undefined,
) {
  return method === 'GET' && (acceptHeader ?? '').includes('text/html');
}
