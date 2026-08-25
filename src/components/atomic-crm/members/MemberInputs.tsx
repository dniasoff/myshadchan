import { email, required, useGetIdentity, useRecordContext } from "ra-core";
import { BooleanInput } from "@/components/admin/boolean-input";
import { TextInput } from "@/components/admin/text-input";

import type { Member } from "../types";

export function MemberInputs() {
  const { identity } = useGetIdentity();
  const record = useRecordContext<Member>();
  return (
    <div className="space-y-4 w-full">
      <TextInput source="first_name" validate={required()} helperText={false} />
      <TextInput source="last_name" validate={required()} helperText={false} />
      {/* `type="email"` is not cosmetic on a phone: without it this falls
          through to a plain text input, so the keyboard has no "@" or
          ".com" key and no email autofill hint — on the one field in this
          form most likely to be mistyped. `TextInput` spreads its rest
          props onto the underlying `<Input>` (admin/text-input.tsx). */}
      <TextInput
        source="email"
        type="email"
        inputMode="email"
        autoComplete="email"
        validate={[required(), email()]}
        helperText={false}
      />
      <BooleanInput
        source="administrator"
        readOnly={record?.id === identity?.id}
        helperText={false}
      />
      <BooleanInput
        source="disabled"
        readOnly={record?.id === identity?.id}
        helperText={false}
      />
    </div>
  );
}
