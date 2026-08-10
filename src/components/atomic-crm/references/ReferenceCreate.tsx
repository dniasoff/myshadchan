import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import type { Identifier } from "ra-core";
import {
  Form,
  useDataProvider,
  useNotify,
  useRedirect,
  useTranslate,
} from "ra-core";
import { Link, useSearchParams } from "react-router";
import type { CrmDataProvider } from "../providers/types";
import type { ReferenceMatchCandidate } from "../types";
import { redirectToRecord } from "../entity360/routeConvention";
import { FormToolbar } from "../layout/FormToolbar";
import { ReferenceInputs } from "./ReferenceInputs";
import { ReferenceMatchPanel } from "./ReferenceMatchPanel";
import { useReferenceMatch } from "./useReferenceMatch";

/**
 * Creating a reference, with match-on-entry wired in (FR20/FR42).
 *
 * As the user types, the shared identity service is asked whether this person is
 * already in the book. If it finds someone, the user gets exactly two choices:
 * link to the existing person, or say it is somebody else and carry on. Nothing
 * is merged, linked or deduplicated without that click.
 *
 * When the create form is opened from inside a shidduch (?shidduchim_id=123),
 * confirming a match links the existing reference to that shidduch and goes
 * straight to their page — which is the moment the user finally sees everything
 * they already know about this person.
 *
 * RULING 7 clause 5 — entry is always from a shidduch. A reference is created
 * only through this shidduch-scoped path, never by browsing a reference list
 * (there is none). Two consequences enforced here:
 *
 *  1. Without a resolvable `?shidduchim_id=`, the form itself is refused
 *     (`RequiresShidduch`) rather than silently allowing an unscoped create.
 *  2. When the "no match" / "different person" branch falls through to a
 *     plain save, `mutationOptions.onSuccess` immediately links the new
 *     reference to that shidduch via the same `link_reference_to_shidduch`
 *     RPC match-on-entry already uses (idempotent, account-checked both
 *     sides). Before this, a bare `<Create>` here let a genuinely new person
 *     be saved with zero `reference_links` — a name-only orphan that
 *     `match_identity` can never recover, because it requires a phone/school
 *     corroborator match_reference_on_entry never gets to see. See
 *     `/tmp/claude-1000/-home-daniel-repos-myshadchan/c6badcce-b0a1-4dd4-a9e3-16d3bfec7653/scratchpad/references-scoping-plan.md`
 *     §2 for the full analysis. The atomic `create_reference_for_shidduch`
 *     RPC the plan proposes (insert + link in one transaction) is a later,
 *     schema-touching wave — this fix is deliberately client-side so it needs
 *     no migration.
 */

const MatchOnEntry = ({ shidduchimId }: { shidduchimId?: Identifier }) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const redirect = useRedirect();
  const translate = useTranslate();
  const { setValue } = useFormContext();
  const [isLinking, setIsLinking] = useState(false);

  const name_en = useWatch({ name: "name_en" });
  const phone = useWatch({ name: "phone" });
  const school = useWatch({ name: "school" });

  const { candidates, dismiss } = useReferenceMatch({
    name_en,
    phone,
    school,
  });

  const handleConfirm = async (candidate: ReferenceMatchCandidate) => {
    setIsLinking(true);
    try {
      if (shidduchimId != null) {
        await dataProvider.linkReferenceToShidduch({
          reference_id: candidate.reference_id,
          shidduchim_id: shidduchimId,
        });
        notify("crm.references.match.linked", {
          type: "success",
          messageArgs: {
            _: "Linked to the person you already know.",
          },
        });
      }
      // Clear the half-typed duplicate so leaving the form prompts nothing, then
      // hand the user the record they actually wanted. `redirectToRecord`, not
      // the bare "show" verb: `useRedirect`'s "show" resolves through
      // `ra-core`'s own `useCreatePath` (always `/{resource}/{id}/show`,
      // independent of the descriptor), which is the same
      // pre-AD-24-migration shape this story's own `buildRecordPath` flip
      // (AC 4) moves away from.
      setValue("name_en", "", { shouldDirty: false });
      setValue("phone", "", { shouldDirty: false });
      redirect(redirectToRecord, "references", candidate.reference_id);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("ra.notification.http_error"),
        { type: "error" },
      );
    } finally {
      setIsLinking(false);
    }
  };

  return (
    <ReferenceMatchPanel
      candidates={candidates}
      onConfirm={handleConfirm}
      onDismiss={dismiss}
      isBusy={isLinking}
    />
  );
};

/**
 * Reads `?shidduchim_id=` off the ROUTER's location, never
 * `window.location.search`.
 *
 * This app runs on `ra-core`'s default `HashRouter`, so the whole route —
 * path AND query string — lives inside `window.location.hash`
 * (`…/#/references/new?shidduchim_id=42`) and `window.location.search` is
 * the empty string. Reading the param off `window.location` therefore
 * resolved `null` for every real user, which combined with the refusal
 * panel below meant the only sanctioned way to add a reference always
 * refused. `useSearchParams` parses the location react-router itself
 * resolved, which is hash-aware, so it works under either router.
 */
function useShidduchimIdParam(): Identifier | undefined {
  const [searchParams] = useSearchParams();
  return parseShidduchimId(searchParams.get("shidduchim_id"));
}

/**
 * Resolves the `?shidduchim_id=` query param to a usable id, or `undefined`
 * for anything that is not a resolvable positive integer — a missing param,
 * `NaN` from garbage input, or a non-positive number. Callers treat
 * `undefined` as "no shidduch named" (Ruling 7 clause 5), whether that is
 * because the param was never set or because it could not possibly identify
 * a real shidduch.
 */
function parseShidduchimId(raw: string | null): Identifier | undefined {
  if (!raw) return undefined;
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Ruling 7 clause 5 — a reference is always created from inside a shidduch.
 * Rendered instead of the form when `/references/new` is opened without a
 * resolvable `shidduchim_id`: a clear refusal beats a silent orphan.
 */
const RequiresShidduch = () => {
  const translate = useTranslate();

  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-2 rounded-lg border border-dashed p-10 text-sm text-muted-foreground"
    >
      <p>
        {translate("crm.references.create.requires_shidduch", {
          _: "A reference can only be created from inside a shidduch.",
        })}
      </p>
      <Link
        to="/shidduchim"
        className="font-medium text-foreground underline underline-offset-4"
      >
        {translate("crm.references.create.requires_shidduch_link", {
          _: "Go to the pipeline",
        })}
      </Link>
    </div>
  );
};

export const ReferenceCreate = () => {
  const shidduchimId = useShidduchimIdParam();

  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const redirect = useRedirect();
  const translate = useTranslate();

  if (shidduchimId == null) {
    return <RequiresShidduch />;
  }

  // RULING 7 R7. This used to be `<Create>` plus an onSuccess that called
  // linkReferenceToShidduch afterwards — two round trips, so a failure between
  // them left a reference attached to no shidduch. One RPC now does both
  // inserts, which is why there is no longer a partial-failure branch to
  // handle: it cannot happen. Shape follows ShidduchCreate.tsx, the existing
  // precedent for an RPC-backed create (`<Create>` cannot replace its own
  // insert, only react after it).
  const onSubmit = async (values: Record<string, unknown>) => {
    try {
      const reference = await dataProvider.createReferenceForShidduch({
        shidduchim_id: shidduchimId,
        name_en: (values.name_en as string | undefined) ?? null,
        relationship: (values.relationship as string | undefined) ?? null,
        phone: (values.phone as string | undefined) ?? null,
        school: (values.school as string | undefined) ?? null,
        grad_year: (values.grad_year as number | undefined) ?? null,
      });
      notify("crm.references.create.linked", {
        type: "success",
        messageArgs: {
          _: "Reference saved and linked to this shidduch.",
        },
      });
      redirect(redirectToRecord, "references", reference.id, reference);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : translate("ra.notification.http_error"),
        { type: "error" },
      );
    }
  };

  return (
    <Form onSubmit={onSubmit} mode="onBlur">
      <ReferenceInputs />
      <MatchOnEntry shidduchimId={shidduchimId} />
      <FormToolbar />
    </Form>
  );
};
