import type { TaskStatus, DistrictStatus } from "./contracts";

export type TaskSprintPhaseDto = {
  id: string; taskId: string; districtId: string; districtName: string; sequence: number;
  districtStatus: DistrictStatus;
  outcome: "OPEN" | "CARRIED" | "COMPLETED";
  entryStatus: TaskStatus; entryProgress: number; entryEstimate: number;
  exitStatus: TaskStatus | null; exitProgress: number | null; exitEstimate: number | null;
  enteredAt: string; exitedAt: string | null; comment: string;
};
export type TaskSprintPageDto = {
  kind: "task.sprint-page"; version: 1; countryId: string; taskId: string;
  homeDistrictId: string; currentDistrictId: string; homeDistrictName: string; currentDistrictName: string;
  items: TaskSprintPhaseDto[]; nextCursor: string | null;
};
