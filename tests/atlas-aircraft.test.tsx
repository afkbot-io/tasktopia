import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AtlasAircraft } from "../src/client/components/AtlasAircraft";

describe("atlas aircraft", () => {
  it("uses the flat top-down family and follows the route tangent on the planet", () => {
    const markup = renderToStaticMarkup(<svg><AtlasAircraft
      path="M10 10 Q20 0 30 10"
      durationSeconds={12}
      delaySeconds={-3}
      kind={3}
      size="planet"
      rotateWithPath
    /></svg>);

    expect(markup).toContain("aircraft-v2/airplane-topdown-4-frame-1.png");
    expect(markup).toContain('rotate="auto"');
    expect(markup).not.toContain("scale(-1 1)");
  });
});
