import type { Meta } from "@storybook/react-vite";

import { ContactCreate } from "./ContactCreate";
import { buildContact, StoryWrapper } from "@/test/StoryWrapper";
import type { DataProvider } from "ra-core";

const meta = {
  title: "MyShadchan/Contacts/Contact Create",
  parameters: {
    layout: "fullscreen",
  },
  globals: {
    viewport: { value: "responsive", isRotated: false },
  },
} satisfies Meta;

export default meta;

// Renders <ContactCreate resource="contacts" /> directly (rather than routing
// to "/contacts/create") so it exercises the form in isolation, independent
// of whether "contacts" is registered as a product <Resource> in CRM.tsx (it
// deliberately isn't — see foundation-plan §2).

export const ContactCreateBasic = ({
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
      ] as any,
    }}
    dataProvider={dataProvider}
    silent={silent}
  >
    <ContactCreate resource="contacts" />
  </StoryWrapper>
);

export const ContactCreateBasicWithError = () => (
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
      create: async (resource, params) => {
        if (resource === "contacts") {
          throw new Error("Failed to create contact");
        }
        return { data: params.data as any };
      },
    }}
  >
    <ContactCreate resource="contacts" />
  </StoryWrapper>
);
