# Prompt contract and generated families

Графические исходники созданы встроенным `imagegen`; прозрачность получена через chroma-removal. Runtime PNG созданы детерминированным сборщиком.

## Общий шаблон здания

```text
Use case: stylized-concept
Asset type: five-frame construction sprite sheet for an 8px-grid pixel city game
Primary request: exactly five sequential stages of the SAME <building>:
marked dirt lot, foundation, structural frame, nearly complete building with scaffolding, finished building.
Final runtime intent: identical <W×H> pixel canvas per stage, bottom-center anchor.
Reference: the supplied Tasktopia V3 catalog strictly controls handcrafted 16-bit pixel art,
frontal camera, hard pixel clusters, dark blue-grey outline, limited palette and no antialiasing.
Scene: perfectly flat uniform #ff00ff chroma background.
Composition: exactly five isolated sprites in one horizontal row, equal fifths,
same baseline, center and footprint, no labels, arrows, panels or separators.
Avoid text, logos, people, vehicles, shadows, gradients, smoothing and watermark.
```

## Семейства и canvas

- Высотки: `highrise-glass 32×64`, `highrise-brick 32×72`, `highrise-stepped 40×64`, `highrise-corporate 40×72`, `highrise-landmark 48×80`.
- Малые дома: `house-cottage 16×24`, `house-townhouse 16×32`, `house-gabled 24×24`, `house-duplex 24×32`, `house-small-apartments 32×32`, `house-bungalow 24×24`, `house-suburban-narrow 24×32`, `house-garden-villa 32×32`, `house-modern-compact 24×32`, `house-rustic-cottage 32×24`.
- Коммерческие: `shop-supermarket 40×16`, `shop-bakery-long 48×16`, `shop-mall 56×24`, `shop-warehouse 48×24`, `commercial-gas-station 48×24`, `commercial-parking-lot 48×24`, `commercial-shopping-plaza 56×24`, `commercial-corner-cafe 32×24`, `commercial-pharmacy 32×24`, `commercial-auto-repair 40×24`.
- Специальные: `civic-clinic 40×32`, `civic-fire-station 48×32`, `civic-police 40×32`, `civic-bank 32×32`, `civic-school 48×40`, `civic-city-hall 48×40`, `civic-post-office 40×32`.

## Декор

Каждый prop генерируется отдельно на равномерном `#ff00ff`, без травы, pavement и тени. Prompt явно задаёт конечный runtime canvas и требует сильный силуэт на масштабе 1×. Для скамейки одним листом созданы две согласованные проекции 8×16 и 16×8; остальные предметы имеют собственные source-файлы. В сборщик добавлены урна, контейнер переработки, клумба, гидрант, почтовый ящик, боллард, велопарковка, фонтан, остановка и стол для пикника.

## Машина

Сгенерирован один компактный hatchback в двух согласованных проекциях на chroma-фоне. Камера слегка наклонена: в обеих проекциях читаются крыша, стекло и передняя часть. Вертикальная версия независимо нормализуется до 8×16, горизонтальная — до 16×8; механический поворот запрещён. Четыре цвета получаются детерминированной заменой палитры без изменения альфа-маски каждой проекции.
