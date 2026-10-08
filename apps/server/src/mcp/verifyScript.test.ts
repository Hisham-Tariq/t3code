import { describe, expect, it } from "@effect/vitest";

import { resolveVerifyScript } from "./verifyScript.ts";

const script = (name: string) => ({ name, command: `run ${name}` });

describe("resolveVerifyScript", () => {
  it("prefers the conventional names in order", () => {
    expect(resolveVerifyScript([script("build"), script("verify")], undefined)?.name).toBe(
      "verify",
    );
    expect(resolveVerifyScript([script("build"), script("test")], undefined)?.name).toBe("test");
    expect(resolveVerifyScript([script("build")], undefined)?.name).toBe("build");
  });

  it("honours an explicit request, ignoring case and padding", () => {
    expect(resolveVerifyScript([script("verify"), script("PlayMode")], " playmode ")?.name).toBe(
      "PlayMode",
    );
  });

  it("returns nothing rather than guessing when no script fits", () => {
    expect(resolveVerifyScript([], undefined)).toBeUndefined();
    expect(resolveVerifyScript([script("deploy")], undefined)).toBeUndefined();
    expect(resolveVerifyScript([script("verify")], "missing")).toBeUndefined();
  });
});
