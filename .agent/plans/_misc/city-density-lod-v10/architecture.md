# Current boundary

The server emits one real frontage road but every lot publishes a three-row parallel pedestrian skeleton. Overview omits all surfaces and renders every persisted feature.

# Target boundary

`block-planner` owns deterministic compact access topologies. `getChunk(OVERVIEW)` emits only semantic path summaries. `WorldCanvas` owns LOD styling and excludes detailed feature sprites outside detail mode. Existing rendered chunks remain visible while replacements stream.

# Alternatives considered

- More asphalt branches: rejected because it recreates empty roads.
- Full detail surfaces in overview: rejected due payload and CPU cost.
- Blocking overlay on every pan: rejected because it hides usable ground.

# Rollout / rollback

Existing districts keep persisted lot geometry. New districts use the new planner; regenerated countries adopt it fully. Roll back the release if chunk payload or map-streaming checks regress.
