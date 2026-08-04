# Decomposition

Single stacked change is recommended because the shared BootstrapDto cannot be changed independently from server routes and client consumers.

1. Contract/routes: additive plan summaries, then switch bootstrap shape.
2. Client: migrate map, counters and PlanDrawer.
3. Cleanup/tests/docs: remove large profiles and stale full-world assumptions.

The slices are not independently mergeable after the bootstrap switch; verification occurs at the final boundary.
