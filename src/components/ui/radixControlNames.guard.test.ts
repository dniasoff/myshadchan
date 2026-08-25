import { describe, expect, it } from "vitest";

/**
 * Every Radix `Checkbox` / `RadioGroupItem` / `Switch` must carry its own
 * accessible name.
 *
 * This is not a style preference — it is a trap that already caught this
 * codebase everywhere at once. All three primitives render a plain
 * `<button role="…">`, and `<label htmlFor>` / a wrapping `<Label>` associate
 * with FORM CONTROLS ONLY: they do not name a button. So the idiomatic,
 * correct-looking pattern
 *
 *     <Checkbox id={x} />
 *     <Label htmlFor={x}>Mark done</Label>
 *
 * produces a control whose accessible name is the empty string. Measured in a
 * real browser across the app, every checkbox and radio announced as
 * "checkbox, unchecked" with no indication of what it toggled — while the
 * markup read as though it were labelled.
 *
 * Reading the source cannot catch that; only resolving the name can. This
 * guard is the cheap standing substitute: it fails the moment one of these
 * three primitives is used without `aria-label` or `aria-labelledby`.
 *
 * ONE WARNING THIS GUARD CANNOT ENFORCE, and it bit while fixing the above:
 * `aria-label` OVERRIDES the visible label rather than adding to it. Giving a
 * control a name that is not the words next to it breaks WCAG 2.5.3 (Label in
 * Name) — a voice-control user saying what they can see no longer reaches it —
 * and desynchronises the announcement from what the person is agreeing to. The
 * 18+ affirmation checkbox in `login/ConfirmNewAccount.tsx` was given
 * "I am 18 or older" while the sentence on screen read "I confirm that I am 18
 * years of age or older."; its own test caught it. So:
 *
 * - a visible `<Label>` exists  -> `aria-labelledby` pointing at it, which
 *   makes the name literally the visible text and cannot drift;
 * - a string label is in hand   -> `aria-label` with the SAME translate key
 *   AND the same `_` fallback the visible text uses;
 * - no visible label at all     -> `aria-label` is the only option (a table's
 *   select-all box, an icon-only clear button).
 *
 * `?raw` + `import.meta.glob` is the same idiom as
 * `entity360/tabs/FilesTab.guard.test.ts` and its neighbours.
 */
const sources = import.meta.glob("../**/*.tsx", {
  query: "?raw",
  import: "default",
  eager: true,
}) as Record<string, string>;

/** Primitives that render as a `<button role="…">` and therefore need a name. */
const NAMED_PRIMITIVES = ["Checkbox", "RadioGroupItem", "Switch"];

/**
 * Every `<Primitive ... />` or `<Primitive ... >` occurrence, with its full
 * attribute text — so an `aria-label` on any line of a multi-line element is
 * seen. Deliberately literal: this checks JSX source, not a rendered tree.
 */
function usagesOf(source: string, primitive: string): string[] {
  const usages: string[] = [];
  const opener = new RegExp(`<${primitive}(\\s|>|/)`, "g");
  let match: RegExpExecArray | null;
  while ((match = opener.exec(source)) !== null) {
    // Walk to the end of the opening tag, ignoring `>` inside braces/strings.
    let depth = 0;
    let index = match.index + primitive.length + 1;
    for (; index < source.length; index++) {
      const character = source[index];
      if (character === "{") depth++;
      else if (character === "}") depth--;
      else if (character === ">" && depth === 0) break;
    }
    usages.push(source.slice(match.index, index + 1));
  }
  return usages;
}

const isNamed = (usage: string) =>
  usage.includes("aria-label") || usage.includes("aria-labelledby");

describe("Radix controls that render as a button carry their own name", () => {
  it("finds source files to scan, so an empty glob cannot pass vacuously", () => {
    // Arrange / Act / Assert — the failure mode this whole file would
    // otherwise have.
    expect(Object.keys(sources).length).toBeGreaterThan(100);
  });

  it.each(NAMED_PRIMITIVES)("names every <%s>", (primitive) => {
    // Arrange / Act
    const unnamed: string[] = [];
    for (const [path, source] of Object.entries(sources)) {
      if (path.includes(".test.")) continue;
      // The primitive's own definition file declares it, never uses it.
      if (path.endsWith(`/${primitive.toLowerCase()}.tsx`)) continue;
      for (const usage of usagesOf(source, primitive)) {
        // A re-export or a type position, not a rendered element.
        if (!usage.includes("\n") && usage.length < 12) continue;
        if (!isNamed(usage)) unnamed.push(`${path}: ${usage.slice(0, 90)}`);
      }
    }

    // Assert
    expect(unnamed).toEqual([]);
  });

  it("actually finds usages, so the assertions above are not vacuous", () => {
    // Arrange / Act — the mirror: the checks above would also pass if the
    // primitives had simply stopped being used anywhere.
    const counts = NAMED_PRIMITIVES.map((primitive) =>
      Object.values(sources).reduce(
        (total, source) => total + usagesOf(source, primitive).length,
        0,
      ),
    );

    // Assert
    for (const count of counts) expect(count).toBeGreaterThan(0);
  });
});
