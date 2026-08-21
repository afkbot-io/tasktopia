import { describe, expect, it } from "vitest";
import { DomainError } from "../src/server/app-service";
import { requestErrorStatus } from "../src/server/routes";
import { GenerationPendingError } from "../src/server/world-generation-jobs";

describe("request error status mapping", () => {
  it("preserves rate-limit and other middleware HTTP statuses", () => {
    expect(requestErrorStatus(Object.assign(new Error("Rate limit exceeded"), { statusCode: 429 }))).toBe(429);
    expect(requestErrorStatus(Object.assign(new Error("Unavailable"), { statusCode: 503 }))).toBe(503);
  });

  it("maps domain and database errors without exposing unknown failures", () => {
    expect(requestErrorStatus(new DomainError("UNAUTHENTICATED", "Login required"))).toBe(401);
    expect(requestErrorStatus(new GenerationPendingError({
      id: crypto.randomUUID(), countryId: crypto.randomUUID(), operation: "country.regenerate",
      idempotencyKey: "accepted", payload: {}, status: "PENDING", attempts: 0, maxAttempts: 3,
    }))).toBe(202);
    expect(requestErrorStatus({ code: "23505" })).toBe(409);
    expect(requestErrorStatus(new Error("Unexpected"))).toBe(500);
  });
});
