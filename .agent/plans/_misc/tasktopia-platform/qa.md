# QA state and next matrix

> **Geometry update 2026-08-02:** hex-проверки ниже относятся к старому прототипу. Актуальный square-grid QA находится в `../square-world-generation-v3/qa.md`.

## Automated now

- axial line connectivity, reciprocal directions and negative chunk division;
- external-only polyhex perimeter;
- project mutation idempotency and conflicting payload rejection;
- reciprocal stored road masks;
- 14-cell connected district and five status stages;
- sprint SP capacity and skipped-stage rejection;
- tenant isolation for task reads;
- raw MCP token absence from storage;
- building keys, palette values and connected/unique footprints;
- Playwright login, canvas, building click, task modal, token creation;
- Playwright registration → automatic empty country;
- desktop and narrow viewport with zero unexpected console errors;
- official MCP client tool discovery and `country.get_current` call;
- production Docker image startup, `/health`, static page and security headers.

## Manual visual evidence

- `screenshots/mvp-city-desktop.png` — stitched road, platforms, external district border and five stages;
- `screenshots/mvp-task-modal.png` — task fields and comments;
- `screenshots/mvp-city-mobile.png` — recentered narrow map.

## Required before public beta

- registration/login abuse test and longer rate-limit soak;
- token revoke followed by rejected MCP call;
- malformed/oversized payload and invalid Origin integration suite;
- multi-city seeds with bridge and long-road topology properties;
- concurrent mutation and placement stress after PostgreSQL migration;
- WebSocket disconnect/recovery and event gap replay;
- 2,000-sprite/16-chunk FPS and memory profile;
- keyboard/focus-trap and screen-reader accessibility audit;
- sprite atlas anchor, palette and perceptual regression validation;
- backup/restore rehearsal and migration rollback.
