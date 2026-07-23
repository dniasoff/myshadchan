import type { ReactNode } from "react";

/** Small uppercase eyebrow heading above a settings `ItemGroup`. */
export const SectionLabel = ({ children }: { children: ReactNode }) => (
  <p className="mb-1.5 px-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
    {children}
  </p>
);
