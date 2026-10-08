import { describe, expect, it } from "@effect/vitest";
import { ProviderInstanceId } from "@t3tools/contracts";

import { teamBrief } from "./teamBrief.ts";

describe("teamBrief", () => {
  it("says nothing for a thread without workers", () => {
    expect(teamBrief([])).toBeUndefined();
  });

  it("names the seats and tells the brain to delegate instead of working", () => {
    const brief = teamBrief([
      { instanceId: ProviderInstanceId.make("antigravity"), model: "gemini-3-flash" },
    ])!;
    expect(brief).toContain("antigravity / gemini-3-flash");
    expect(brief).toContain("delegate_task");
    expect(brief).toContain("Do not do the work yourself");
  });
});
