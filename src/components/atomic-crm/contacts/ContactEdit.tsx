import { Card, CardContent } from "@/components/ui/card";
import {
  EditBase,
  Form,
  useEditContext,
  type Identifier,
  type MutationMode,
} from "ra-core";

import type { Contact } from "../types";
import { ContactAside } from "./ContactAside";
import { ContactInputs } from "./ContactInputs";
import { FormToolbar } from "../layout/FormToolbar";
import {
  cleanupContactForEdit,
  defaultEmailJsonb,
  defaultPhoneJsonb,
} from "./contactModel";

export interface ContactEditProps {
  mutationMode?: MutationMode;
  /** Overrides the route-derived record id (used by isolated tests/stories). */
  id?: Identifier;
  /** Overrides the ambient resource context (used by isolated tests/stories). */
  resource?: string;
}

export const ContactEdit = ({ mutationMode, id, resource }: ContactEditProps) => (
  <EditBase
    redirect="show"
    transform={cleanupContactForEdit}
    mutationMode={mutationMode}
    id={id}
    resource={resource}
  >
    <ContactEditContent />
  </EditBase>
);

const normalizeContactArrayFields = (record: Contact) => ({
  ...record,
  email_jsonb:
    record.email_jsonb && record.email_jsonb.length > 0
      ? record.email_jsonb
      : defaultEmailJsonb,
  phone_jsonb:
    record.phone_jsonb && record.phone_jsonb.length > 0
      ? record.phone_jsonb
      : defaultPhoneJsonb,
});

const ContactEditContent = () => {
  const { isPending, record } = useEditContext<Contact>();
  if (isPending || !record) return null;
  return (
    <div className="mt-2 flex gap-8">
      <Form
        className="flex flex-1 flex-col gap-4"
        record={normalizeContactArrayFields(record)}
      >
        <Card>
          <CardContent>
            <ContactInputs />
            <FormToolbar />
          </CardContent>
        </Card>
      </Form>

      <ContactAside link="show" />
    </div>
  );
};
