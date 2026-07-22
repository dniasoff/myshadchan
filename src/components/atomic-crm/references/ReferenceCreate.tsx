import { useState } from "react";
import { useFormContext, useWatch } from "react-hook-form";
import type { Identifier } from "ra-core";
import { useDataProvider, useNotify, useRedirect, useTranslate } from "ra-core";
import { Create } from "@/components/admin/create";
import { SimpleForm } from "@/components/admin/simple-form";
import type { CrmDataProvider } from "../providers/types";
import type { ReferenceMatchCandidate } from "../types";
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
 */

const MatchOnEntry = ({ shidduchimId }: { shidduchimId?: Identifier }) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const redirect = useRedirect();
  const translate = useTranslate();
  const { setValue } = useFormContext();
  const [isLinking, setIsLinking] = useState(false);

  const name_en = useWatch({ name: "name_en" });
  const name_he = useWatch({ name: "name_he" });
  const phone = useWatch({ name: "phone" });
  const school = useWatch({ name: "school" });

  const { candidates, dismiss } = useReferenceMatch({
    name_en,
    name_he,
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
      // hand the user the record they actually wanted.
      setValue("name_en", "", { shouldDirty: false });
      setValue("name_he", "", { shouldDirty: false });
      setValue("phone", "", { shouldDirty: false });
      redirect("show", "references", candidate.reference_id);
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

export const ReferenceCreate = () => {
  const shidduchimIdParam = new URLSearchParams(window.location.search).get(
    "shidduchim_id",
  );
  const shidduchimId = shidduchimIdParam
    ? Number(shidduchimIdParam)
    : undefined;

  return (
    <Create redirect="show">
      <SimpleForm>
        <ReferenceInputs />
        <MatchOnEntry shidduchimId={shidduchimId} />
      </SimpleForm>
    </Create>
  );
};
