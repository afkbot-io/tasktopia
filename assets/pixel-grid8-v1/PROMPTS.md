# Building generation prompts

Магазины сгенерированы встроенным `imagegen`. Приложенный пользователем sprite sheet использован только как стилевой референс. Микротайлы земли созданы детерминированно, поскольку генератор не может гарантировать точное расположение каждого пикселя на холсте `8×8`.

Общие требования к магазинам:

```text
Source artwork for a tiny 32×16 pixel storefront sprite. Match the supplied compact retro pixel-art grammar: dark blue outlines, large readable color clusters and cyan or warm glass highlights. One isolated horizontal storefront, 2:1 target ratio, flat #ff00ff chroma-key background, no terrain, sidewalk, shadow, text, logo, neighboring objects, realism, gradients, blur or watermark. The facade must remain readable after deterministic reduction to 32×16 pixels.
```

Варианты:

```text
grocery: teal roof fascia, pale facade, two cyan windows, centered teal door, striped awning.
bakery: coral-red fascia, cream facade, two amber windows, off-center red door, striped awning.
```

После генерации фон удалён, изображения уменьшены до `32×16`, палитра ограничена 24 цветами, а альфа-канал переведён в жёсткую пиксельную маску.
