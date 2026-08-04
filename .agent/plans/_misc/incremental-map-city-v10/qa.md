# QA

## Preconditions

- Seed a disposable database.
- Use a 1440×900 desktop viewport and one mobile viewport.

## Scenarios

1. Warm the map, drag within one chunk range, and verify no fetch/rebuild count changes.
2. Cross a chunk boundary and verify only added/removed chunk records change.
3. Zoom to overview and verify detailed terrain/entity counts fall sharply.
4. Create a task and change its status; verify camera remains stable and only affected chunks reload.
5. Hide/show the tab and move the canvas offscreen; animation marker must pause/resume.
6. Generate one city with ten districts and audit road connectivity, overlap, access, zoning and asphalt ratio.
7. Run opt-in large and soak checks separately, never concurrently with the standard gate.

## Expected result

No full-scene teardown during ordinary map use, no console errors, bounded resident chunks and smooth input response after warm-up.
