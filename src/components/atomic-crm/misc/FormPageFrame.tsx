import type { ReactNode } from "react";

import { Card, CardContent } from "@/components/ui/card";

export interface FormPageFrameProps {
  /** The uppercase label above the heading (was hardcoded "Family roster"
   * before this became a shared frame — every caller now states its own). */
  eyebrow: string;
  heading: string;
  description: string;
  children: ReactNode;
}

/**
 * The QL page frame shared by every record form page (design-language §2):
 * an eyebrow + `font-display` heading over a calm form card. `Create`/`Edit`
 * are used with `title={false}` so this replaces the plain admin title bar;
 * `SimpleForm`/`FormToolbar` are admin components and stay unforked inside.
 * Originally a `singles`-only frame; moved out of that folder and
 * generalized with the `eyebrow` prop (Story 3.13) so
 * `shidduchim/ShidduchCreate.tsx` — a page with no `<Create>` wrapper, since
 * it submits through the `createShidduch` RPC rather than
 * `dataProvider.create` — can share it too.
 */
export const FormPageFrame = ({
  eyebrow,
  heading,
  description,
  children,
}: FormPageFrameProps) => (
  <div className="flex flex-col gap-6">
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">
        {eyebrow}
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
