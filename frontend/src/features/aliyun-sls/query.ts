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
    /^[A-Za-z0-9_]+$/.test(value) &&
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

/** Builds an SLS Scan predicate for an unindexed field or nested JSON value. */
function buildSLSScanPredicate(
  field: string,
  value: unknown,
  exclude: boolean,
): string {
  const separator = field.indexOf(".");
  const jsonPath = `$.${field.slice(separator + 1)}`.replace(/'/g, "''");
  const reference =
    separator < 0
      ? encodeSLSQueryField(field)
      : `json_extract_scalar(${encodeSLSQueryField(field.slice(0, separator))}, '${jsonPath}')`;
  const literal = `'${String(value).replace(/'/g, "''")}'`;
  return exclude
    ? `${reference} is null or ${reference} != ${literal}`
    : `${reference} = ${literal}`;
}

/** Appends an SLS-specific index or Scan filter before an optional SPL pipeline. */
export function appendSLSResultFilter(
  expression: string,
  queryField: string | undefined,
  displayField: string,
  value: unknown,
  exclude: boolean,
): string {
  const [rawSearch, rawPipeline] = splitSLSPipeline(expression);
  const search = rawSearch.trim() || "*";
  if (!queryField) {
    const predicate = buildSLSScanPredicate(displayField, value, exclude);
    const pipeline = rawPipeline.trim();
    return pipeline
      ? `${search} | where ${predicate} | ${pipeline}`
      : `${search} | where ${predicate}`;
  }
  const encodedValue = encodeSLSQueryValue(value);
  const clause = `${encodeSLSQueryField(queryField)}: ${encodedValue}`;
  const filtered = `${search} ${exclude ? "not" : "and"} ${clause}`;
  const pipeline = rawPipeline.trim();
  return pipeline ? `${filtered} | ${pipeline}` : filtered;
}
