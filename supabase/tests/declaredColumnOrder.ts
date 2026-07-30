/**
 * Extracts the column list, in declaration order, of every `create table`
 * block in a declarative schema file.
 *
 * Backs the column-order guard in column_order.test.ts. See the COLUMN-ORDER
 * TRAP header in supabase/schemas/01_tables.sql for why the order matters:
 * `supabase db diff` compares columns by ordinal position, so a `create table`
 * block that no longer matches `pg_attribute` makes every diff emit a
 * non-convergent cascade of view drops.
 *
 * This is deliberately a scanner, not a SQL parser. It only needs the top-level
 * comma-separated elements of a `create table (...)` body and the first token
 * of each — which quote-, comment-, paren- and bracket-aware character
 * scanning gets exactly right for this dialect, without pulling in a parser
 * whose failure mode would be a guard that quietly stops guarding.
 */

/** Keywords that open a TABLE constraint rather than a column definition. */
const CONSTRAINT_KEYWORDS = new Set([
  "constraint",
  "primary",
  "unique",
  "foreign",
  "check",
  "exclude",
  "like",
  "partition",
]);

type Scan = { text: string; end: number };

/**
 * Reads from `text[start]` (which must be the opening `(`) to its matching
 * `)`, skipping over nested parens/brackets, single- and double-quoted
 * literals and `--` comments. Returns the body between the parens and the
 * index just past the closing one. Dollar-quoting is not handled — it does not
 * appear inside a `create table` body, and this scanner is only ever pointed at
 * one.
 */
function readBalanced(text: string, start: number): Scan | null {
  let depth = 0;
  let i = start;

  while (i < text.length) {
    const ch = text[i];

    if (ch === "'" || ch === '"') {
      const quote = ch;
      i += 1;
      while (i < text.length) {
        if (text[i] === quote) {
          // Doubled quote is an escaped quote, not the terminator.
          if (text[i + 1] === quote) {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    if (ch === "-" && text[i + 1] === "-") {
      const newline = text.indexOf("\n", i);
      i = newline === -1 ? text.length : newline + 1;
      continue;
    }

    if (ch === "(" || ch === "[") {
      depth += 1;
      i += 1;
      continue;
    }

    if (ch === ")" || ch === "]") {
      depth -= 1;
      i += 1;
      if (depth === 0) return { text: text.slice(start + 1, i - 1), end: i };
      continue;
    }

    i += 1;
  }

  return null;
}

/** Splits a `create table` body on its top-level commas. */
function splitTopLevel(body: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = "";
  let i = 0;

  while (i < body.length) {
    const ch = body[i];

    if (ch === "'" || ch === '"') {
      const quote = ch;
      let literal = ch;
      i += 1;
      while (i < body.length) {
        literal += body[i];
        if (body[i] === quote) {
          if (body[i + 1] === quote) {
            literal += body[i + 1];
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      current += literal;
      continue;
    }

    if (ch === "-" && body[i + 1] === "-") {
      const newline = body.indexOf("\n", i);
      i = newline === -1 ? body.length : newline + 1;
      current += "\n";
      continue;
    }

    if (ch === "(" || ch === "[") depth += 1;
    if (ch === ")" || ch === "]") depth -= 1;

    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
      i += 1;
      continue;
    }

    current += ch;
    i += 1;
  }

  if (current.trim() !== "") parts.push(current);
  return parts;
}

/** `public.shidduchim` / `public."references"` / `shidduchim` -> bare name. */
function bareName(qualified: string): string {
  const last = qualified.split(".").pop() ?? qualified;
  return last.replace(/^"(.*)"$/, "$1");
}

/**
 * Maps table name -> declared column names, in file order, for every
 * `create table` in `sql`. Tables are keyed by their bare (unqualified,
 * unquoted) name, which is what `pg_class.relname` holds.
 */
export function parseDeclaredColumnOrder(sql: string): Map<string, string[]> {
  const tables = new Map<string, string[]>();
  const header =
    /create\s+table\s+(?:if\s+not\s+exists\s+)?((?:[\w$]+|"[^"]*")(?:\.(?:[\w$]+|"[^"]*"))*)\s*\(/gi;

  let match: RegExpExecArray | null;
  while ((match = header.exec(sql)) !== null) {
    const openParen = match.index + match[0].length - 1;
    const scan = readBalanced(sql, openParen);
    if (!scan) continue;

    const columns: string[] = [];
    for (const element of splitTopLevel(scan.text)) {
      // Drop comment lines so the first token is the definition's, not a
      // comment's first word.
      const cleaned = element
        .split("\n")
        .map((line) => line.replace(/--.*$/, ""))
        .join(" ")
        .trim();
      if (cleaned === "") continue;

      const token = cleaned.split(/[\s(]+/)[0];
      if (CONSTRAINT_KEYWORDS.has(token.toLowerCase())) continue;

      columns.push(token.replace(/^"(.*)"$/, "$1"));
    }

    tables.set(bareName(match[1]), columns);
    header.lastIndex = scan.end;
  }

  return tables;
}
