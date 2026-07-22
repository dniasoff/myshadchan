import type { Identifier } from "ra-core";
import {
  Form,
  useDataProvider,
  useNotify,
  useRedirect,
  useRefresh,
} from "ra-core";
import { useSearchParams } from "react-router";
import { SaveButton } from "@/components/admin/form";
import { FormToolbar } from "@/components/admin/simple-form";
import { Dialog, DialogContent } from "@/components/ui/dialog";

import type { CrmDataProvider } from "../providers/types";
import type { CreateShidduchInput, PipelineState } from "../types";
import { INITIAL_PIPELINE_STATES } from "./pipelineStates";
import { ShidduchInputs } from "./ShidduchInputs";

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
      <DialogContent className="top-1/20 max-h-9/10 translate-y-0 overflow-y-auto lg:max-w-4xl">
        <Form
          onSubmit={onSubmit}
          defaultValues={{
            child_id: childId,
            initial_state: initialState,
            redt_date: new Date().toISOString().split("T")[0],
          }}
        >
          <ShidduchInputs />
          <FormToolbar>
            <SaveButton label="Add a suggestion" />
          </FormToolbar>
        </Form>
      </DialogContent>
    </Dialog>
  );
};
