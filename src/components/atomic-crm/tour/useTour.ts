import { useCallback } from "react";
import { driver } from "driver.js";
import { useStore } from "ra-core";
import { useNavigate } from "react-router";

import { useIsMobile } from "@/hooks/use-mobile";

import { TOUR_COMPLETED_KEY } from "../root/onboardingKeys";
// Base structural stylesheet (position/z-index/layout mechanics) MUST load
// before our visual override — tour.css only restyles colors/spacing, it
// never re-declares position/z-index, so without this import the popover
// renders unpositioned (position: static) and sits behind the overlay.
import "driver.js/dist/driver.css";
import "./tour.css";
import { buildTourSteps } from "./tourSteps";

const prefersReducedMotion = (): boolean =>
  typeof window !== "undefined" &&
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Reads the active theme's `--background` so the overlay scrim tracks
 * light/dark automatically — driver.js paints the scrim as an inline SVG
 * fill, not through CSS, so it can't pick up a token via a stylesheet. */
const readOverlayColor = (): string => {
  if (typeof window === "undefined") return "#000";
  const value = getComputedStyle(document.documentElement)
    .getPropertyValue("--background")
    .trim();
  return value || "#000";
};

/**
 * Exposes `startTour()` — builds and drives a fresh driver.js instance
 * styled by `tour.css`. Re-launchable at any time (the demo banner's "Take
 * the tour" button doesn't care whether `tour.completed` is already true).
 * Marks the walkthrough complete on Done AND on Skip/close alike, since
 * either outcome means the user doesn't need it to auto-start again.
 */
export const useTour = () => {
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [, setTourCompleted] = useStore<boolean>(TOUR_COMPLETED_KEY, false);

  const startTour = useCallback(() => {
    const reducedMotion = prefersReducedMotion();

    // The tour's dashboard steps (nav items, child-switcher, pipeline
    // snapshot) only exist on "/". The demo banner's "Take the tour" button
    // is reachable from every route, so without this the tour could start
    // mid-sequence with no anchors to highlight. Navigating first means the
    // tour always begins from a known-good route, whether it's auto-started
    // right after seeding or manually relaunched from anywhere in the app.
    navigate("/");

    const driverObj = driver({
      showProgress: true,
      allowClose: true,
      animate: !reducedMotion,
      smoothScroll: !reducedMotion,
      overlayClickBehavior: "close",
      overlayColor: readOverlayColor(),
      overlayOpacity: 0.55,
      stagePadding: 6,
      stageRadius: 12,
      waitForElement: 1200,
      nextBtnText: "Next",
      prevBtnText: "Back",
      doneBtnText: "Done",
      progressText: "{{current}} of {{total}}",
      onDestroyed: () => {
        setTourCompleted(true);
      },
      steps: buildTourSteps({
        navigateToBoard: () => navigate("/shidduchim"),
        prefersReducedMotion: reducedMotion,
        isMobile,
      }),
    });

    driverObj.drive();
  }, [navigate, isMobile, setTourCompleted]);

  return { startTour };
};
