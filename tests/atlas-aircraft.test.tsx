import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AtlasAircraft } from "../src/client/components/AtlasAircraft";

describe("atlas aircraft", () => {
  it("keeps one top-down body visible, follows the route tangent and animates airport endpoints", () => {
    const markup = renderToStaticMarkup(<svg><AtlasAircraft
      path="M10 10 Q20 0 30 10"
      durationSeconds={12}
      delaySeconds={-3}
      kind={3}
      size="planet"
      rotateWithPath
      startsAtAirport
      endsAtAirport
    /></svg>);

    expect(markup).toContain("aircraft-v4/airplane-topdown-4.png");
    expect(markup).toContain('rotate="auto"');
    expect(markup.match(/atlas-aircraft-sprite/g)).toHaveLength(1);
    expect(markup).toContain("atlas-aircraft-trail");
    expect(markup).toContain('values="0.05;1;1;0.05"');
    expect(markup).not.toContain("scale(-1 1)");
    expect(markup).not.toContain("atlas-aircraft-frame-b");
  });
});
