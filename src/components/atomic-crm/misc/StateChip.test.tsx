import { render } from "vitest-browser-react";

import type { PipelineState } from "../types";
import { getPipelineStateDef } from "../shidduchim/pipelineStates";
import { StateChip } from "./StateChip";

describe("StateChip", () => {
  it.each<PipelineState>([
    "new",
    "look_into",
    "not_sure",
    "for_sure_not",
    "yes",
    "unsure",
    "no",
  ])("renders the %s state's label", async (state) => {
    const screen = await render(<StateChip state={state} />);
    const label = getPipelineStateDef(state)?.label ?? "";

    await expect.element(screen.getByText(label)).toBeVisible();
  });

  it("resolves the gut for_sure_not and the post-look no to different tokens", async () => {
    const fsn = await render(<StateChip state="for_sure_not" />);
    const no = await render(<StateChip state="no" />);

    const fsnChip = fsn.container.querySelector("span");
    const noChip = no.container.querySelector("span");

    expect(fsnChip?.style.color).toContain("--st-fsn");
    expect(noChip?.style.color).toContain("--st-no");
    expect(fsnChip?.style.color).not.toEqual(noChip?.style.color);
  });
});
