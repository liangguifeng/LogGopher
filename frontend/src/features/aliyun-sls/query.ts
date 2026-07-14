/** Encodes result-menu filters in the provider-native Alibaba Cloud SLS dialect. */
const reservedQueryTerms = new Set([
  "and",
  "or",
  "not",
  "sort",
  "asc",
  "desc",
  "avg",
  "sum",
  "min",
  "max",
  "limit",
]);

/** Quotes an SLS index-query token only when the provider syntax requires it. */
export function encodeSLSQueryValue(value: unknown): string {
  if (typeof value !== "string") return String(value);
  if (
    /^[A-Za-z0-9_-]+$/.test(value) &&
    !reservedQueryTerms.has(value.toLowerCase())
  )
    return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Quotes SLS field names containing characters reserved by its query language. */
function encodeSLSQueryField(field: string): string {
  if (/^[A-Za-z_][A-Za-z0-9_.]*$/.test(field)) return field;
  return `"${field.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

/** Finds the first SLS SPL pipeline separator outside quoted query values. */
function splitSLSPipeline(expression: string): [string, string] {
  let quote = "";
  let escaped = false;
  for (let index = 0; index < expression.length; index += 1) {
    const character = expression[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (character === "\\") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      continue;
    }
    if (character === '"' || character === "'") {
      quote = character;
      continue;
    }
    if (character === "|")
      return [expression.slice(0, index), expression.slice(index + 1)];
  }
  return [expression, ""];
}

/** Appends an SLS field-index or full-text filter before an optional pipeline. */
export function appendSLSResultFilter(
  expression: string,
  queryField: string | undefined,
  value: unknown,
  exclude: boolean,
): string {
  const [rawSearch, rawPipeline] = splitSLSPipeline(expression);
  const search = rawSearch.trim() || "*";
  const encodedValue = encodeSLSQueryValue(value);
  // SLS console falls back to a full-text term when the clicked JSON leaf has
  // no field index. The display-only JSON path must never become an SPL field.
  const clause = queryField
    ? `${encodeSLSQueryField(queryField)}: ${encodedValue}`
    : encodedValue;
  const filtered = `${search} ${exclude ? "not" : "and"} ${clause}`;
  const pipeline = rawPipeline.trim();
  return pipeline ? `${filtered} | ${pipeline}` : filtered;
}
