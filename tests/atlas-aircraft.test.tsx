import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ScheduledAtlasFlights } from "../src/client/components/ScheduledAtlasFlights";
it("keeps aircraft hidden until the absolute schedule is sampled, without a load-relative animation", () => {
  const markup=renderToStaticMarkup(<svg><ScheduledAtlasFlights routes={[{
    id:"route",fromCountryId:"country",toCountryId:"country",fromAirportId:"a",toAirportId:"b",
    from:{x:10,y:10},control:{x:20,y:0},to:{x:30,y:10},path:"M10 10 Q20 0 30 10",
    durationSeconds:12,delaySeconds:-3,planeKind:3,altitudeScale:1,rotateWithPath:true,
  }]} /></svg>);
  expect(markup).toContain("visibility:hidden");
  expect(markup).not.toContain("animateMotion");
  expect(markup.match(/atlas-aircraft-sprite/g)).toHaveLength(1);
});
