export type ErrorCode =
  | 'ERR_MATRIX_EMPTY'
  | 'ERR_MATRIX_NOT_RECTANGULAR'
  | 'ERR_MATRIX_NON_POSITIVE'
  | 'ERR_MATRIX_NON_FINITE'
  | 'ERR_TARGET_LENGTH_MISMATCH'
  | 'ERR_TARGET_NON_POSITIVE'
  | 'ERR_TARGET_NON_FINITE'
  | 'ERR_SUM_MISMATCH'
  | 'ERR_INVALID_TOLERANCE'
  | 'ERR_INVALID_MAX_ROUNDS'
  | 'ERR_INVALID_SUM_TOLERANCE'
  | 'ERR_NUMERIC_FAILURE'
  | 'ERR_NOT_FOUND'
  | 'ERR_BAD_REQUEST';

export class ApiError extends Error {
  constructor(public code: ErrorCode, message: string, public details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }
}
