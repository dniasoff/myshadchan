import type { Identifier } from "ra-core";
import { useGetList } from "ra-core";
import { useSearchParams } from "react-router";

import type { Single } from "../types";
import { ShidduchCreate } from "./ShidduchCreate";
import { PipelineListSkeleton } from "./ShidduchimPipelineList";

/**
 * The `New` slot `buildEntityRoutes` mounts at `/shidduchim/new` (Story 5.1
 * AC 3). `buildEntityRoutes` renders `List` at `index` only, so the create
 * surface can no longer be matched INSIDE `ShidduchimList` the way Story
 * 3.13 wired it — this wrapper resolves the `singleId` prop `ShidduchCreate`
 * needs on its own: `?single_id=` when present, else the first
 * non-archived single, using the exact same query and the exact same
 * fallback `ShidduchimList` used for its own inline create branch, so the
 * single a user lands on does not change.
 */
export const ShidduchCreatePage = () => {
  const [searchParams] = useSearchParams();
  const { data: singles, isPending } = useGetList<Single>("singles", {
    // 2.5 AC-8: an archived single is not a selectable "current" single.
    filter: { "status@neq": "archived" },
    pagination: { page: 1, perPage: 100 },
    sort: { field: "first_name_en", order: "ASC" },
  });

  if (isPending) return <PipelineListSkeleton />;

  const singleIdParam = searchParams.get("single_id");
  const singleId: Identifier | undefined = singleIdParam
    ? singleIdParam
    : singles?.[0]?.id;

  return <ShidduchCreate singleId={singleId} />;
};
