import { describe, expect, it, vi } from "vitest";
import { retryWorldRegeneration } from "../src/server/world-regeneration-runner";

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
});
