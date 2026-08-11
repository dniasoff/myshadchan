import { cn } from "@/lib/utils";
import type { HTMLAttributes, ReactNode } from "react";

export interface TopToolbarProps extends HTMLAttributes<HTMLDivElement> {
  children?: ReactNode;
}

export const TopToolbar = (inProps: TopToolbarProps) => {
  const { className, children, ...props } = inProps;

  return (
    <div
      className={cn(
        // `flex-wrap` is load-bearing on narrow viewports, not cosmetic.
        // Without it these actions stay on one line, and because the row is
        // `justify-end` the overflow goes off the LEFT edge, where the page
        // cannot scroll to reach it — the control is rendered, visible and
        // enabled, and simply unreachable. Measured on the Single 360 at
        // 390px (Mobile Chrome): Story 13.1 added SingleGrantManagement as a
        // third action beside the long-labelled "Give <name> their own login",
        // and Playwright reported "element is visible, enabled and stable ...
        // done scrolling ... element is outside of the viewport" — so a parent
        // on a phone could not give their child a login at all.
        // `whitespace-nowrap` still keeps each individual label on one line;
        // wrapping happens between buttons, not inside them.
        "flex flex-auto flex-wrap justify-end items-end gap-2 whitespace-nowrap",
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
};

export default TopToolbar;
