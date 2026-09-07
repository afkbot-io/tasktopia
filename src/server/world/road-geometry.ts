/** Integer cell offsets shared by the compact road/transit profile. */
export function centeredRoadOffsets(width: number): number[] {
  if (!Number.isInteger(width) || width < 1) throw new Error(`Invalid road width: ${width}`);
  const start = -Math.floor(width / 2);
  return Array.from({ length: width }, (_, index) => start + index);
}
