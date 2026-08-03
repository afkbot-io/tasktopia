# Square World Generation V3 — источники

## Внешние первичные источники

- Robert Bridson, *Fast Poisson Disk Sampling in Arbitrary Dimensions*: https://www.cs.ubc.ca/~rbridson/docs/bridson-siggraph07-poissondisk.pdf
- Richard Barnes, Clarence Lehman, David Mulla, *Priority-Flood*: https://rbarnes.org/sci/2014_depressions.pdf
- Maxim Gumin, original WaveFunctionCollapse repository: https://github.com/mxgmn/WaveFunctionCollapse
- Auburn, FastNoiseLite official repository: https://github.com/Auburn/FastNoiseLite
- D3 Delaunay official documentation: https://d3js.org/d3-delaunay/delaunay
- PostGIS official manual (spatial indexes and geometry storage): https://postgis.net/docs/

## Локальные источники и ограничения

- `src/server/world/hex.ts`: историческая axial hex-топология; удалена из production tree после перехода на `grid.ts`.
- `src/server/world/terrain.ts`: текущий coordinate-hash/noise прототип с четырьмя terrain types.
- `src/server/app-service.ts`: текущие `CHUNK_SIZE=12`, `CITY_RADIUS=3`, `CITY_SPACING=28`, `DISTRICT_CELL_COUNT=14` и линейные дороги.
- `src/shared/contracts.ts`: ранее использовал `Hex {q,r}`; теперь содержит квадратный `Cell{x,y}`.
- `src/shared/catalog.ts`: ранее содержал небольшой hex-footprint каталог; теперь типизирует V4 manifest.
- `assets/pixel-city-pack-v3/manifest.json`: целевой квадратный 8×8 asset contract.

## Выводы исследования

- Poisson-disc полезен как генератор равномерно разнесённых кандидатов городов, но пригодность площадки всё равно решает scoring/constraints.
- Priority-Flood полезен для корректной обработки стока coarse elevation grid, но художественные озёра задаются отдельно.
- Delaunay даёт разреженный набор разумных межгородских связей; MST и дополнительные рёбра задают итоговую топологию.
- FastNoiseLite даёт глобальные 2D noise/domain-warp поля; они не заменяют графовые алгоритмы связности.
- WFC гарантирует локальные соседства образцов и может прийти к contradiction; поэтому его область — локальный декор/parcel patterns, не национальные дороги и не lifecycle района.
