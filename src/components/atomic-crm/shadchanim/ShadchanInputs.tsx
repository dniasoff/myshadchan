import type { ReactNode } from "react";
import { required } from "ra-core";

import { TextInput } from "@/components/admin/text-input";

import { ResponsivenessInput } from "./ResponsivenessInput";

const SectionLabel = ({ children }: { children: ReactNode }) => (
  <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
    {children}
  </p>
);

/**
 * Form inputs for a shadchan (matchmaker), chunked into calm labelled
 * sections (design-language typography scale §2). account_id is set
 * server-side by a trigger — never a form input.
 */
export const ShadchanInputs = () => (
  <>
    <div className="flex flex-col gap-3">
      <SectionLabel>Name</SectionLabel>
      <TextInput
        source="name"
        label="Name"
        validate={required()}
        helperText={false}
      />
    </div>

    <div className="flex flex-col gap-3">
      <SectionLabel>Details</SectionLabel>
      <TextInput source="location" helperText={false} />
      <ResponsivenessInput source="responsiveness" label="Responsiveness" />
      <TextInput source="notes" multiline rows={3} helperText={false} />
    </div>
  </>
);
