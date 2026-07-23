import type { Identifier } from "ra-core";
import {
  Form,
  useDataProvider,
  useNotify,
  useRedirect,
  useRefresh,
} from "ra-core";
import { useSearchParams } from "react-router";
import { CancelButton } from "@/components/admin/cancel-button";
import { SaveButton } from "@/components/admin/form";
import { FormToolbar } from "@/components/admin/simple-form";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import type { CrmDataProvider } from "../providers/types";
import type { CreateShidduchInput, PipelineState } from "../types";
import { INITIAL_PIPELINE_STATES } from "./pipelineStates";
import { ShidduchInputs } from "./ShidduchInputs";

/** Primary CTA (design-language §5.3) — indigo→violet gradient, accent-glow,
 * spring press. The dialog's one primary action. */
const PRIMARY_CTA_CLASS =
  "inline-flex items-center gap-2 rounded-xl px-4 h-11 font-semibold " +
  "text-primary-foreground bg-[linear-gradient(135deg,var(--accent-grad-from),var(--accent-grad-to))] " +
  "shadow-sm shadow-[0_8px_24px_-6px_var(--glow-accent)] " +
  "transition-[transform,box-shadow] duration-[160ms] ease-[--ease-spring] " +
  "hover:shadow-[0_10px_30px_-6px_var(--glow-accent-strong)] active:scale-[0.97] " +
  "focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 " +
  "focus-visible:ring-offset-background outline-none";

/**
 * Manual "Add a suggestion" flow. Submits straight to createShidduch (AD-4
 * invariant 1) — the sole INSERT path — never a raw dataProvider.create. The
 * starting column comes from a `?state=` query param (set by the per-column
 * "Add here"), defaulting to New.
 */
export const ShidduchCreate = ({
  open,
  childId,
}: {
  open: boolean;
  childId?: Identifier;
}) => {
  const redirect = useRedirect();
  const refresh = useRefresh();
  const notify = useNotify();
  const dataProvider = useDataProvider<CrmDataProvider>();
  const [searchParams] = useSearchParams();

  const stateParam = searchParams.get("state") as PipelineState | null;
  const initialState =
    stateParam && INITIAL_PIPELINE_STATES.includes(stateParam)
      ? stateParam
      : "new";

  const handleClose = () => redirect("/shidduchim");

  const onSubmit = async (values: Record<string, unknown>) => {
    try {
      const input: CreateShidduchInput = {
        child_id: values.child_id as Identifier,
        shadchan_id: (values.shadchan_id as Identifier) ?? null,
        name_en: (values.name_en as string) ?? null,
        name_he: (values.name_he as string) ?? null,
        parents_en: (values.parents_en as string) ?? null,
        seminary_en: (values.seminary_en as string) ?? null,
        shul_en: (values.shul_en as string) ?? null,
        location_en: (values.location_en as string) ?? null,
        age: (values.age as number) ?? null,
        height: (values.height as string) ?? null,
        origin: "manual",
        initial_state: (values.initial_state as PipelineState) ?? initialState,
        visibility: "shared",
        redt_date: (values.redt_date as string) ?? null,
      };
      await dataProvider.createShidduch(input);
      notify("Shidduch added", { type: "info" });
      refresh();
      redirect("/shidduchim");
    } catch (error) {
      notify(
        error instanceof Error ? error.message : "Failed to add shidduch",
        {
          type: "error",
        },
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={() => handleClose()}>
      {/* Overlay surface — glass is allowed here (design-language §1.2); the
          form panels inside stay solid (dense reading surfaces, §6.3).
          Light mode uses a solid popover surface instead of glass: the
          light --glass-bg (0.99 L @ 0.72 alpha) over the modal scrim reads
          muddy/grey and drags the eyebrow + helper text contrast down —
          dark mode keeps the glass, which is the showpiece. */}
      <DialogContent
        className={
          "top-1/20 max-h-9/10 translate-y-0 overflow-y-auto lg:max-w-4xl " +
          "bg-popover border-border shadow-lg " +
          "dark:bg-[--glass-bg] dark:backdrop-blur-[var(--glass-blur)] dark:border-[--glass-border]"
        }
      >
        <DialogHeader>
          <DialogTitle className="font-display text-2xl font-semibold tracking-tight">
            Add a suggestion
          </DialogTitle>
          <DialogDescription>
            A calm start — fill in what you know now, add the rest later.
          </DialogDescription>
        </DialogHeader>
        <Form
          onSubmit={onSubmit}
          mode="onBlur"
          defaultValues={{
            child_id: childId,
            initial_state: initialState,
            redt_date: new Date().toISOString().split("T")[0],
          }}
        >
          <ShidduchInputs />
          <FormToolbar>
            <div className="flex flex-row justify-end gap-2">
              <CancelButton className="h-11" />
              <SaveButton
                label="Add a suggestion"
                className={PRIMARY_CTA_CLASS}
              />
            </div>
          </FormToolbar>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
