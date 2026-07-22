import type { Meta } from "@storybook/react-vite";

import { ContactShow } from "./ContactShow";
import { buildContact, StoryWrapper } from "@/test/StoryWrapper";
import type { DataProvider } from "ra-core";

const meta = {
  title: "MyShadchan/Contacts/Contact Edit Mobile",
  parameters: {
    layout: "fullscreen",
  },
  globals: {
    viewport: { value: "mobile1", isRotated: false },
  },
} satisfies Meta;

export default meta;

// The mobile edit flow is: ContactShow renders an "Edit" button that opens
// ContactEditSheet, which threads resource/id in as explicit props (not
// route params) — so rendering <ContactShow resource="contacts" id={1} />
// directly exercises the real flow, independent of whether "contacts" is
// registered as a product <Resource> in CRM.tsx (it deliberately isn't —
// see foundation-plan §2).

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
    <ContactShow resource="contacts" id={1} />
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
    <ContactShow resource="contacts" id={1} />
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
      ] as any,
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
    <ContactShow resource="contacts" id={1} />
  </StoryWrapper>
);

export const ContactEditNotFound = () => (
  <StoryWrapper>
    <ContactShow resource="contacts" id={1} />
  </StoryWrapper>
);
