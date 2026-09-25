import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createAtlasTransition } from "../src/client/atlas-navigation-transition";
import { MapLevelTransition } from "../src/client/components/MapLevelTransition";

describe("map level transition", () => {
  it("announces the destination and anchors the effect at the selected point", () => {
    const html = renderToStaticMarkup(<MapLevelTransition transition={createAtlasTransition(
      "PLANET", "CITY", { x: 0.25, y: 0.75 }, 1_000,
    )} />);

    expect(html).toContain("Открываем город");
    expect(html).toContain("--map-transition-x:25%");
    expect(html).toContain("--map-transition-y:75%");
    expect(html).toContain('role="status"');
  });
});

it('keeps a phrase stable through one transition and avoids adjacent repeats',()=>{
 let previous=-1;
 for(let n=0;n<30;n++){
  const transition=createAtlasTransition('PLANET','CITY',{x:.5,y:.5},n);
  expect(transition.phraseIndex).not.toBe(previous);
  previous=transition.phraseIndex!;
  expect(renderToStaticMarkup(<MapLevelTransition transition={transition}/>)).toEqual(renderToStaticMarkup(<MapLevelTransition transition={transition}/>));
 }
});

it('shows the actual destination without rendering its name as markup', () => {
 const transition={...createAtlasTransition('PLANET','CITY',{x:.5,y:.5},1),destinationName:'<script>Город</script>'};
 const html=renderToStaticMarkup(<MapLevelTransition transition={transition}/>);
 expect(html).toContain('&lt;script&gt;Город&lt;/script&gt;');
 expect(html).not.toContain('<script>');
});
