# Block-v1 production terrain evidence

Дата проверки: 2026-09-04.

Источник: официальный production `https://tasktopia.online`, asset revision
`f6c2d2d876b94c5b`. Production manifest публикует три варианта `GRASS`, три
варианта `FOREST` и три варианта `SAND` по `8×8 px`.

Побайтовое сравнение с `assets/pixel-city-pack/runtime` в интеграционной ветке:

| Asset | SHA-256 |
| --- | --- |
| `terrain/grass-0.png` | `62b900d47d9fd820c1b6fbc72130d3af1f84613efdf3cdafcb2d258a3772a08c` |
| `terrain/grass-1.png` | `1f6672463153de3b323cc9554336c70d03c63d5e0faaf9bd8f754d36a0ab2911` |
| `terrain/grass-2.png` | `3e5d593a23b2ab8fe516f3b079cdcf2d01b266c8b04881d59c49f1994403ca3a` |
| `terrain/forest-0.png` | `55524fbcbee2f40f6b8f530caae6a2efc5eaed3cee7f204a647566f99b454718` |
| `terrain/sand-0.png` | `f69296837dc3ed38dae507d2fa6da51ca27966910be6411950736dfc645b4446` |
| `tiles/grass.png` | `62b900d47d9fd820c1b6fbc72130d3af1f84613efdf3cdafcb2d258a3772a08c` |

Все сравнения совпали. Эти PNG создаются детерминированной функцией
`terrain_tile()` в `scripts/build-pixel-city-pack.py`; runtime AI не участвует.

В block-v1 исходный production-тайл сохраняется в нативном размере и покрывает
группу `2×2` новых логических клеток по `4 px`. Это сохраняет рисунок и палитру
без downscale. Дороги, тротуары и квартальная геометрия используют профиль
`block-v1-city-v1`.

Браузерное доказательство:
`screenshots/block-v1-production-grass-city.png`.
