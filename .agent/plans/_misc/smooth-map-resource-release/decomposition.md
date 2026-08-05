# Decomposition verdict

- Recommended shape: один координированный release PR с внутренними review gates.
- Reason: chunk lifecycle, texture cache и CSP должны переключиться атомарно; отдельный deploy любого из них оставит чёрные кадры или console errors. Compose budget безопасно добавляется в тот же релиз.
- Main risk: регрессия памяти при сохранении старого ground.

## Gates

1. **Map pipeline** — progressive retain/swap, LOD identity, bounded cache and regression tests.
2. **Assets and UX** — complete preload contract, CSP capability check, controls/dialog feedback.
3. **Operations** — Tasktopia resource budget, shared-load proof, backup/deploy.
4. **Finish** — code review, stale/docs audit, full verification.

## Rejected splits

- CSP отдельно от asset lifecycle: уберёт лог, но не black frames.
- Cache отдельно от request scheduler: сохранит повторные запросы или stale LOD.
- UI controls отдельным релизом: слишком мало ценности относительно дополнительного production rollout.
