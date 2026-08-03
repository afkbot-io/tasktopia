# Generation prompts

Режим: встроенный `imagegen`. Для каждого концепта использовался отдельный вызов. Первый `grass` стал стилевым якорем для остальных изображений.

Общие ограничения всех промптов:

```text
Premium handcrafted pixel-art game sprite. Perfectly vertical 90-degree overhead orthographic camera. Exactly one centered geometrically regular pointy-top hex. Flat solid #ff00ff chroma-key background. No horizon, no tilt, no isometric angle, no perspective, no visible side faces, no yellow outline, no text, no UI, no blur, no watermark.
```

Концепты:

```text
grass: spring-green grass, tiny restrained tufts, sparse flowers, flat surface.
forest: same grass plus compact deciduous and conifer canopy cluster, all trees read from their crowns directly above.
rocks: same grass plus distinct grey-brown stone clusters seen directly above, no cliff faces.
water: deep-blue full-water hex with small top-down pixel ripples, no shore.
road-straight: constant-width horizontal two-lane asphalt road from exact W midpoint to exact E midpoint, narrow stone curbs, restrained dashed center line.
river-straight: gently meandering river with thin earth banks, intended for NW-to-SE connection.
building: independent warm-brick civic townhouse/library, only a coherent blue slate roof plan, chimney top, roof windows, hexagonal stone platform and small shrubs; no facade.
```

После генерации chroma-key удалён локально, а изображения принудительно нормализованы общей точной маской. Поэтому runtime-геометрия не зависит от геометрических погрешностей генератора.
