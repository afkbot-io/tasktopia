import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createAtlasTransition, withAtlasTransitionPhase } from "../src/client/atlas-navigation-transition";
import { MapLevelTransition } from "../src/client/components/MapLevelTransition";

describe("map level transition", () => {
  it("announces the destination without full-screen animated geometry", () => {
    const html = renderToStaticMarkup(<MapLevelTransition transition={createAtlasTransition(
      "PLANET", "CITY", { x: 0.25, y: 0.75 }, 1_000,
    )} />);

    expect(html).toContain("Открываем город");
    expect(html).not.toContain("map-level-transition-pixels");
    expect(html).not.toContain("map-level-transition-focus");
    expect(html).toContain('role="status"');
  });
});

it('reports real loading phases instead of random progress phrases',()=>{
 const transition=createAtlasTransition('PLANET','CITY',{x:.5,y:.5},1);
 expect(renderToStaticMarkup(<MapLevelTransition transition={transition}/>)).toContain('Получаем план города');
 expect(renderToStaticMarkup(<MapLevelTransition transition={withAtlasTransitionPhase(transition,'PREPARE')}/>)).toContain('Готовим улицы и здания');
});

it('shows the actual destination without rendering its name as markup', () => {
 const transition={...createAtlasTransition('PLANET','CITY',{x:.5,y:.5},1),destinationName:'<script>Город</script>'};
 const html=renderToStaticMarkup(<MapLevelTransition transition={transition}/>);
 expect(html).toContain('&lt;script&gt;Город&lt;/script&gt;');
 expect(html).not.toContain('<script>');
});
