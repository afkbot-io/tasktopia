import { describe, expect, it } from "vitest";
import { isStaticAssetRequest } from "../src/server/static-path";

describe("isStaticAssetRequest", () => {
  it.each([
    "/game-assets/v4/manifest.json",
    "/game-assets/v5/missing.png?revision=old",
    "/assets/missing-bundle.js",
    "/assets",
  ])("keeps missing static files out of the SPA fallback: %s", (url) => {
    expect(isStaticAssetRequest(url)).toBe(true);
  });

  it.each(["/", "/countries/example", "/tasks/123", "/asset-library"])(
    "keeps client routes eligible for the SPA fallback: %s",
    (url) => {
      expect(isStaticAssetRequest(url)).toBe(false);
    },
  );
});
