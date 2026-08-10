const BUILDING_STAGE_COLORS = [0x9b72d2, 0xd6a13d, 0xf2c84b, 0x4fa5d7, 0x69ad67] as const;

export type BuildingBadgePresentation = {
  label: string;
  width: number;
  height: number;
  fontSize: number;
  borderColor: number;
};

export function buildingBadgePresentation(taskNumber: number, stage: number): BuildingBadgePresentation {
  const label = String(taskNumber);
  return {
    label,
    width: Math.max(8, label.length * 4 + 2),
    height: 8,
    fontSize: 6,
    borderColor: BUILDING_STAGE_COLORS[Math.max(0, Math.min(BUILDING_STAGE_COLORS.length - 1, stage - 1))]!,
  };
}
