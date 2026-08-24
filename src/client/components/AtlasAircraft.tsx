import { gameAssetUrl } from "../../shared/catalog";

const AIRCRAFT_ASSETS = [
  "props/airplane-small.png",
  "props/airplane-twin.png",
  "props/airplane-courier.png",
] as const;

export function AtlasAircraft({ path, durationSeconds, delaySeconds, kind, facing, size = "default" }: {
  path: string;
  durationSeconds: number;
  delaySeconds: number;
  kind: number;
  facing: "left" | "right";
  size?: "default" | "planet";
}) {
  const asset = AIRCRAFT_ASSETS[Math.abs(kind) % AIRCRAFT_ASSETS.length]!;
  const width = size === "planet" ? 18 : 32;
  const height = size === "planet" ? 9 : 16;
  return <g className="atlas-aircraft-flight" data-facing={facing}>
    <animateMotion path={path} dur={`${durationSeconds}s`} begin={`${delaySeconds}s`} repeatCount="indefinite" />
    {size === "planet" && <animateTransform attributeName="transform" type="scale" values=".58;.86;1;.86;.58" keyTimes="0;.12;.5;.88;1" dur={`${durationSeconds}s`} begin={`${delaySeconds}s`} repeatCount="indefinite" additive="sum" />}
    <image
      className="atlas-aircraft-sprite"
      href={gameAssetUrl(asset)}
      x={-width / 2}
      y={-height / 2}
      width={width}
      height={height}
      transform={facing === "left" ? "scale(-1 1)" : undefined}
    />
  </g>;
}
