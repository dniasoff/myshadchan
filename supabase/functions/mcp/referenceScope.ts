import type { Statement } from "npm:pgsql-ast-parser@^12";

/**
 * RULING 7 — a reference exists only within a shidduch's context.
 *
 * References keep their full 360 and stay shared across shidduchim; what is
 * removed is the *browse surface*. The SPA closes it by deleting the list,
 * the nav entry and the global-search fan-out. The MCP tools are the same
 * surface for an AI client: `query` can `SELECT * FROM references_summary`
 * (an unfiltered roster of every reference in the account) and `mutate` can
 * `INSERT INTO "references"` (an orphan with zero reference_links — the exact
 * defect `cbc311a` fixed in ReferenceCreate). This module scopes both.
 *
 * Two things it deliberately does NOT do:
 *
 * 1. It does not amputate the capability. A reference reached *through* a
 *    shidduch is legitimate, and so is the cross-shidduch view (which
 *    shidduchim does this reference serve) — that one is a feature the owner
 *    explicitly wants. Both stay allowed.
 * 2. It is not a security boundary (ruling clause 6). Within an account the
 *    reference book is deliberately account-wide and RLS says so; nothing
 *    here returns data the caller could not already reach. It is a product
 *    rule enforced on a best-effort basis over the statement's AST, and a
 *    caller determined to evade it can (e.g. by anchoring on a sub-select
 *    that is itself unfiltered). Do not harden this with RLS — that would
 *    break the cross-shidduch view, `useReferenceLinks`, merge and
 *    match-on-entry for zero privacy gain.
 */

/** Relations that expose reference records (rows, names, phones). */
const REFERENCE_RELATIONS = new Set([
  "references",
  "references_summary",
  "reference_links",
  "reference_links_summary",
]);

/** Relations that identify a shidduch, for anchor resolution. */
const SHIDDUCH_RELATIONS = new Set(["shidduchim", "shidduchim_summary"]);

/** The only writable reference relation. `references_summary` is a view. */
const REFERENCES_TABLE = "references";
const REFERENCE_LINKS_TABLE = "reference_links";

/** The idempotent, account-checked RPC that is the one sanctioned linker. */
const LINK_RPC = "link_reference_to_shidduch";

/** Columns whose value names a specific shidduch or a specific reference. */
const ANCHOR_COLUMNS = new Set([
  "shidduchim_id",
  "shidduch_id",
  "reference_id",
]);

const ANCHOR_OPS = new Set(["=", "IN", "ANY"]);

const SCOPE_HINT =
  `References are scoped to a shidduch. A query that reads references, ` +
  `references_summary, reference_links or reference_links_summary must name ` +
  `a shidduch or a reference. Use "WHERE shidduchim_id = <shidduch id>" for ` +
  `the references serving one shidduch, or "WHERE reference_id = <reference ` +
  `id>" for one reference — including every shidduch it serves. References ` +
  `cannot be listed or searched outside a shidduch's context.`;

const CREATE_HINT =
  `A reference cannot be created unattached to a shidduch. Create and link ` +
  `it in one statement:\n` +
  `WITH new_ref AS (\n` +
  `  INSERT INTO "references" (name_en, relationship, phone)\n` +
  `  VALUES ('Rabbi Cohen', 'shul rabbi', '555-0100') RETURNING id\n` +
  `)\n` +
  `SELECT public.${LINK_RPC}(new_ref.id, <shidduchim_id>) FROM new_ref;`;

const LINK_HINT =
  `An INSERT INTO reference_links must set shidduchim_id — a link with no ` +
  `shidduch is unreadable even to its own author. Prefer ` +
  `public.${LINK_RPC}(<reference_id>, <shidduchim_id>), which is idempotent.`;

type Node = Record<string, unknown>;

interface Relation {
  name: string;
  alias: string | null;
}

interface StatementFacts {
  /** Relations the statement reads from (insert targets excluded). */
  read: Relation[];
  /** Relations the statement inserts into. */
  insertTargets: { name: string; columns: string[] | null }[];
  /** Relations the statement updates or deletes from. */
  writeTargets: string[];
  /** Lower-cased names of every function the statement calls. */
  calls: Set<string>;
  /** alias (and bare relation name) -> relation name. */
  aliases: Map<string, string>;
  /** Every binary expression node, for anchor detection. */
  binaries: Node[];
}

function isNode(value: unknown): value is Node {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function walk(value: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) walk(item, visit);
    return;
  }
  if (!isNode(value)) return;
  visit(value);
  for (const child of Object.values(value)) walk(child, visit);
}

/** Reads a `{ name, alias, schema }` qualified-name node. */
function readName(value: unknown): Relation | null {
  if (!isNode(value) || typeof value.name !== "string") return null;
  return {
    name: value.name.toLowerCase(),
    alias: typeof value.alias === "string" ? value.alias.toLowerCase() : null,
  };
}

function collectFacts(statements: Statement[]): StatementFacts {
  const facts: StatementFacts = {
    read: [],
    insertTargets: [],
    writeTargets: [],
    calls: new Set(),
    aliases: new Map(),
    binaries: [],
  };

  const addRead = (relation: Relation | null): void => {
    if (!relation) return;
    facts.read.push(relation);
    facts.aliases.set(relation.name, relation.name);
    if (relation.alias) facts.aliases.set(relation.alias, relation.name);
  };

  walk(statements, (node) => {
    switch (node.type) {
      case "table":
        // FROM / JOIN entries, anywhere including CTE bodies and subqueries.
        addRead(readName(node.name));
        break;
      case "insert": {
        const target = readName(node.into);
        if (target) {
          const columns = Array.isArray(node.columns)
            ? node.columns
                .map((column) => readName(column)?.name ?? null)
                .filter((column): column is string => column !== null)
            : null;
          facts.insertTargets.push({ name: target.name, columns });
          if (target.alias) facts.aliases.set(target.alias, target.name);
        }
        break;
      }
      case "update": {
        const target = readName(node.table);
        // An UPDATE's target is also read — its WHERE clause selects rows.
        addRead(target);
        if (target) facts.writeTargets.push(target.name);
        break;
      }
      case "delete": {
        const target = readName(node.from);
        addRead(target);
        if (target) facts.writeTargets.push(target.name);
        break;
      }
      case "call": {
        const fn = readName(node.function);
        if (fn) facts.calls.add(fn.name);
        break;
      }
      case "binary":
        facts.binaries.push(node);
        break;
      default:
        break;
    }
  });

  return facts;
}

function isReferenceRelation(name: string | null | undefined): boolean {
  return name != null && REFERENCE_RELATIONS.has(name);
}

/** Resolves the relation a `table.column` reference belongs to, if knowable. */
function resolveRef(node: Node, facts: StatementFacts): string | null {
  const qualifier = readName(node.table)?.name ?? null;
  if (qualifier) return facts.aliases.get(qualifier) ?? null;
  // Unqualified: only unambiguous when the statement reads one relation.
  const distinct = new Set(facts.read.map((relation) => relation.name));
  return distinct.size === 1 ? [...distinct][0] : null;
}

/** True when the ref identifies a single reference record. */
function isReferenceIdentity(node: Node, facts: StatementFacts): boolean {
  const column = typeof node.name === "string" ? node.name.toLowerCase() : "";
  if (column === "reference_id") return true;
  return column === "id" && isReferenceRelation(resolveRef(node, facts));
}

/**
 * A statement reading references is in scope when at least one predicate
 * anchors it. Two shapes count:
 *
 *  (A) an anchor column compared against something that is not another
 *      column — `shidduchim_id = 42`, `reference_id IN (7, 9)`,
 *      `s.id = $1`. The caller has named a shidduch or a reference.
 *      Column-to-column comparisons are excluded on purpose: `l.reference_id
 *      = r.id` is a join condition, and treating it as an anchor would let
 *      `FROM "references" r JOIN reference_links l ON …` enumerate the book.
 *
 *  (B) a reference's identity bound to a column of a NON-reference relation —
 *      `r.id = t.target_id` over tasks. The reference set is then determined
 *      by the other entity, which is reachability, not browsing. This is what
 *      keeps `display_task_list` able to hydrate the label of a
 *      reference-linked task.
 */
function hasAnchor(facts: StatementFacts): boolean {
  for (const binary of facts.binaries) {
    const op = typeof binary.op === "string" ? binary.op.toUpperCase() : "";
    if (!ANCHOR_OPS.has(op)) continue;

    const left = isNode(binary.left) ? binary.left : null;
    const right = isNode(binary.right) ? binary.right : null;

    for (const [side, other] of [
      [left, right],
      [right, left],
    ] as [Node | null, Node | null][]) {
      if (!side || side.type !== "ref") continue;
      const otherIsColumn = other?.type === "ref";
      const column =
        typeof side.name === "string" ? side.name.toLowerCase() : "";

      // (A) — names a specific shidduch or reference.
      if (!otherIsColumn) {
        if (ANCHOR_COLUMNS.has(column)) return true;
        if (column === "id") {
          const relation = resolveRef(side, facts);
          if (
            relation &&
            (REFERENCE_RELATIONS.has(relation) ||
              SHIDDUCH_RELATIONS.has(relation))
          ) {
            return true;
          }
        }
        continue;
      }

      // (B) — reached through a non-reference entity.
      if (op !== "=" || !other) continue;
      if (!isReferenceIdentity(side, facts)) continue;
      const otherRelation = resolveRef(other, facts);
      if (otherRelation && !REFERENCE_RELATIONS.has(otherRelation)) return true;
    }
  }
  return false;
}

/**
 * Returns an error message when the statement breaches RULING 7, or null when
 * it is in scope. Called by validateReadOnly / validateWrite so that both MCP
 * tools are covered by construction.
 */
export function findReferenceScopeViolation(
  statements: Statement[],
): string | null {
  const facts = collectFacts(statements);

  for (const target of facts.insertTargets) {
    if (target.name === REFERENCES_TABLE && !facts.calls.has(LINK_RPC)) {
      return CREATE_HINT;
    }
    if (
      target.name === REFERENCE_LINKS_TABLE &&
      !(target.columns ?? []).includes("shidduchim_id")
    ) {
      return LINK_HINT;
    }
  }

  const readsReferences = facts.read.some((relation) =>
    REFERENCE_RELATIONS.has(relation.name),
  );
  if (readsReferences && !hasAnchor(facts)) {
    return SCOPE_HINT;
  }

  return null;
}
