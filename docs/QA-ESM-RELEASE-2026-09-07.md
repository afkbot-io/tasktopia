# RELEASE14: загрузка каталога в Node ESM

CI34106503580 на737be387 прошёл assets, types, lint, unit, build и MCP smoke,
но остановился при collection E2E, до запуска браузерных сценариев.
`src/shared/catalog.ts` импортировал JSON без обязательного для Node ESM
атрибута `with { type: "json" }`. Vite/Vitest ранее скрывали проблему своим
преобразованием JSON; module-level test.skip не предотвращает загрузку imports.

Исправлена одна строка каталога. Арт, manifest, runtime-данные, миграции,
права доступа, список/ожидания браузерных тестов и deployment guards не менялись.

## Проверка

- Полный `npx playwright test --list`: исходный RED/0 тестов,
  после исправления GREEN/72 сценария в34 файлах. Collection не является E2E PASS.
- Новый `tests/catalog-node-esm.test.ts` запускает настоящий дочерний Node
  без Vite/tsx-loader: на старом import воспроизведён
  `ERR_IMPORT_ATTRIBUTE_MISSING`, на исправленном проверяются загрузка каталога,
  content revision и5 стадий конкретного здания.
- `npm run typecheck`, scoped ESLint и `npm run build` после изменения import
  прошли на Node24.19.0. Это host build без production STATIC_ORIGIN,
  не новый проверенный production image.

Полный CI нового коммита и реальная browser execution должны пройти до merge.
Репетиция реальных данных ранее выполнена на неизменённом runtime image6ab064c3;
замена import сама по себе не означает новый backup, deployment или проверку CDN.
Первый contract cutover остаётся отдельной инфраструктурной доработкой со
своими recovery-тестами и review. Прямого production запуска здесь нет.
