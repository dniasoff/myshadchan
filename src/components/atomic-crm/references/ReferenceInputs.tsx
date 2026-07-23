import { useTranslate } from "ra-core";
import { TextInput } from "@/components/admin/text-input";
import { NumberInput } from "@/components/admin/number-input";

/**
 * Form inputs for a reference. account_id and the *_norm match keys are set
 * server-side by triggers (AD-1/AD-5) and are never form inputs — the SPA does
 * not normalize and does not choose a tenant.
 *
 * Both name scripts are first-class (AD-12): a reference entered in Hebrew must
 * be as findable as one entered in English. Chunked into calm QL sections
 * (design-language §2) — visual grouping only, field `source`s are unchanged.
 *
 * Section headers and labels go through translate() with English `_`
 * fallbacks, matching ReferenceList/ReferenceShow/ReferenceCallLog.
 */
export const ReferenceInputs = () => {
  const translate = useTranslate();

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4">
        <h3 className="font-display text-sm font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {translate("crm.references.form.whoHeading", { _: "Who" })}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            source="name_en"
            label={translate("crm.references.form.nameEn", {
              _: "Name (EN)",
            })}
            helperText={false}
          />
          <TextInput
            source="name_he"
            label={translate("crm.references.form.nameHe", {
              _: "Name (HE)",
            })}
            helperText={false}
            dir="rtl"
            inputClassName="font-hebrew"
          />
        </div>
        <TextInput
          source="relationship"
          label={translate("crm.references.form.relationship", {
            _: "Relationship",
          })}
          helperText={translate("crm.references.form.relationshipHelper", {
            _: "How they know the single - teacher, neighbour, family friend...",
          })}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h3 className="font-display text-sm font-semibold uppercase tracking-[0.06em] text-muted-foreground">
          {translate("crm.references.form.detailsHeading", {
            _: "Details",
          })}
        </h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <TextInput
            source="phone"
            label={translate("crm.references.form.phone", { _: "Phone" })}
            helperText={false}
          />
          <TextInput
            source="school"
            label={translate("crm.references.form.school", { _: "School" })}
            helperText={false}
          />
        </div>
        <NumberInput
          source="grad_year"
          label={translate("crm.references.form.gradYear", {
            _: "Graduation year",
          })}
          helperText={false}
        />
      </section>
    </div>
  );
};
