import { gameAssetUrl } from "../../shared/catalog";
import { ATLAS_AIRCRAFT_ENDPOINT_KEYFRAMES } from "../../shared/atlas-scene";

const AIRCRAFT_MODELS = Array.from({ length: 8 }, (_, index) => ({ body: `atlas/aircraft/airplane-model-${index + 1}-frame-1.png` }));
const PLANET_AIRCRAFT_MODELS = Array.from({ length: 8 }, (_, index) => ({ body: `atlas/aircraft-v4/airplane-topdown-${index + 1}.png` }));

export function AtlasAircraft({ path, durationSeconds, delaySeconds, kind, facing = "right", size = "default", rotateWithPath = false, visualScale = 1, startsAtAirport = false, endsAtAirport = false }: {
  path: string;
  durationSeconds: number;
  delaySeconds: number;
  kind: number;
  facing?: "left" | "right";
  size?: "default" | "planet";
  rotateWithPath?: boolean;
  visualScale?: number;
  startsAtAirport?: boolean;
  endsAtAirport?: boolean;
}) {
  const models = size === "planet" ? PLANET_AIRCRAFT_MODELS : AIRCRAFT_MODELS;
  const model = models[Math.abs(kind) % models.length]!;
  const width = size === "planet" ? 24 : 36;
  const height = size === "planet" ? 16 : 24;
  const lifecycle = startsAtAirport || endsAtAirport
    ? startsAtAirport && endsAtAirport
      ? ATLAS_AIRCRAFT_ENDPOINT_KEYFRAMES
      : `${startsAtAirport ? "0.05" : "1"};1;1;${endsAtAirport ? "0.05" : "1"}`
    : null;
  return <g className="atlas-aircraft-flight" data-facing={facing}>
    <animateMotion path={path} dur={`${durationSeconds}s`} begin={`${delaySeconds}s`} repeatCount="indefinite" rotate={rotateWithPath ? "auto" : undefined} />
    <g transform={`scale(${visualScale})`}>
      <g transform={!rotateWithPath && facing === "left" ? "scale(-1 1)" : undefined}>
        {lifecycle && <animateTransform attributeName="transform" additive="sum" type="scale" values={lifecycle} keyTimes="0;0.14;0.86;1" dur={`${durationSeconds}s`} begin={`${delaySeconds}s`} repeatCount="indefinite" />}
        <g className="atlas-aircraft-trail" aria-hidden="true">
          <rect x={-width / 2 - 5} y="-1" width="5" height="2" />
          <rect x={-width / 2 - 8} y="-.5" width="2" height="1" />
        </g>
        <image className="atlas-aircraft-sprite" href={gameAssetUrl(model.body)} x={-width / 2} y={-height / 2} width={width} height={height} />
      </g>
    </g>
  </g>;
}
