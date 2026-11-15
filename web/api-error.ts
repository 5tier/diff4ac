export type ApiErrorKind = "http" | "contract";

/** An HTTP or contract failure from the diff4ac API. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly serverMessage: string,
    readonly kind: ApiErrorKind = "http",
  ) {
    super(`${status}: ${serverMessage}`);
    this.name = "ApiError";
  }
}
