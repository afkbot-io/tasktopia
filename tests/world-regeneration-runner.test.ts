import { describe, expect, it, vi } from "vitest";
import { reconcileWorldRegeneration, retryWorldRegeneration } from "../src/server/world-regeneration-runner";

describe("world regeneration runner", () => {
  it("retries a rolled-back layout with a fresh deterministic attempt", async () => {
    const operation = vi.fn(async (attempt: number) => {
      if (attempt < 3) throw new Error("layout blocked");
      return { seed: 42 };
    });
    const onRetry = vi.fn();

    await expect(retryWorldRegeneration(3, operation, onRetry)).resolves.toEqual({
      attempt: 3,
      value: { seed: 42 },
    });
    expect(operation).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenNthCalledWith(1, 1, expect.objectContaining({ message: "layout blocked" }));
    expect(onRetry).toHaveBeenNthCalledWith(2, 2, expect.objectContaining({ message: "layout blocked" }));
  });

  it("preserves an already valid world without risking a replacement layout", async () => {
    const operation = vi.fn(async () => ({ seed: 42 }));

    await expect(reconcileWorldRegeneration([], 3, operation)).resolves.toEqual({ status: "preserved" });
    expect(operation).not.toHaveBeenCalled();
  });

  it("regenerates an audit-clean world when a release migration forces replay", async () => {
    const operation = vi.fn(async () => ({ seed: 84 }));

    await expect(reconcileWorldRegeneration([], 3, operation, undefined, true)).resolves.toEqual({
      status: "regenerated",
      attempt: 1,
      value: { seed: 84 },
    });
    expect(operation).toHaveBeenCalledOnce();
  });
});
