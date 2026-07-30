import { render } from "vitest-browser-react";
import { TestMemoryRouter } from "ra-core";

// Side-effect imports — register the entity descriptors ReminderCard's
// RecordLink resolves against, exactly as each `<entity>/index.ts` does at
// boot.
import "../shadchanim/entityDescriptor";
import "../shidduchim/entityDescriptor";
import type { Task } from "../types";
import { ReminderCard } from "./ReminderCard";
import type { ReminderItem } from "./useReminders";

/**
 * AC 5 item 2: `ReminderCard` renders `RecordLink` from
 * `RESOURCE_FOR_TARGET[linkedEntity.type]`, no longer a precomputed `to`
 * string. The shadchan case is the one that is RED on today's pre-fix code
 * (today's retired hand-rolled path builder returns `/shadchanim/{id}` with
 * no `/show`, silently landing on the EDIT page since
 * `shadchanim/index.ts` registers `show: ShadchanShow`) — this test pins
 * the fix.
 */

const buildTask = (overrides: Partial<Task> = {}): Task => ({
  id: 1,
  type: "reminder",
  text: "Call about the redt from last week",
  due_date: "2099-01-01T00:00:00Z",
  ...overrides,
});

const renderCard = async (item: ReminderItem) =>
  render(
    <TestMemoryRouter>
      <ul>
        <ReminderCard item={item} onComplete={() => {}} onSnooze={() => {}} />
      </ul>
    </TestMemoryRouter>,
  );

describe("ReminderCard — linked entity renders through RecordLink (AC 5)", () => {
  it("links a shadchan-targeted reminder to the shadchan's /show route, not its edit page", async () => {
    // Arrange
    const item: ReminderItem = {
      task: buildTask({ target_type: "shadchan", target_id: 9 }),
      linkedEntity: { type: "shadchan", id: 9, label: "Malka Klein" },
    };

    // Act
    const screen = await renderCard(item);

    // Assert — RED on today's pre-fix code: the retired path builder
    // returned /shadchanim/9 (no /show), landing on ShadchanEdit instead.
    await expect
      .element(screen.getByRole("link", { name: "Malka Klein" }))
      .toHaveAttribute("href", "/shadchanim/9/show");
  });

  it("links a shidduch-targeted reminder to the shidduch's AD-24 record route (Story 5.1)", async () => {
    // Arrange
    const item: ReminderItem = {
      task: buildTask({ target_type: "shidduch", target_id: 42 }),
      linkedEntity: { type: "shidduch", id: 42, label: "Chaim Cohen" },
    };

    // Act
    const screen = await renderCard(item);

    // Assert — Story 5.1 flipped shidduchim's buildRecordPath to the bare
    // AD-24 shape; this pin follows it in the same diff.
    await expect
      .element(screen.getByRole("link", { name: "Chaim Cohen" }))
      .toHaveAttribute("href", "/shidduchim/42");
  });

  it("renders no link when the task has no linked entity", async () => {
    // Arrange
    const item: ReminderItem = {
      task: buildTask(),
      linkedEntity: null,
    };

    // Act
    const screen = await renderCard(item);

    // Assert
    await expect.element(screen.getByRole("link")).not.toBeInTheDocument();
    await expect
      .element(screen.getByText("Call about the redt from last week"))
      .toBeInTheDocument();
  });
});
