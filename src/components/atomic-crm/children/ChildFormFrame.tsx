import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";

export interface ChildFormFrameProps {
  heading: string;
  description: string;
  children: ReactNode;
}

/**
 * The QL page frame shared by `ChildCreate` and `ChildEdit` (design-language
 * §2): an eyebrow + `font-display` heading over a calm form card. `Create`/
 * `Edit` are used with `title={false}` so this replaces the plain admin
 * title bar; `SimpleForm`/`FormToolbar` are admin components and stay
 * unforked inside.
 */
export const ChildFormFrame = ({
  heading,
  description,
  children,
}: ChildFormFrameProps) => (
  <div className="flex flex-col gap-6">
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        Family roster
      </p>
      <h1 className="font-display text-2xl font-bold tracking-tight">
        {heading}
      </h1>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
    <Card className="p-0 shadow-sm">
      <CardContent className="p-6">{children}</CardContent>
    </Card>
  </div>
);
