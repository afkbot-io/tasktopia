import { PLANET_ATLAS_SCHEMA_VERSION } from "../shared/planet-atlas-contract";

export function planetAtlasCacheKey(userId: string): string {
  return `tasktopia:planet-atlas:v${PLANET_ATLAS_SCHEMA_VERSION}:user:${userId}`;
}
