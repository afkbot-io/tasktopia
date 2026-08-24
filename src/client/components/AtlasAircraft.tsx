import { gameAssetUrl } from "../../shared/catalog";

const AIRCRAFT_ASSETS = [
  "props/airplane-small.png",
  "props/airplane-twin.png",
  "props/airplane-courier.png",
] as const;

export function AtlasAircraft({ path, durationSeconds, delaySeconds, kind, facing }: {
  path: string;
  durationSeconds: number;
  delaySeconds: number;
  kind: number;
  facing: "left" | "right";
}) {
  const asset = AIRCRAFT_ASSETS[Math.abs(kind) % AIRCRAFT_ASSETS.length]!;
  return <g className="atlas-aircraft-flight" data-facing={facing}>
    <animateMotion path={path} dur={`${durationSeconds}s`} begin={`${delaySeconds}s`} repeatCount="indefinite" />
    <image
      className="atlas-aircraft-sprite"
      href={gameAssetUrl(asset)}
      x="-16"
      y="-8"
      width="32"
      height="16"
      transform={facing === "left" ? "scale(-1 1)" : undefined}
    />
  </g>;
}
