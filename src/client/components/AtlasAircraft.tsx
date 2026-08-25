import { gameAssetUrl } from "../../shared/catalog";

const AIRCRAFT_MODELS = Array.from({ length: 8 }, (_, index) => ({
  first: `atlas/aircraft/airplane-model-${index + 1}-frame-1.png`,
  second: `atlas/aircraft/airplane-model-${index + 1}-frame-2.png`,
}));
const PLANET_AIRCRAFT_MODELS = Array.from({ length: 8 }, (_, index) => ({
  first: `atlas/aircraft-v2/airplane-topdown-${index + 1}-frame-1.png`,
  second: `atlas/aircraft-v2/airplane-topdown-${index + 1}-frame-2.png`,
}));

export function AtlasAircraft({ path, durationSeconds, delaySeconds, kind, facing = "right", size = "default", rotateWithPath = false, visualScale = 1 }: {
  path: string;
  durationSeconds: number;
  delaySeconds: number;
  kind: number;
  facing?: "left" | "right";
  size?: "default" | "planet";
  rotateWithPath?: boolean;
  visualScale?: number;
}) {
  const models = size === "planet" ? PLANET_AIRCRAFT_MODELS : AIRCRAFT_MODELS;
  const model = models[Math.abs(kind) % models.length]!;
  const width = size === "planet" ? 24 : 36;
  const height = size === "planet" ? 16 : 24;
  return <g className="atlas-aircraft-flight" data-facing={facing}>
    <animateMotion path={path} dur={`${durationSeconds}s`} begin={`${delaySeconds}s`} repeatCount="indefinite" rotate={rotateWithPath ? "auto" : undefined} />
    <g transform={`scale(${visualScale})`}>
    <image
      className="atlas-aircraft-sprite atlas-aircraft-frame-a"
      href={gameAssetUrl(model.first)}
      x={-width / 2}
      y={-height / 2}
      width={width}
      height={height}
      transform={!rotateWithPath && facing === "left" ? "scale(-1 1)" : undefined}
    />
    <image
      className="atlas-aircraft-sprite atlas-aircraft-frame-b"
      href={gameAssetUrl(model.second)}
      x={-width / 2}
      y={-height / 2}
      width={width}
      height={height}
      transform={!rotateWithPath && facing === "left" ? "scale(-1 1)" : undefined}
    />
    </g>
  </g>;
}
