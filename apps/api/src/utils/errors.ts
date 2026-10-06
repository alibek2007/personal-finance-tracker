/** Domain/HTTP error carrying a stable machine code and a human-readable message. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: Record<string, string[]>,
  ) {
    super(message);
    this.name = 'AppError';
  }

  static badRequest(message: string, code = 'bad_request', details?: Record<string, string[]>) {
    return new AppError(400, code, message, details);
  }
  static unauthorized(message = 'Sign in to continue.') {
    return new AppError(401, 'unauthorized', message);
  }
  static forbidden(message = 'You do not have access to this.') {
    return new AppError(403, 'forbidden', message);
  }
  /** Used for both "missing" and "belongs to someone else" so ids cannot be probed. */
  static notFound(what = 'That item') {
    return new AppError(404, 'not_found', `${what} could not be found.`);
  }
  static conflict(message: string, code = 'conflict') {
    return new AppError(409, code, message);
  }
}
