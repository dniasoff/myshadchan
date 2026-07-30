import type { Identifier } from "ra-core";
import {
  Form,
  useDataProvider,
  useNotify,
  useRedirect,
  useRefresh,
} from "ra-core";
import { useSearchParams } from "react-router";

import { buildListPath } from "../entity360/entityPaths";
import { FormToolbar } from "../layout/FormToolbar";
import { FormPageFrame } from "../misc/FormPageFrame";
import type { CrmDataProvider } from "../providers/types";
import type { CreateShidduchInput, PipelineState } from "../types";
import { INITIAL_PIPELINE_STATES } from "./pipelineStates";
import { ShidduchInputs } from "./ShidduchInputs";

/**
 * The page at `/shidduchim/new` (UX-DR3 — records live at URLs, not in
 * modals; Story 3.13). Submits straight to createShidduch (AD-4 invariant
 * 1) — the sole INSERT path — never a raw dataProvider.create. The starting
 * column comes from a `?state=` query param (set by the per-column "Add
 * here"), defaulting to New. A page has no open state; closing it is
 * `CancelButton`'s `navigate(-1)`, reached via `FormToolbar` below.
 */
export const ShidduchCreate = ({ singleId }: { singleId?: Identifier }) => {
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

  const onSubmit = async (values: Record<string, unknown>) => {
    try {
      const input: CreateShidduchInput = {
        single_id: values.single_id as Identifier,
        shadchan_id: (values.shadchan_id as Identifier) ?? null,
        name_en: (values.name_en as string) ?? null,
        father_en: (values.father_en as string) ?? null,
        father_he: (values.father_he as string) ?? null,
        mother_en: (values.mother_en as string) ?? null,
        mother_he: (values.mother_he as string) ?? null,
        seminary_en: (values.seminary_en as string) ?? null,
        shul_en: (values.shul_en as string) ?? null,
        location_en: (values.location_en as string) ?? null,
        age: (values.age as number) ?? null,
        height: (values.height as string) ?? null,
        dob: (values.dob as string) ?? null,
        background: (values.background as string) ?? null,
        marital_status: (values.marital_status as string) ?? null,
        existing_children_note:
          (values.existing_children_note as string) ?? null,
        origin: "manual",
        initial_state: (values.initial_state as PipelineState) ?? initialState,
        visibility: "shared",
        redt_date: (values.redt_date as string) ?? null,
      };
      await dataProvider.createShidduch(input);
      notify("Shidduch added", { type: "info" });
      refresh();
      redirect(buildListPath("shidduchim"));
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
    <FormPageFrame
      eyebrow="Pipeline"
      heading="Add a suggestion"
      description="A calm start — fill in what you know now, add the rest later."
    >
      <Form
        onSubmit={onSubmit}
        mode="onBlur"
        defaultValues={{
          single_id: singleId,
          initial_state: initialState,
          redt_date: new Date().toISOString().split("T")[0],
        }}
      >
        <ShidduchInputs />
        <FormToolbar saveLabel="Add a suggestion" />
      </Form>
    </FormPageFrame>
  );
};
