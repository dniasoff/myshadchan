import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Sparkles } from "lucide-react";
import { useDataProvider, useNotify, useStore } from "ra-core";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

import type { CrmDataProvider } from "../providers/types";
import { TOUR_COMPLETED_KEY } from "../root/onboardingKeys";
import { useAccountDemo } from "../root/useAccountDemo";
import { useTour } from "../tour/useTour";

const CLEAR_BUTTON_CLASSNAME = cn(
  "text-[color:var(--attention-foreground)] shadow-sm",
  "bg-[color-mix(in_oklch,var(--attention-strong)_85%,transparent)]",
  "hover:bg-[color-mix(in_oklch,var(--attention-strong)_100%,transparent)]",
);

/**
 * Full-width, sticky, amber notice shown whenever `current_account_demo()`
 * is true — warm, not alarming (demo-onboarding-plan.md §B5). Renders as
 * the FIRST element of the shell (see Layout/MobileLayout) so it reserves
 * its own height in normal flow, then reports that measured height onto
 * `document.documentElement` as `--banner-h`; Sidebar/TopBar consume that
 * var so nothing overlaps, and nothing shifts at all when there's no
 * banner (the var defaults to `0px`).
 */
export const DemoBanner = () => {
  const { data: isDemo } = useAccountDemo();
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    if (!isDemo || !node) {
      document.documentElement.style.setProperty("--banner-h", "0px");
      return;
    }
    const reportHeight = () =>
      document.documentElement.style.setProperty(
        "--banner-h",
        `${node.getBoundingClientRect().height}px`,
      );
    reportHeight();
    const observer = new ResizeObserver(reportHeight);
    observer.observe(node);
    return () => {
      observer.disconnect();
      document.documentElement.style.setProperty("--banner-h", "0px");
    };
  }, [isDemo]);

  if (!isDemo) return null;

  return (
    <div
      ref={ref}
      data-tour="demo-banner"
      className="sticky top-0 z-40 flex flex-col gap-2.5 border-b px-4 py-2.5
        sm:flex-row sm:items-center sm:gap-4 sm:px-6"
      style={{
        background:
          "color-mix(in oklch, var(--attention) 18%, var(--background))",
        borderColor: "color-mix(in oklch, var(--attention) 38%, transparent)",
      }}
    >
      <div
        className="flex items-center gap-2 text-sm font-medium"
        style={{ color: "var(--attention-foreground)" }}
      >
        <Sparkles
          className="size-4 shrink-0"
          style={{ color: "var(--attention-strong)" }}
          aria-hidden="true"
        />
        You're exploring demo data — nothing here is real.
      </div>
      <DemoBannerActions />
    </div>
  );
};

const DemoBannerActions = () => {
  const { startTour } = useTour();
  const [confirmOpen, setConfirmOpen] = useState(false);

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2 sm:ms-auto">
      <Button type="button" variant="ghost" size="sm" onClick={startTour}>
        Take the tour
      </Button>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className={CLEAR_BUTTON_CLASSNAME}
        onClick={() => setConfirmOpen(true)}
      >
        Clear it &amp; start fresh
      </Button>
      <ClearDemoDialog open={confirmOpen} onOpenChange={setConfirmOpen} />
    </div>
  );
};

const ClearDemoDialog = ({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) => {
  const dataProvider = useDataProvider<CrmDataProvider>();
  const notify = useNotify();
  const queryClient = useQueryClient();
  const [, setTourCompleted] = useStore<boolean>(TOUR_COMPLETED_KEY, false);
  const [clearing, setClearing] = useState(false);

  const handleConfirm = async () => {
    setClearing(true);
    try {
      await dataProvider.clearDemo();
      setTourCompleted(false);
      // `OnboardingGate` re-arms the welcome screen on its own once this
      // refetch proves the account is empty again — no "seen" flag needed.
      await queryClient.invalidateQueries();
      onOpenChange(false);
    } catch (error) {
      notify(
        error instanceof Error
          ? error.message
          : "Couldn't clear the demo data. Try again.",
        { type: "error" },
      );
    } finally {
      setClearing(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Clear the sample data?</DialogTitle>
          <DialogDescription>
            This deletes the demo family and everything in it, and gives you a
            fresh, empty account to start with. This can't be undone.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={clearing}
          >
            Cancel
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={handleConfirm}
            disabled={clearing}
          >
            {clearing ? (
              <Loader2
                className="me-2 size-4 animate-spin"
                aria-hidden="true"
              />
            ) : null}
            Clear it &amp; start fresh
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
