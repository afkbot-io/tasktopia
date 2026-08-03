# Generation prompts

Режим: встроенный `imagegen`. Каждый базовый концепт сгенерирован отдельным вызовом. `grass` использован как стилевой якорь остальных изображений.

Общий промпт:

```text
Production square tile for a strict top-down web city-builder. Polished handcrafted pixel art, muted moss palette, crisp deliberate pixel clusters, readable at 192×192. Terrain fills the entire square edge-to-edge. Strict 90-degree overhead orthographic view. No margin, border, grid line, horizon, tilt, isometric angle, perspective scaling, visible side faces, neon colors, blur, text, UI or watermark.
```

Базовые концепты:

```text
grass: calm moss-green grass, restrained tufts and sparse desaturated flowers.
forest: compact mixed deciduous and conifer canopy cluster, crowns only.
rocks: four restrained clusters of weathered grey-brown stones viewed directly above.
water: full deep lake-water square with muted teal pixel ripples.
road-straight: two-lane asphalt W↔E, constant width, curbs and dashed center line.
road-curve: smooth constant-width road W↔N.
river-straight: narrow natural river N↔S with thin earth banks.
river-curve: natural river bend N↔E.
bridge: road W↔E over river N↔S, all four ports centered.
building: blue-roof civic building on a small stone plaza, roof plan only.
```

После генерации скрипт:

1. нормализует каждый тайл до `192×192`;
2. находит фактический центр дороги или воды у края;
3. мягко переносит его в координату `96 px`;
4. создаёт остальные ориентации точным поворотом на 90°;
5. проверяет каждый контракт `N/E/S/W`.
