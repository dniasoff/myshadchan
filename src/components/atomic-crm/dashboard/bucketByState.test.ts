import type { ShidduchSummary } from "../types";
import { PIPELINE_STATE_VALUES } from "../shidduchim/pipelineStates";
import { bucketByState } from "./bucketByState";

const makeShidduch = (
  overrides: Partial<ShidduchSummary> & Pick<ShidduchSummary, "id">,
): ShidduchSummary =>
  ({
    account_id: 1,
    child_id: 1,
    pipeline_state: "new",
    redt_date: "2026-07-01",
    first_suggested_at: "2026-07-01T00:00:00.000Z",
    origin: "manual",
    visibility: "shared",
    index: 0,
    created_at: "2026-07-01T00:00:00.000Z",
    ...overrides,
  }) as ShidduchSummary;

describe("bucketByState", () => {
  it("returns 7 buckets in PIPELINE_STATES order for an empty child", () => {
    const buckets = bucketByState([]);

    expect(buckets.map((bucket) => bucket.state)).toEqual(
      PIPELINE_STATE_VALUES,
    );
    expect(buckets.every((bucket) => bucket.count === 0)).toBe(true);
  });

  it("counts one shidduch per state when one exists in every state", () => {
    const summaries = PIPELINE_STATE_VALUES.map((state, index) =>
      makeShidduch({ id: index + 1, pipeline_state: state }),
    );

    const buckets = bucketByState(summaries);

    expect(buckets.every((bucket) => bucket.count === 1)).toBe(true);
  });

  it("groups multiple shidduchim into the same state bucket", () => {
    const summaries = [
      makeShidduch({ id: 1, pipeline_state: "look_into" }),
      makeShidduch({ id: 2, pipeline_state: "look_into" }),
      makeShidduch({ id: 3, pipeline_state: "yes" }),
    ];

    const buckets = bucketByState(summaries);

    expect(buckets.find((b) => b.state === "look_into")?.count).toBe(2);
    expect(buckets.find((b) => b.state === "yes")?.count).toBe(1);
    expect(buckets.find((b) => b.state === "new")?.count).toBe(0);
  });
});
