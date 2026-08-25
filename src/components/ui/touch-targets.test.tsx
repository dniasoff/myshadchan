import { afterEach, describe, expect, it } from "vitest"
import { render } from "vitest-browser-react"
import { page } from "@vitest/browser/context"

// A touch target is a geometry claim, not a class-name claim: these tests read
// real bounding rects and run a real hit test, which is meaningless without
// the Tailwind-generated stylesheet actually applying to the rendered classes.
import "@/index.css"

import { Button } from "./button"
import { Switch } from "./switch"

/** 44px is the floor the `min-h-11 md:min-h-<desktop>` idiom exists to hold. */
const MIN_TOUCH_TARGET_PX = 44

const PHONE = { width: 375, height: 720 } as const

/** What the rest of the browser suite expects going in — restored after every
 * test so none of these depends on another's viewport
 * (.claude/rules/testing.md#Test-isolation). */
const DESKTOP = { width: 1280, height: 720 } as const

const compactButtons = (
  <div>
    <Button size="sm" data-role="sm-button">
      Revoke
    </Button>
    <Button size="icon" aria-label="Copy" data-role="icon-button">
      C
    </Button>
  </div>
)

describe("compact button sizes", () => {
  afterEach(async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
  })

  it("gives the sm and icon variants a 44px floor on a phone", async () => {
    // Arrange — these are the variants Settings row actions and the share
    // dialog are built from; before the floor they were 32px and 36px, while
    // the `default` variant next to them already honoured 44px.
    await page.viewport(PHONE.width, PHONE.height)

    // Act
    const screen = await render(compactButtons)
    const small = screen.container.querySelector(
      '[data-role="sm-button"]'
    ) as HTMLElement
    const icon = screen.container.querySelector(
      '[data-role="icon-button"]'
    ) as HTMLElement

    // Assert
    expect(small.getBoundingClientRect().height).toBeGreaterThanOrEqual(
      MIN_TOUCH_TARGET_PX
    )
    expect(icon.getBoundingClientRect().height).toBeGreaterThanOrEqual(
      MIN_TOUCH_TARGET_PX
    )
    expect(icon.getBoundingClientRect().width).toBeGreaterThanOrEqual(
      MIN_TOUCH_TARGET_PX
    )
  })

  it("keeps the original compact density from md up", async () => {
    // Arrange — the floor is a mobile affordance, not a redesign: a desktop
    // toolbar of 44px "sm" buttons would be the same defect in the other
    // direction, so this pins that the `md:` half of the idiom still wins.
    await page.viewport(DESKTOP.width, DESKTOP.height)

    // Act
    const screen = await render(compactButtons)
    const small = screen.container.querySelector(
      '[data-role="sm-button"]'
    ) as HTMLElement
    const icon = screen.container.querySelector(
      '[data-role="icon-button"]'
    ) as HTMLElement

    // Assert — h-8 (32px) and size-9 (36px), unchanged.
    expect(small.getBoundingClientRect().height).toBeCloseTo(32, 0)
    expect(icon.getBoundingClientRect().height).toBeCloseTo(36, 0)
    expect(icon.getBoundingClientRect().width).toBeCloseTo(36, 0)
  })
})

describe("Switch touch target", () => {
  afterEach(async () => {
    await page.viewport(DESKTOP.width, DESKTOP.height)
  })

  it("accepts a tap well above the pill, where a finger actually lands", async () => {
    // Arrange — the padding keeps the extension inside the viewport, so a miss
    // here is the switch's geometry and not a clipped coordinate.
    await page.viewport(PHONE.width, PHONE.height)
    const screen = await render(
      <div style={{ padding: 40 }}>
        <Switch
          aria-label="Require click to reveal photos"
          data-role="switch"
        />
      </div>
    )
    const control = screen.container.querySelector(
      '[data-role="switch"]'
    ) as HTMLElement
    const rect = control.getBoundingClientRect()

    // Act — 20px above the pill's centre: outside the 18.4px pill, inside the
    // transparent `::before` extension. Hit-testing resolves a pseudo-element
    // to its originating element, so this must come back as the switch.
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2 - 20
    )

    // Assert
    expect(control.contains(hit)).toBe(true)
  })

  it("leaves the pill itself the size it has always been", async () => {
    // Arrange — the pair that makes the test above evidence: a `min-h-11` on
    // the root would also pass a hit test, while stretching the pill and
    // breaking the thumb's `translate-x-[calc(100%-2px)]` geometry.
    await page.viewport(PHONE.width, PHONE.height)

    // Act
    const screen = await render(
      <Switch aria-label="Include photo" data-role="switch" />
    )
    const control = screen.container.querySelector(
      '[data-role="switch"]'
    ) as HTMLElement

    // Assert — h-[1.15rem] / w-8.
    expect(control.getBoundingClientRect().height).toBeCloseTo(18.4, 0)
    expect(control.getBoundingClientRect().width).toBeCloseTo(32, 0)
  })

  it("drops the halo from md up, where a mouse does not need it", async () => {
    // Arrange — an invisible 14px halo that outlives the phone would sit over
    // whatever is beside the pill in a dense desktop settings row.
    await page.viewport(DESKTOP.width, DESKTOP.height)
    const screen = await render(
      <div style={{ padding: 40 }}>
        <Switch aria-label="Include photo" data-role="switch" />
      </div>
    )
    const control = screen.container.querySelector(
      '[data-role="switch"]'
    ) as HTMLElement
    const rect = control.getBoundingClientRect()

    // Act — the same point that must hit on a phone.
    const hit = document.elementFromPoint(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2 - 20
    )

    // Assert
    expect(control.contains(hit)).toBe(false)
  })
})
