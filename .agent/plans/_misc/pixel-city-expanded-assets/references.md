# References

- `scripts/process-pixel-city-pack-v3.py`
- `assets/pixel-city-pack-v3/manifest.json`
- `assets/pixel-city-pack-v3/docs/GENERATION-GUIDE.md`
- `screenshots/pixel-city-v3-commercial.png`
- `screenshots/pixel-city-v3-house.png`
- `screenshots/pixel-city-v3-civic.png`
- Пользовательский референс: компактный фронтальный пиксель-арт, сетка 8 px.

## Decisions

- Один MR/PR-срез достаточен: source, processor, manifest и proof сцена образуют одну атомарную поставку.
- Генерация выполняется built-in image tool, chroma удаляется локально.

