import { describe, it, expect } from 'vitest';
import { isConflictError, isPermissionDeniedError } from './firestoreErrors';

describe('firestoreErrors', () => {
  it('detects conflict errors from code', () => {
    expect(isConflictError({ code: 'failed-precondition' })).toBe(true);
    expect(isConflictError({ code: 'permission-denied' })).toBe(true);
    expect(isConflictError({ code: 'aborted' })).toBe(true);
    expect(isConflictError({ code: 'not-found' })).toBe(false);
  });

  it('detects conflict errors from revision mismatch message', () => {
    expect(isConflictError(new Error('Rule revision mismatch (expected rev 3, got 2)'))).toBe(true);
    expect(isConflictError(new Error('Document rev changed concurrently'))).toBe(true);
    expect(isConflictError(new Error('Precondition check failed'))).toBe(true);
    expect(isConflictError(new Error('Network error'))).toBe(false);
  });

  it('detects permission-denied errors', () => {
    expect(isPermissionDeniedError({ code: 'permission-denied' })).toBe(true);
    expect(isPermissionDeniedError({ code: 'unauthenticated' })).toBe(false);
    expect(isPermissionDeniedError(null)).toBe(false);
  });
});
