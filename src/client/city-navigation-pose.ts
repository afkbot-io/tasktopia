/** A previous renderer/session cannot overwrite a newer restored camera. */
export function acceptsCityNavigationPose(
  epoch: number, restoreToken: number | undefined,
  currentEpoch: number, expectedRestoreToken: number | undefined,
): boolean {
  return epoch === currentEpoch && restoreToken === expectedRestoreToken;
}
