# Architecture

## Current boundary

`BuildingSpec` определяет canvas, footprint, категорию и источник. Сборщик делит исходный пятикадровый лист, нормализует каждый кадр и упаковывает runtime PNG в общий atlas. Props сейчас частично переиспользуются из V2.

## Target boundary

- Новые здания добавляются только новой записью `BuildingSpec` и source PNG.
- Новые props имеют явный `PropSpec`: runtime size, source segment и anchor.
- Manifest описывает props так же явно, как buildings и vehicles.
- Сцена использует только runtime assets, не source sheets.

## Alternatives considered

- Рисовать декор прямо на terrain: отклонено, объект нельзя будет переставлять.
- Делать парковку частью road tiles: отклонено, это самостоятельная задача-здание.
- Создавать отдельную текстуру на каждый цвет: отклонено для текущего MVP, вариативность позже можно получить палитрами.

## Rollout and rollback

Добавления не меняют id существующих кадров. Откат выполняется удалением новых specs/source без миграции сохранений, пока новые id не опубликованы.

