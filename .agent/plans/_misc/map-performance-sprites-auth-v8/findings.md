# Audit findings

## 1. Map performance

### Blocking causes

1. **Full rebuild per viewport reconciliation.** `render()` clears ten layers, destroys their children, recreates maps, sprites, graphics, text badges, routes, and moving agents for all resident chunks.
2. **Reconciliation is coupled to input frequency.** Dragging schedules a load on almost every pointer frame, and each wheel event immediately starts a load.
3. **One sprite per 8×8 static cell.** Sixty 64×64 chunks already mean 245,760 terrain sprites. Road, sidewalk, platform, feature, and district objects are additional.
4. **No LOD or visual culling.** Overview renders the same small props, agents, badges, and detailed terrain as close zoom.
5. **Immediate cache eviction.** Raw chunks outside the current wanted set are deleted, so short reverse pans can refetch and rebuild them.
6. **Renderer lifecycle tied to React data identity.** `bootstrap`, focus objects, and `revision` can recreate the whole Pixi `Application`; one socket event currently updates bootstrap and revision separately.

### Secondary costs

- All building stages are preloaded even when only a small subset is visible.
- Static containers participate in event traversal unless explicitly disabled.
- The ticker allocates `walkers`, candidate arrays, keys, and direction objects every frame.
- Agent graphs use string-keyed maps and are rebuilt with the scene.
- `resolution: min(devicePixelRatio, 2)` can render a 1440×900 viewport at 2880×1800.
- District boundary geometry is regenerated for every render even when hidden.
- Chunk requests are one HTTP request per chunk with no concurrency queue, abort policy, or versioned LRU.

## 2. Sprite cohesion

The catalog mixes a strict frontal orthographic family with pitched-roof perspective houses, different outline density, inconsistent top-plane depth, inconsistent light direction, and different detail scale. The mismatch is strongest where a 16–32 px private house sits beside the original high-rises.

The five original high-rises are the visual anchors. Private houses must be redrawn to their grammar rather than asking the high-rises to adapt to the newer reference sheet.

Construction stages also need attention: several stage 1–4 silhouettes are generic size templates and do not convincingly develop into the stage-5 massing.

## 3. District layout

The zoning code selects compatible categories, but placement remains lot-by-lot and optimizes unused lot area. It has no concept of a facade family, shared frontage, building row, courtyard group, repeated housing kit, or planned cluster. That prevents believable 3–5-building dense runs and coherent private streets.

## 4. Authentication

### Verified working

- Valid demo login: 200.
- Authenticated bootstrap: 200.
- Invalid password: 401 with `Неверный email или пароль`.
- Unique browser registration: passed in 1.2 seconds and created an empty country.
- Session cookie is HttpOnly, SameSite=Lax, Path=/, with a 30-day max age.

### Confirmed defect — fixed in the planning turn

- Duplicate registration previously returned 500 `Внутренняя ошибка сервера`; it now returns 409 `Аккаунт с таким email уже существует`.
- Node SQLite exposes this as `ERR_SQLITE_ERROR`, not the currently expected constraint-specific code.

### UX weaknesses and current status

- Bootstrap failures are now surfaced with a retry action instead of being swallowed.
- `AuthScreen` now awaits country bootstrap before completing authentication.
- Authentication state is inferred from three booleans/data values instead of one explicit state machine.
- Expired sessions are never pruned during normal auth activity.
- Cookie name remains hard-coded instead of being environment-specific; this stays in the V8 auth hardening scope.
