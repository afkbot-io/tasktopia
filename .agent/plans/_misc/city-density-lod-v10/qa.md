# Preconditions

- Deterministic demo country and browser fixture.
- One-city/ten-district scale fixture run separately.

# Positive scenarios

- First login shows “Готовим карту…” until the first painted chunk.
- Pan and LOD transition retain the old map and show “Подгружаем карту…”.
- Overview shows major roads and compact minor paths; service props are absent.
- Multiple newly generated districts have different path silhouettes and dense lots.

# Negative scenarios

- Failed chunks keep rendered ground and expose retry.
- Rapid zoom reversal does not leave the loader stuck.
- Overview never requests detail asset sprites.

# Logs / audit checks

- No CSP, missing-cache, unhandled promise, or Pixi errors.
- Resident chunks and cache sizes stay inside current limits.

# Expected results

No blank canvas, no repeated three-line-only district skeleton, no overview infrastructure noise, and no performance regression.
