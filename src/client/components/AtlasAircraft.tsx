import { microAmbientSprite } from "../../shared/micro-ambient";
import { ATLAS_AIRCRAFT_ENDPOINT_KEYFRAMES } from "../../shared/atlas-scene";

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
  const model = microAmbientSprite("aircraft", "regional", "east");
  const width = size === "planet" ? 8 : 12;
  const height = width;
  const lifecycle = startsAtAirport || endsAtAirport
    ? startsAtAirport && endsAtAirport
      ? ATLAS_AIRCRAFT_ENDPOINT_KEYFRAMES
      : `${startsAtAirport ? "0.05" : "1"};1;1;${endsAtAirport ? "0.05" : "1"}`
    : null;
  return <g className="atlas-aircraft-flight" data-facing={facing} data-route-variant={kind}>
    <animateMotion path={path} dur={`${durationSeconds}s`} begin={`${delaySeconds}s`} repeatCount="indefinite" rotate={rotateWithPath ? "auto" : undefined} />
    <g transform={`scale(${visualScale})`}>
      <g transform={!rotateWithPath && facing === "left" ? "scale(-1 1)" : undefined}>
        {lifecycle && <animateTransform attributeName="transform" additive="sum" type="scale" values={lifecycle} keyTimes="0;0.14;0.86;1" dur={`${durationSeconds}s`} begin={`${delaySeconds}s`} repeatCount="indefinite" />}
        <image className="atlas-aircraft-sprite" href={model.url} x={-width / 2} y={-height / 2} width={width} height={height} />
      </g>
    </g>
  </g>;
}
