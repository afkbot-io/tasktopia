# References and decisions

## Внешние источники

- MengTo/Skills: https://github.com/MengTo/Skills
- MCP Streamable HTTP: https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
- MCP Authorization: https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization
- PixiJS performance: https://pixijs.com/8.x/guides/concepts/performance-tips
- PixiJS culling: https://pixijs.com/8.x/guides/components/application/culler-plugin
- PixiJS scene graph: https://pixijs.com/8.x/guides/concepts/scene-graph
- Socket.IO rooms: https://socket.io/docs/v4/rooms/
- Socket.IO connection state recovery: https://socket.io/docs/v4/connection-state-recovery/
- Better Auth API Key: https://better-auth.com/docs/plugins/api-key
- Better Auth email/password: https://better-auth.com/docs/authentication/email-password

## Установленные skills из MengTo/Skills

- `/Users/kikasnikita/.codex/skills/build-hybrid-game-assets`
- `/Users/kikasnikita/.codex/skills/design-first-ui-prompting`
- `/Users/kikasnikita/.codex/skills/test-playable-web-games`
- `/Users/kikasnikita/.codex/skills/optimize-web-animations`

Они станут автоматически доступны Codex со следующего пользовательского запроса.

## Релевантные текущие файлы

- `/Users/kikasnikita/Documents/Game3.0/assets/hex-sprite-pack-v1/manifest.json`
- `/Users/kikasnikita/Documents/Game3.0/assets/hex-sprite-pack-v1/preview.png`
- `/Users/kikasnikita/Documents/Game3.0/assets/hex-sprite-pack-v1/examples/small-city.png`
- `/Users/kikasnikita/Documents/Game3.0/tools/build_sprite_pack.py`
- `/Users/kikasnikita/Documents/Game3.0/tools/build_city_example.py`

## Принятые решения

- 2D/PixiJS вместо 3D.
- Axial flat-top hex grid.
- Base world по seed, overlay state в БД.
- Chunk `32 × 32`.
- Road geometry процедурная, AI не определяет соединения.
- Building sprite не содержит terrain.
- UI read-only для work entities; MCP — write surface.
- HTTP snapshot + WebSocket deltas.
- Один active sprint на project в MVP.
- Одна country на user в MVP.

## Open questions перед реализацией

1. Рабочее название: Tasktopia или другое?
2. Нужна ли регистрация по email/password в первом локальном MVP, или сначала достаточно local single-user auth?
3. Sprint capacity 14 SP — hard limit или warning с автоматическим расширением до 26?
4. Должен ли `project.create` возвращаться сразу с operation или ждать город до нескольких секунд?
5. Нужен ли AI semantic classifier внутри платформы, или building hints всегда передаёт MCP-клиент?
6. Разрешено ли одному task занимать несколько независимых micro-buildings, или только один связный footprint?
7. Какая первая целевая интеграция MCP: Codex, Claude Desktop, Cursor или собственный агент?

