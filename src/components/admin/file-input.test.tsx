import { afterEach, describe, expect, it } from "vitest";
import { render } from "vitest-browser-react";
import { page } from "@vitest/browser/context";
import { CoreAdminContext } from "ra-core";

// Real bounding rects — meaningless without the Tailwind-generated stylesheet
// actually applying to the rendered classes.
import "@/index.css";

import { testI18nProvider } from "@/components/atomic-crm/providers/commons/i18nProvider";
import { FileInputPreview } from "./file-input";

/** 44px is the floor the `min-h-11 md:min-h-<desktop>` idiom exists to hold. */
const MIN_TOUCH_TARGET_PX = 44;

const PHONE = { width: 375, height: 720 } as const;

/** What the rest of the browser suite expects going in — restored after every
 * test so none of these depends on another's viewport
 * (.claude/rules/testing.md#Test-isolation). */
const DESKTOP = { width: 1280, height: 720 } as const;

const renderPreview = () =>
  render(
    <CoreAdminContext i18nProvider={testI18nProvider}>
      <FileInputPreview file={{ title: "resume.pdf" }} onRemove={() => {}}>
        <span>resume.pdf</span>
      </FileInputPreview>
    </CoreAdminContext>,
  );

const removeButton = (container: HTMLElement) =>
  container.querySelector('[data-slot="button"]') as HTMLElement;

/**
 * A destructive control sitting immediately beside the file preview it
 * deletes: at 24px it is half a touch target, and the nearest thing to
 * mis-tap is the thing it destroys.
 */
describe("FileInputPreview remove button", () => {
  afterEach(async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height);
  });

  it("is a full touch target on a phone", async () => {
    // Arrange
    await page.viewport(PHONE.width, PHONE.height);

    // Act
    const screen = await renderPreview();
    const rect = removeButton(screen.container).getBoundingClientRect();

    // Assert
    expect(rect.height).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
    expect(rect.width).toBeGreaterThanOrEqual(MIN_TOUCH_TARGET_PX);
  });

  it("stays a small chip from md up", async () => {
    // Arrange — the pair, and the reason the call site carries an explicit
    // `md:min-h-6 md:min-w-6`: the `icon` variant's own 36px desktop floor is
    // a min-width, so it would otherwise beat this button's `h-6 w-6` and
    // inflate a deliberately tiny chip by half again.
    await page.viewport(DESKTOP.width, DESKTOP.height);

    // Act
    const screen = await renderPreview();
    const rect = removeButton(screen.container).getBoundingClientRect();

    // Assert — h-6 / w-6, unchanged.
    expect(rect.height).toBeCloseTo(24, 0);
    expect(rect.width).toBeCloseTo(24, 0);
  });
});
