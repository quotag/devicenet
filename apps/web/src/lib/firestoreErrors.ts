/**
 * Firestore error handling utilities for DeviceNet Web Client.
 */

/**
 * Detects whether a Firestore write/update error is due to a concurrency conflict
 * (e.g., CAS revision mismatch, document already modified, failed precondition, or permission-denied from rules).
 */
export function isConflictError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object') {
    const code = (err as { code?: string }).code;
    const msg = String((err as { message?: string }).message ?? '');
    if (code === 'failed-precondition' || code === 'aborted') {
      return true;
    }
    if (code === 'permission-denied') {
      return true;
    }
    if (/rev|conflict|concurrent|precondition|already exists/i.test(msg)) {
      return true;
    }
  }
  return false;
}

/**
 * Detects whether an error is permission-denied (e.g., unauthenticated, removed from tenant, or revoked).
 */
export function isPermissionDeniedError(err: unknown): boolean {
  if (!err) return false;
  if (typeof err === 'object') {
    const code = (err as { code?: string }).code;
    return code === 'permission-denied';
  }
  return false;
}
