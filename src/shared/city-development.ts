import type { BlockServiceRole } from "./block-world";
import type { InfrastructureMilestone } from "./city-development-policy";
export type DevelopmentObjectState = "PLANNED" | "BUILDING" | "TESTING" | "READY" | "HISTORICAL";
export type CityTransportDevelopmentDto = {
  kind: "AIR" | "RAIL" | "SEA";
  state: "NOT_READY" | "NO_CONNECTION" | "CONNECTED";
  routes: { id: string; destinationCityId: string; destinationName: string; travelMs: number; dwellMs: number }[];
};
export type CityDevelopmentDto = {
  /** Optional for older servers; routes include only currently accessible countries. */
  transport?: CityTransportDevelopmentDto[];
  revision: number;
  districts: { id: string; name?: string; milestones: InfrastructureMilestone[] }[];
  services: { districtId?: string; role: BlockServiceRole; state: DevelopmentObjectState; taskId?: string; trigger?: string }[];
  landmarks: { family: string; label: string; state: DevelopmentObjectState | "UNDISCOVERED"; taskId?: string }[];
};
