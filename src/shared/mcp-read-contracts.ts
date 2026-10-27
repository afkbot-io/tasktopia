import type { ArchiveRecordDto, CityDto, CountryDto, CountryRole, DistrictDto } from "./contracts";

export type McpCountryMetadata = Pick<CountryDto, "id" | "name" | "worldVersion" | "createdAt"> & {
  role: CountryRole; memberCount: number;
};
export type McpCityMetadata = Pick<CityDto, "id" | "name" | "status" | "center" | "bounds" | "styleId" | "morphology" | "createdAt"> & {
  districtCount: number; taskCount: number;
};
export type McpDistrictMetadata = Pick<DistrictDto, "id" | "cityId" | "name" | "status" | "deadline" | "capacitySp" | "archetype" | "color" | "createdAt"> & {
  workload: { districtId: string; targetSp: number; plannedSp: number; openSp: number; taskCount: number; overTargetBySp: number };
};
export type McpArchiveMetadata = Omit<ArchiveRecordDto, "body"> & { bodyLength: number };
export type McpMetadataPage<Kind extends string, Item> = {
  kind: Kind; version: 1; countryId?: string; items: Item[]; nextCursor: string | null;
};
