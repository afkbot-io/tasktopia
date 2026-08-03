# Target architecture

## Current boundary

`WorldCanvas.tsx` currently owns asset loading, Pixi application lifetime, camera input, chunk networking, all layer construction, routing graphs, and agent simulation in one React effect.

## Target boundary

### `WorldViewport`

- Owns only the long-lived Pixi `Application`, camera transform, resize, visibility, and input adapters.
- Created once per mounted country and not recreated for ordinary task progress or focus changes.
- Receives narrow commands: `focus(bounds)`, `setDistrictVisibility(value)`, `applyWorldDelta(delta)`, and `dispose()`.

### `ChunkStore`

- Keeps stable raw DTO keys as `countryId/chunkX/chunkY`; global `worldVersion` is an event cursor and must not invalidate every chunk.
- Tracks separate `rawRevision`, `staticRevision`, and `entityRevision` per chunk or derives a stable hash from the relevant payload.
- Separates `visible`, `preload`, `pending`, and `cached` ranges.
- Limits network concurrency, aborts stale requests, and never requests an already cached version.
- Uses separate budgets: roughly 96–160 raw DTO chunks but only 32–48 detailed GPU chunk textures. GPU resources are disposed independently of raw DTOs.

### `StaticChunkRenderer`

- Bakes terrain, shore transitions, roads, sidewalks, paths, and noninteractive ground overlays into one or a small fixed number of RenderTextures per chunk.
- Emits one/few sprites per chunk rather than one sprite per cell.
- Re-bakes only when the chunk world version or relevant static data changes.
- Uses nearest-neighbor sampling and integer pixel placement.
- Produces one full-detail 512×512 texture per 64×64-cell chunk, not separate full-size textures for every ground layer. One RGBA texture is approximately 1 MiB before overhead.
- Produces an optional 128×128 region texture; country view uses a coarser aggregate rather than retaining every detailed GPU texture.
- Adds a one-cell neighbor gutter or deterministic edge masks so rivers, shores, and roads have no seams between cached chunks.

### `EntityRenderer`

- Owns buildings, task platforms, features, decorations, and district outlines by stable id.
- Diffs add/update/remove operations instead of clearing layers.
- Keeps construction badge and click hit area separate from static art.
- Disables event mode on every noninteractive layer.

### `MobilitySimulation`

- Keeps cars and walkers in separate arrays with precomputed numeric adjacency.
- Runs a fixed 30 Hz simulation and interpolates position; pauses at overview LOD and when the canvas is offscreen/hidden.
- Reuses scratch arrays and avoids per-frame string keys and filters.
- Rebuilds only the graph segments changed by chunk/entity deltas.
- Owns agent identity and progress independently of any visible Sprite. LOD hides or detaches the view but never recreates the simulation record.

### `PerformanceProbe`

- Development-only counters: FPS, p95/max frame, display objects, draw calls when available, resident/preloaded/cached chunks, agents, chunk fetches, bake time, reconciliation time, and heap when exposed.
- Exposes deterministic data attributes for Playwright without adding a production overlay.

## Camera and loading sequence

1. Pointer/wheel events are coalesced into one camera transform per RAF.
2. Camera movement only changes the persistent world RenderGroup transform; it never awaits network, mutates DTOs, redraws cached blocks, or restarts agents.
3. The viewport computes its chunk range after the transform.
4. If the range is unchanged, nothing else happens.
5. If changed, visible cached chunk sprites are toggled immediately; leaving chunks are hidden and retained until GPU-LRU eviction rather than destroyed.
6. Missing preload chunks enter a bounded fetch queue.
7. Completed chunks are baked once, inserted, and retained by the LRU.

## LOD

| Level | Scale | Content |
| --- | ---: | --- |
| Detail | `>= 1.5` | Full buildings, props, construction badges, up to 16 cars and 48 walkers in viewport |
| City | `0.9–1.5` | Buildings and key props; no tiny clutter; up to 10 cars and 24 walkers |
| Region | `0.55–0.9` | Terrain, water, collectors/highways, simplified block silhouettes; no agents or tiny props |
| Country | `< 0.55` | Coarse terrain, main rivers/highways, labels, cities as colored square clusters and districts as optional colored subclusters |

Thresholds are configuration, not hard-coded branches scattered through render code. LOD changes visibility/representation only. The simulation state survives every transition.

## Renderer technology gate

- Default: Pixi RenderGroup for the persistent world plus explicit `renderer.generateTexture()` chunk baking.
- Benchmark alternative: `@pixi/tilemap` 5 `CompositeTilemap`, compatible with PixiJS 8 and suitable for a 4096-tile chunk.
- Compare 60 chunks on frame time, JS/GPU memory estimate, first bake, one-road-cell update, cache return, and disposal. Adopt tilemap only if evidence beats the simpler RenderTexture design.

## Texture delivery

- Pack terrain/road tiles into one spritesheet and buildings into category/stage atlases.
- Load stage 5 plus currently visible construction stages first; lazily load other stages.
- Preserve manifest key, footprint, anchor, stage order, and provenance through atlas generation.
- Add a maximum texture dimension check and separate atlases before reaching mobile GPU limits.

## Realtime updates

- A socket event carries affected ids/bounds and world version.
- Fetch only changed task/entity/chunk data when possible.
- React UI bootstrap may refresh independently, but it must not own the renderer lifetime.
- Remove the double invalidation (`load()` followed by `revision++`) for one event.

## Block placement model

Extend planned lots into `BlockGroup` metadata:

- `groupId`, `pattern`, `facadeFamily`, `slotIndex`, `slotCount`, `frontageSide`, `sharedAccess`, and `allowedCategories`.
- `DENSE_ROW`: 3–5 adjacent slots, 0–1-cell horizontal gaps, common platform/front sidewalk, aligned baseline.
- `DENSE_COURTYARD`: 3–4 wings around a shared open area where space permits.
- `PRIVATE_ROW`: 4–10 house slots along one street side, deterministic 1–3-cell gaps, shared architectural family with controlled color variants.
- `PRIVATE_TWO_SIDED`: paired house rows along a local street when district depth permits.
- `CIVIC_ANCHOR` and `COMMERCIAL_STRIP` remain sparse and road-access oriented.

Task creation fills a compatible reserved slot. Expansion plans a complete new block group before mutating roads/lots. Existing completed footprints never move.

## Authentication state machine

`INITIALIZING → ANONYMOUS → AUTHENTICATING → LOADING_COUNTRY → AUTHENTICATED`

Any network/bootstrap failure enters `RECOVERABLE_ERROR` with retry. Logout returns to `ANONYMOUS`. `AuthScreen` awaits the full authenticate-plus-bootstrap operation.

Server behavior:

- Precheck normalized email before expensive password hashing.
- Keep the database unique constraint as the race-safe final guard.
- Map any `users.email` unique violation to `DomainError(CONFLICT)`.
- Make cookie name configurable and use a version-specific local default.
- Use a `__Host-` cookie name in secure production, with Path=/ and no Domain.
- Periodically prune expired sessions and optionally cap active sessions per account.

## Alternatives considered

- **Only debounce input:** rejected; it reduces rebuild frequency but still leaves 245k+ display objects and long stalls.
- **Only Pixi culling:** rejected; invisible objects still consume memory and full rebuild cost remains.
- **Canvas 2D rewrite:** not required yet; Pixi remains suitable if static tiles are baked and entities are incremental.
- **One giant world texture:** rejected; it does not scale with country growth and complicates updates/GPU limits.

## Rollout and rollback

- Keep old renderer behind `VITE_WORLD_RENDERER=legacy` until V8 passes parity tests.
- New sprite keys may replace files in place only after geometry validation; otherwise version keys and migrate catalog hints.
- Enable block patterns for new districts first. Existing districts keep their stored lots.
- Auth fix is backward compatible with current sessions; cookie-name migration should accept old cookie for one release or deliberately log users out with a release note.
