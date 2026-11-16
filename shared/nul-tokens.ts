/** Split NUL-delimited git output, dropping the trailing empty token. */
export function nulTokens(output: string): string[] {
  const tokens = output.split("\0");
  if (tokens.at(-1) === "") {
    tokens.pop();
  }
  return tokens;
}
