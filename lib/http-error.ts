// Small typed exception for route handlers.
//
// Throw HttpError(status, message) inside a route or helper; the route's
// try/catch converts to a NextResponse with the right status code. Keeps
// route code linear and lets helpers signal HTTP semantics without holding
// a Response object.

export class HttpError extends Error {
  constructor(public status: number, message: string, public extra?: unknown) {
    super(message)
  }
}

export function isHttpError(e: unknown): e is HttpError {
  return e instanceof HttpError
}
