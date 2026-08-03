# Decomposition

## Decomposition Verdict

- Recommended shape: hybrid, четыре проверяемых среза в одной рабочей ветке.
- Main risk: художественная согласованность 100 стадий.

## Dependency graph

`S1 -> S2 -> S4`

`S1 -> S3 -> S4`

## Slices

1. **S1: Grid contract and modular terrain**
   - Поверхности 8×8, мост, переходы, разметка и документация контракта.
   - Проверка: точные размеры, отсутствие intersection-ассета.
2. **S2: Residential vertical set**
   - Пять высоток и пять малых домов, по пять стадий.
   - Зависит от S1; проверка: 50 уникальных спрайтов и стабильные anchors.
3. **S3: Commercial, civic and transport set**
   - Четыре длинных здания, шесть специальных зданий, четыре машины в двух направлениях.
   - Зависит от S1; проверка: 50 стадий и 8 автомобильных спрайтов.
4. **S4: Runtime pack and city proof**
   - Атлас, manifest, каталоги, AI-placement guide, городская сцена.
   - Зависит от S2 и S3.

## Rejected split

- Отдельный PR на каждое здание: слишком много искусственных срезов без самостоятельной ценности.

