import type { Meta } from "@storybook/react-vite";

import { ContactEdit } from "./ContactEdit";
import { buildContact, StoryWrapper } from "@/test/StoryWrapper";
import type { DataProvider } from "ra-core";

const meta = {
  title: "MyShadchan/Contacts/Contact Edit",
  parameters: {
    layout: "fullscreen",
  },
  globals: {
    viewport: { value: "responsive", isRotated: false },
  },
} satisfies Meta;

export default meta;

// These stories render <ContactEdit resource="contacts" id={1} /> directly
// (rather than routing to "/contacts/1") so they exercise the form in
// isolation, independent of whether "contacts" is registered as a product
// <Resource> in CRM.tsx (it deliberately isn't — see foundation-plan §2).

export const ContactEditBasic = ({
  dataProvider = {},
  silent,
}: {
  dataProvider?: Partial<DataProvider>;
  silent?: boolean;
}) => (
  <StoryWrapper
    data={{
      contacts: [
        buildContact({
          id: 1,
          email_jsonb: [],
          phone_jsonb: [],
        }),
      ],
    }}
    dataProvider={dataProvider}
    silent={silent}
  >
    <ContactEdit resource="contacts" id={1} />
  </StoryWrapper>
);

export const ContactEditWithEmailsAndPhones = ({
  dataProvider = {},
  silent,
}: {
  dataProvider?: Partial<DataProvider>;
  silent?: boolean;
}) => (
  <StoryWrapper
    data={{
      contacts: [
        buildContact({
          id: 1,
          email_jsonb: [{ email: "ada@example.com", type: "Work" }],
          phone_jsonb: [{ number: "0123456789", type: "Work" }],
        }),
      ],
    }}
    dataProvider={dataProvider}
    silent={silent}
  >
    <ContactEdit resource="contacts" id={1} />
  </StoryWrapper>
);

export const ContactEditWithError = () => (
  <StoryWrapper
    data={{
      contacts: [
        buildContact({
          id: 1,
          email_jsonb: [],
          phone_jsonb: [],
        }),
      ],
    }}
    dataProvider={{
      update: async (resource, params) => {
        if (resource === "contacts") {
          throw new Error("Failed to update contact");
        }
        return { data: params.data as any };
      },
    }}
  >
    <ContactEdit resource="contacts" id={1} />
  </StoryWrapper>
);
