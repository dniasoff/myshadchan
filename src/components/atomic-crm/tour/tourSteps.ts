import type { DriveStep } from "driver.js";

export interface TourStepsOptions {
  /** Navigates to the pipeline board route (fired once, from the last dashboard step). */
  navigateToBoard: () => void;
  /** Skips the settle delay before highlighting the board when true. */
  prefersReducedMotion: boolean;
  /**
   * `MobileLayout` renders no `TopBar` (no child-switcher pill), and
   * References/Reminders/Settings live inside the closed "More" dropdown of
   * `MobileNavigation` rather than as standalone nav items — so those
   * anchors don't exist in the DOM until opened. On mobile we drop the
   * child-switcher step and collapse the three individual nav steps into
   * one step anchored to the "More" button instead of leaving dead,
   * unhighlighted popovers.
   */
  isMobile: boolean;
}

/** Desktop only: References and Reminders each get their own sidebar step. */
const desktopNavSteps: DriveStep[] = [
  {
    element: '[data-tour="nav-references"]',
    popover: {
      title: "References",
      description:
        "The people you call to check into a suggestion — with every call logged in one place.",
      side: "right",
      align: "start",
    },
  },
  {
    element: '[data-tour="nav-reminders"]',
    popover: {
      title: "Reminders",
      description:
        "Follow-ups and calls you don't want to forget, so nothing slips.",
      side: "right",
      align: "start",
    },
  },
];

/**
 * Mobile only: References, Reminders and Settings are collapsed into the
 * bottom nav's "More" button (`MobileNavigation`) rather than shown
 * individually, so one step introduces all three at once.
 */
const mobileMoreStep: DriveStep = {
  element: '[data-tour="nav-more"]',
  popover: {
    title: "More",
    description:
      "References, Reminders and Settings live here — tap More to reach them.",
    side: "top",
    align: "end",
  },
};

/** Desktop only: the `TopBar` child-switcher pill doesn't exist on mobile. */
const desktopChildSwitcherStep: DriveStep = {
  element: '[data-tour="child-switcher"]',
  popover: {
    title: "Switch between children",
    description:
      "Redting for more than one child? Switch here — every screen updates to the child you pick.",
    side: "bottom",
    align: "start",
  },
};

/**
 * The auto-tour, in order (demo-onboarding-plan.md §B4). Plain, warm copy —
 * the audience is a parent, not a developer. Steps 1-8 live on the
 * dashboard; step 9 crosses over to `/shidduchim` (the only navigation in
 * the tour, driven by step 8's `onNextClick`); steps 9-12 live on the board;
 * step 13 returns attention to the always-present demo banner. On mobile,
 * the References/Reminders/Settings/child-switcher steps are adapted — see
 * `TourStepsOptions.isMobile`.
 */
export const buildTourSteps = ({
  navigateToBoard,
  prefersReducedMotion,
  isMobile,
}: TourStepsOptions): DriveStep[] => [
  {
    element: '[data-tour="demo-banner"]',
    popover: {
      title: "You're exploring a sample family",
      description:
        "Everything you see is realistic demo data — nothing here is real. This tour shows you around; you can clear the sample anytime from this banner.",
      side: "bottom",
      align: "start",
    },
  },
  {
    element: '[data-tour="nav-dashboard"]',
    popover: {
      title: "Your dashboard",
      description:
        "Your calm home base — a snapshot of where every child's shidduchim stand, and what needs your attention.",
      side: "right",
      align: "start",
    },
  },
  {
    element: '[data-tour="nav-pipeline"]',
    popover: {
      title: "The pipeline",
      description:
        "Every suggestion for a child, organized from a new redt all the way to a decision.",
      side: "right",
      align: "start",
    },
  },
  {
    element: '[data-tour="nav-shadchanim"]',
    popover: {
      title: "Shadchanim",
      description:
        "Everyone redting for your family, and how responsive each one has been.",
      side: "right",
      align: "start",
    },
  },
  ...(isMobile ? [mobileMoreStep] : desktopNavSteps),
  ...(isMobile ? [] : [desktopChildSwitcherStep]),
  {
    element: '[data-tour="pipeline-snapshot"]',
    popover: {
      title: "Where things stand",
      description:
        "One glance shows how this child's suggestions are spread across the pipeline.",
      side: "top",
      align: "start",
      // The only cross-route step: navigate to the board, then advance once
      // it has had a moment to mount (skipped when reduced-motion is set).
      onNextClick: (_element, _step, { driver }) => {
        navigateToBoard();
        const settle = prefersReducedMotion ? 0 : 350;
        requestAnimationFrame(() => {
          setTimeout(() => driver.moveNext(), settle);
        });
      },
    },
  },
  {
    element: '[data-tour="pipeline-board"]',
    popover: {
      title: "The board",
      description:
        "Each column is a stage. Drag a card from one column to the next to move a suggestion along — that's how you record a decision.",
      side: "top",
      align: "start",
    },
  },
  {
    element: '[data-tour="pipeline-column"]',
    popover: {
      title: "A stage",
      description:
        "This column holds every suggestion currently at this stage for the child.",
      side: "right",
      align: "start",
    },
  },
  {
    element: '[data-tour="pipeline-card"]',
    popover: {
      title: "A suggestion",
      description:
        "Each card is one redt. Click it to see the full story — the shadchan, references, notes and reminders.",
      side: "right",
      align: "start",
    },
  },
  {
    element: '[data-tour="add-suggestion"]',
    popover: {
      title: "Add a suggestion",
      description:
        "Got a new redt? Add it here and it lands at the start of the pipeline.",
      side: "bottom",
      align: "end",
    },
  },
  {
    element: '[data-tour="demo-banner"]',
    popover: {
      title: "Ready when you are",
      description:
        "When you're ready to start with your own family, clear the sample from here — you'll get a fresh, empty account. Enjoy exploring!",
      side: "bottom",
      align: "start",
    },
  },
];
