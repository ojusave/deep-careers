/**
 * Errors that the backend can safely explain to the browser.
 * Workflows throw AppError with a message and code; HTTP handlers turn it into JSON.
 * Unexpected errors receive a generic message so internal details stay on the server.
 */
export class AppError extends Error {
  status: number;
  code: string;
  constructor(message: string, status = 400, code = "INVALID_INPUT") {
    super(message);
    this.name = "AppError";
    this.status = status;
    this.code = code;
  }
}
export function errorPayload(error: unknown): {
  error: string;
  code: string;
  status: number;
} {
  if (error instanceof AppError) return {
    error: error.message,
    code: error.code,
    status: error.status
  };
  return {
    error: "The research could not finish. Your existing work is unchanged; please try again.",
    code: "RESEARCH_FAILED",
    status: 502
  };
}
