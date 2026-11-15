/** An HTTP failure from the diff4ac API, with the server's status preserved. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly serverMessage: string,
  ) {
    super(`${status}: ${serverMessage}`);
    this.name = "ApiError";
  }
}
