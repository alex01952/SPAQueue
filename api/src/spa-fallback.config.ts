const tournamentDocumentPaths = [
  /^\/admin\/tournaments\/[^/]+\/registrations\/[^/]+\/player-ids\/[^/]+\/?$/i,
  /^\/admin\/tournament-archive\/[^/]+\/terms\/?$/i,
  /^\/admin\/tournament-archive\/[^/]+\/registrations\/[^/]+\/(?:payment-proofs|player-ids)\/[^/]+\/?$/i,
  /^\/admin\/tournament-archive\/[^/]+\/protests\/[^/]+\/evidence\/[^/]+\/?$/i,
  /^\/tournaments\/[^/]+\/terms\/?$/i,
  /^\/tournaments\/[^/]+\/registrations\/[^/]+\/payment-proofs\/[^/]+\/?$/i,
  /^\/tournaments\/[^/]+\/protests\/[^/]+\/evidence\/[^/]+\/?$/i,
];

export function shouldServeSpaFallback(
  method: string,
  acceptHeader: string | undefined,
  path: string,
) {
  return method === 'GET' && (acceptHeader ?? '').includes('text/html') &&
    !tournamentDocumentPaths.some((pattern) => pattern.test(path));
}
