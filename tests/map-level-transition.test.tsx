import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createAtlasTransition } from "../src/client/atlas-navigation-transition";
import { MapLevelTransition } from "../src/client/components/MapLevelTransition";

describe("map level transition", () => {
  it("announces the destination and anchors the effect at the selected point", () => {
    const html = renderToStaticMarkup(<MapLevelTransition transition={createAtlasTransition(
      "COUNTRY", "CITY", { x: 0.25, y: 0.75 }, 1_000,
    )} />);

    expect(html).toContain("Открываем город");
    expect(html).toContain("--map-transition-x:25%");
    expect(html).toContain("--map-transition-y:75%");
    expect(html).toContain('role="status"');
  });
});
