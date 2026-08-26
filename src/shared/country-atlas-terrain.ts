import type { Cell, Rect } from "./contracts";
import {
  COUNTRY_ATLAS_TERRAIN_TILE_CELLS,
  type CountryAtlasCityDto,
  type CountryAtlasMacroTerrainDto,
  type CountryAtlasTerrainCellDto,
} from "./country-atlas-contract";
import { terrainAt } from "./world-terrain";

type AtlasCityCenters = Pick<CountryAtlasCityDto, "sourceCenter" | "atlasCenter">;
type AtlasCityCutout = Pick<CountryAtlasCityDto, "sourceCenter" | "atlasCenter" | "scale" | "cutoutMask" | "districts">;

/** Generate the decorative country terrain locally from the persisted seed. */
export function seededAtlasMacroTerrain(
  seed: number,
  bounds: Rect,
  cities: readonly AtlasCityCenters[],
): CountryAtlasMacroTerrainDto[] {
  if (cities.length === 0) return [];
  const sourceSpan = {
    x: Math.max(...cities.map((city) => city.sourceCenter.x)) - Math.min(...cities.map((city) => city.sourceCenter.x)),
    y: Math.max(...cities.map((city) => city.sourceCenter.y)) - Math.min(...cities.map((city) => city.sourceCenter.y)),
  };
  const atlasSpan = {
    x: Math.max(...cities.map((city) => city.atlasCenter.x)) - Math.min(...cities.map((city) => city.atlasCenter.x)),
    y: Math.max(...cities.map((city) => city.atlasCenter.y)) - Math.min(...cities.map((city) => city.atlasCenter.y)),
  };
  const sourcePerAtlas = {
    x: atlasSpan.x > 0 ? sourceSpan.x / atlasSpan.x : 1 / 0.12,
    y: atlasSpan.y > 0 ? sourceSpan.y / atlasSpan.y : 1 / 0.12,
  };
  const result: CountryAtlasMacroTerrainDto[] = [];
  for (let y = bounds.minY; y <= bounds.maxY; y += COUNTRY_ATLAS_TERRAIN_TILE_CELLS) {
    for (let x = bounds.minX; x <= bounds.maxX; x += COUNTRY_ATLAS_TERRAIN_TILE_CELLS) {
      const widthCells = Math.min(COUNTRY_ATLAS_TERRAIN_TILE_CELLS, bounds.maxX - x + 1);
      const heightCells = Math.min(COUNTRY_ATLAS_TERRAIN_TILE_CELLS, bounds.maxY - y + 1);
      const atlasCenter = { x: x + widthCells / 2, y: y + heightCells / 2 };
      let totalWeight = 0;
      let residualX = 0;
      let residualY = 0;
      for (const city of cities) {
        const distanceSquared = (atlasCenter.x - city.atlasCenter.x) ** 2 + (atlasCenter.y - city.atlasCenter.y) ** 2;
        const weight = 1 / Math.max(0.25, distanceSquared);
        totalWeight += weight;
        residualX += (city.sourceCenter.x - city.atlasCenter.x * sourcePerAtlas.x) * weight;
        residualY += (city.sourceCenter.y - city.atlasCenter.y * sourcePerAtlas.y) * weight;
      }
      const sourceCenter = {
        x: Math.round(atlasCenter.x * sourcePerAtlas.x + residualX / totalWeight),
        y: Math.round(atlasCenter.y * sourcePerAtlas.y + residualY / totalWeight),
      };
      result.push({
        id: `${x}:${y}`,
        atlasOrigin: { x, y },
        widthCells,
        heightCells,
        atlasCenter,
        sourceCenter,
        ...terrainAt(seed, sourceCenter.x, sourceCenter.y),
      });
    }
  }
  return result;
}

/** Reconstruct each city cutout's terrain from compact projection metadata. */
export function seededAtlasCutoutTerrain(seed: number, city: AtlasCityCutout): CountryAtlasTerrainCellDto[] {
  return city.cutoutMask.map((atlasCell) => {
    let district = city.districts[0];
    let nearestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of city.districts) {
      const distance = (atlasCell.x - candidate.atlasCenter.x) ** 2 + (atlasCell.y - candidate.atlasCenter.y) ** 2;
      if (distance < nearestDistance || (distance === nearestDistance && candidate.id < (district?.id ?? ""))) {
        district = candidate;
        nearestDistance = distance;
      }
    }
    const sourceCell: Cell = district
      ? {
          x: Math.round(district.sourceCenter.x + (atlasCell.x - district.atlasCenter.x) / city.scale),
          y: Math.round(district.sourceCenter.y + (atlasCell.y - district.atlasCenter.y) / city.scale),
        }
      : {
          x: city.sourceCenter.x + Math.round((atlasCell.x - city.atlasCenter.x) / city.scale),
          y: city.sourceCenter.y + Math.round((atlasCell.y - city.atlasCenter.y) / city.scale),
        };
    return { atlasCell, sourceCell, ...terrainAt(seed, sourceCell.x, sourceCell.y) };
  });
}
