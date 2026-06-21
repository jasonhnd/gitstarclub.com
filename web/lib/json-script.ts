const JSON_SCRIPT_ESCAPES: Record<string, string> = {
  "<": "\\u003c",
  ">": "\\u003e",
  "&": "\\u0026",
  "\u2028": "\\u2028",
  "\u2029": "\\u2029",
};

export function stringifyJsonForScript(data: unknown): string {
  return (JSON.stringify(data) ?? "null").replace(/[<>&\u2028\u2029]/g, (char) => JSON_SCRIPT_ESCAPES[char]);
}
