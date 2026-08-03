# References

- `assets/pixel-grid8-v2/` — текущая палитра и sprite grammar.
- `screenshots/pixel-grid8-v2-catalog.png` — строгий визуальный reference.
- `scripts/process-pixel-grid8-v2.py` — текущий deterministic post-processing.
- Решение пользователя: базовая клетка всегда 8×8; дороги и мосты собираются из тайлов.

## Open questions resolved by assumption

- Специальные здания: клиника/скорая, пожарная часть, полиция, банк, школа, мэрия.
- Длинные здания также получают пять стадий, поскольку являются задачами.
- Строительный footprint определяется canvas в клетках и может быть уточнён позже отдельным occupancy mask.

