# Architecture

- Keep chunk streaming and server-generated deterministic world state unchanged.
- Put pure render decisions in testable helpers; Pixi remains an adapter.
- Derive visual variants from stable world/city/district seeds, never runtime randomness.
- Represent decorative wildlife as bounded client agents; do not persist or transmit them as tasks.
- Treat catalog quotas and bridge portal validity as server invariants.
