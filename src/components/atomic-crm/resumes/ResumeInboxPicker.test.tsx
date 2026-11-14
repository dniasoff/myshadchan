import { describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { QueryClient } from "@tanstack/react-query";
import { CoreAdminContext, TestMemoryRouter } from "ra-core";

import { Notification } from "@/components/admin/notification";

import { testI18nProvider } from "../providers/commons/i18nProvider";
import { createDataProvider } from "../providers/fakerest/dataProvider";
import generateData from "../providers/fakerest/dataGenerator";
import type { MyContext, Resume } from "../types";
import { ResumeInboxPicker } from "./ResumeInboxPicker";
import { canPickResumeFromInbox } from "./resumeInbox";

const EMPTY_COPY =
  "No resumes are waiting in your Inbox. On Android you can share a resume from WhatsApp, Messages or email to MyShadChan and it will appear here. On iPhone, save the file to your phone and use Attach resume.";

function makeDb() {
  const db = generateData();
  const target = db.shidduchim[0];
  if (!target) throw new Error("fixture has no shidduch");
  db.inbox_items = [
    {
      id: 44,
      account_id: target.account_id,
      created_at: "2026-11-14T10:00:00.000Z",
      source: "whatsapp",
      sender: "Rivky's aunt",
      sender_needs_confirmation: false,
      raw_text: "private message text must not be shown",
      attachments: [
        {
          title: "resume.pdf",
          type: "application/pdf",
          path: "1/inbox/44/resume.pdf",
          src: "data:application/pdf;base64,cmVzdW1l",
        },
        {
          title: "notes.txt",
          type: "text/plain",
          path: "1/inbox/44/notes.txt",
          src: "data:text/plain;base64,bm90ZXM=",
        },
      ],
      status: "unresolved",
    },
    {
      id: 45,
      account_id: target.account_id,
      created_at: "2026-11-14T09:00:00.000Z",
      source: "email",
      sender: "Held sender",
      sender_needs_confirmation: false,
      attachments: [
        {
          title: "held.pdf",
          type: "application/pdf",
          path: "1/inbox/45/held.pdf",
          src: "data:application/pdf;base64,aGVsZA==",
        },
      ],
      status: "held",
    },
  ];
  db.resumes = [];
  return { db, target };
}

async function renderPicker(withExisting = false) {
  const { db, target } = makeDb();
  if (withExisting) {
    db.resumes = [
      {
        id: 900,
        account_id: target.account_id,
        shidduchim_id: target.id,
        files: [
          {
            path: "1/resumes/1/inbox-existing.pdf",
            filename: "old.pdf",
            uploaded_at: "2026-11-14T11:00:00.000Z",
            uploaded_by: 7,
            mime_type: "application/pdf",
            size: 10,
            source_inbox_item_id: 44,
            source_inbox_attachment_path: "1/inbox/44/resume.pdf",
          },
        ],
        created_at: "2026-11-14T11:00:00.000Z",
      } satisfies Resume,
    ];
  }
  const dataProvider = createDataProvider({ db, latency: 0, silent: true });
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: Infinity } },
  });
  queryClient.setQueryData(
    ["myContexts"],
    [
      {
        account_id: target.account_id,
        kind: "household",
        name: "Fixture account",
        role: "parent_admin",
        is_active: true,
      } satisfies MyContext,
    ],
  );
  const screen = await render(
    <TestMemoryRouter>
      <CoreAdminContext
        dataProvider={dataProvider}
        queryClient={queryClient}
        i18nProvider={testI18nProvider}
      >
        <ResumeInboxPicker shidduchimId={target.id} targetLabel="David Levi" />
        <Notification />
      </CoreAdminContext>
    </TestMemoryRouter>,
  );
  return { db, target, dataProvider, screen };
}

describe("ResumeInboxPicker", () => {
  it.each([
    ["single", false, false],
    [undefined, false, false],
    ["parent_admin", true, false],
    ["helper", false, true],
  ] as const)("role gate for %s pending=%s", (role, pending, expected) => {
    expect(canPickResumeFromInbox(role, pending)).toBe(expected);
  });

  it("shows one row per eligible attachment and attaches one copy while retaining the Inbox source", async () => {
    const { db, target, dataProvider, screen } = await renderPicker();

    await screen
      .getByRole("button", {
        name: "Pick a resume from your Inbox",
        exact: true,
      })
      .first()
      .click();
    await expect
      .element(screen.getByText("resume.pdf").first())
      .toBeInTheDocument();
    await expect.element(screen.getByText("held.pdf")).not.toBeInTheDocument();
    await expect.element(screen.getByText("notes.txt")).not.toBeInTheDocument();
    await expect
      .element(screen.getByText("private message text must not be shown"))
      .not.toBeInTheDocument();

    await screen.getByText("resume.pdf").first().click();
    await expect
      .element(screen.getByText("Attach this file to David Levi's resume?"))
      .toBeInTheDocument();
    await screen
      .getByRole("button", { name: "Attach", exact: true })
      .first()
      .click();

    await expect
      .element(
        screen.getByText(
          "Resume attached. It is now a new version. The file is still in your Inbox.",
        ),
      )
      .toBeInTheDocument();
    expect(db.inbox_items[0].status).toBe("unresolved");
    expect(db.inbox_items[0].attachments).toHaveLength(2);
    const { data: resumes } = await dataProvider.getList<Resume>("resumes", {
      filter: { shidduchim_id: target.id },
      pagination: { page: 1, perPage: 1 },
      sort: { field: "id", order: "ASC" },
    });
    expect(resumes[0]?.files).toHaveLength(1);
    expect(resumes[0]?.files?.[0].source_inbox_item_id).toBe(44);
    expect(resumes[0]?.files?.[0].source_inbox_attachment_path).toBe(
      "1/inbox/44/resume.pdf",
    );
    expect(target.id).toBe(resumes[0]?.shidduchim_id);
  });

  it("shows an already-attached source state", async () => {
    const { screen: existingScreen } = await renderPicker(true);
    await existingScreen
      .getByRole("button", {
        name: "Pick a resume from your Inbox",
        exact: true,
      })
      .first()
      .click();
    await expect
      .element(
        existingScreen.getByText("Already attached", { exact: true }).first(),
      )
      .toBeInTheDocument();
    await expect
      .element(
        existingScreen
          .getByText("This file is already attached to David Levi's resume.")
          .first(),
      )
      .toBeInTheDocument();
    await existingScreen
      .getByRole("button", { name: "Close", exact: true })
      .first()
      .click();
  });

  it("shows the exact empty state", async () => {
    const { db } = makeDb();
    db.inbox_items = [];
    const dataProvider = createDataProvider({ db, latency: 0, silent: true });
    const queryClient = new QueryClient();
    const emptyScreen = await render(
      <TestMemoryRouter>
        <CoreAdminContext
          dataProvider={dataProvider}
          queryClient={queryClient}
          i18nProvider={testI18nProvider}
        >
          <ResumeInboxPicker
            shidduchimId={db.shidduchim[0].id}
            targetLabel="David Levi"
          />
        </CoreAdminContext>
      </TestMemoryRouter>,
    );
    await emptyScreen
      .getByRole("button", {
        name: "Pick a resume from your Inbox",
        exact: true,
      })
      .first()
      .click();
    await expect
      .element(emptyScreen.getByText(EMPTY_COPY).first())
      .toBeInTheDocument();
  });
});
