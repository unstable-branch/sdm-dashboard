/**
 * Typed failure for a non-2xx reply from the Plumber producer.
 *
 * The proxy client used to collapse every upstream reply into a generic
 * `Error`, so routes could not tell a client-owned denial (a typed 4xx from
 * the producer, e.g. unprocessable boundary content) from a genuine upstream
 * server fault.  This keeps the upstream status available without ever
 * carrying the producer body (which can contain internal paths) into a
 * response.
 */
export class PlumberUpstreamError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly method = "POST",
  ) {
    super(`${method} ${path} failed: ${status}`);
    this.name = "PlumberUpstreamError";
  }
}

export function isPlumberUpstreamError(error: unknown): error is PlumberUpstreamError {
  return error instanceof PlumberUpstreamError;
}
