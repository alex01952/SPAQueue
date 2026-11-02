export function isMissingTableEntity(error: unknown): boolean {
  if (
    !error ||
    typeof error !== 'object' ||
    !('statusCode' in error) ||
    error.statusCode !== 404
  )
    return false;
  if ('code' in error && typeof error.code === 'string')
    return error.code === 'ResourceNotFound';
  if (
    'details' in error &&
    error.details &&
    typeof error.details === 'object' &&
    'odataError' in error.details
  ) {
    const detail = error.details.odataError;
    return (
      !!detail &&
      typeof detail === 'object' &&
      'code' in detail &&
      detail.code === 'ResourceNotFound'
    );
  }
  return false;
}
