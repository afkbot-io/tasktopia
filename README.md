<p align="center">
  <img src="public/social-card.png" alt="Tasktopia — цифровая страна" width="900">
</p>

<h1 align="center">Tasktopia</h1>

<p align="center">
  <strong>Open-source задачник для людей и AI-агентов, в котором работа становится живым пиксельным городом.</strong>
</p>

<p align="center">
  <a href="https://tasktopia.online">Открыть Tasktopia</a> ·
  <a href="https://tasktopia.online/ai.md">Инструкция для AI</a> ·
  <a href="docs/MCP.md">MCP</a> ·
  <a href="docs/DEPLOYMENT.md">Self-hosting</a>
</p>

<p align="center">
  <a href="https://github.com/afkbot-io/tasktopia/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/afkbot-io/tasktopia/actions/workflows/ci.yml/badge.svg"></a>
  <a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-f2c94c.svg"></a>
  <img alt="Node.js 24+" src="https://img.shields.io/badge/Node.js-24%2B-5fa04e.svg">
  <img alt="PostgreSQL 16" src="https://img.shields.io/badge/PostgreSQL-16-4169e1.svg">
  <img alt="MCP Streamable HTTP" src="https://img.shields.io/badge/MCP-Streamable_HTTP-55a6c5.svg">
</p>

> **Обращение главы государства**
>
> Граждане устали жить в колонках «To do», «In progress» и «Done». Министры не видят масштаб стройки, а AI-агенты теряют контекст между сессиями. Поэтому мы основали Tasktopia: здесь проект получает территорию, спринт становится районом, а каждая задача оставляет в мире понятный след.
>
> Когда работа начинается — появляется стройплощадка. Когда идёт тестирование — здание почти готово. Когда найден критический дефект — над крышей поднимается дым и выезжает пожарная машина. Так прогресс снова становится видимым.

![Реальный showcase-мир Tasktopia: Республика Аврора](screenshots/tasktopia-showcase.png)

<sub>Это не концепт-арт. Кадр воспроизводимо снят Playwright из настоящего PixiJS-клиента: 1 страна, 1 город, 4 района, 40 задач, пять стадий строительства, хотфикс и активные дефекты.</sub>

## Надоел канбан для AI?

Обычная доска хорошо отвечает на вопрос «в какой колонке карточка», но плохо показывает другое:

- насколько вырос проект и где сейчас сосредоточена работа;
- какие эпики связаны между собой и какой спринт активен;
- что именно изменил AI-агент, почему и с каким результатом;
- где накопились дефекты, зависимости и незавершённые проверки;
- что произошло с проектом за неделю, а не только что написано в последнем комментарии.

Tasktopia остаётся задачником — источником правды о том, **что**, **зачем**, **кто**, **когда**, **в каком статусе** и **от чего зависит**. Город не заменяет данные: он превращает их в пространственную модель, которую команда считывает за несколько секунд.

| В управлении | В Tasktopia | В городе |
|---|---|---|
| Проект | Страна | Общая территория и правительство |
| Эпик / подпроект | Город | Самостоятельный центр развития |
| Спринт / итерация | Район | Активная зона строительства |
| Задача | Здание | Пять видимых стадий прогресса |
| Стабильный контекст | Государственный архив | Отдельный охраняемый комплекс страны |
| Дефект / хотфикс | Инцидент | Дым, огонь и пожарная служба |

## Что умеет Tasktopia

### Планирование и совместная работа

- страны, города и районы с описанием, целями, сроками и ответственными;
- задачи типов `TASK`, `BUG`, `RELEASE`, `HOTFIX` с приоритетом, SP, дедлайном и критериями приёмки;
- зависимости, ссылки, комментарии, вложения и неизменяемая хроника событий;
- связанные дефекты с шагами воспроизведения, фактическим и ожидаемым результатом;
- AI-managed Markdown-документы задачи: системный анализ, архитектура, дизайн-система и план реализации;
- чек-листы, которые агент обновляет по мере выполнения плана;
- правительство страны: глава, министры и наблюдатели с разными правами;
- безопасное удаление задач, районов и городов с очисткой принадлежащей им геометрии.

### Живой пиксельный мир

- детерминированная бесконечная квадратная карта с клеткой `8×8 px`;
- чанки `64×64`, два уровня детализации, ограниченный prefetch и частичная перерисовка;
- 12 семейств рельефа: луга, леса, песок, глина, камень, холмы, горы, реки и озёра;
- города пяти морфологий и районы пяти архетипов;
- дороги разных классов, мосты, тротуары, переходы, светофоры и остановки;
- люди, животные, автомобили, автобусы, лодки, рыбаки и редкие пролёты самолётов;
- парки, рощи, фонтаны, площадки, фонари, скамейки и городские ориентиры;
- пять PNG-стадий каждого здания — от участка до завершённого объекта;
- визуальные инциденты: больше активных дефектов — больше дыма; от шести дефектов или активного хотфикса здание горит, а служба реагирует.

### AI и MCP

- MCP Streamable HTTP endpoint с `Authorization: Bearer <token>`;
- 46 инструментов для стран, архива, городов, районов, задач, прогресса, дефектов, документов и чек-листов;
- персональные токены со сроком действия и минимальными scopes;
- idempotency key для каждой изменяющей команды;
- динамическая проверка роли на каждом запросе;
- публичный [`ai.md`](https://tasktopia.online/ai.md), который можно сразу передать агенту;
- готовый skill, объясняющий, когда агент обязан уточнить страну, город или район и как вести прогресс задачи.

### Realtime без перезагрузки мира

Socket.IO-событие несёт `affectedBounds`. Клиент сбрасывает только пересекающиеся чанки: новое здание, изменение статуса или дефект не заставляют пересоздавать весь canvas. Статические ассеты имеют content revision в URL и могут раздаваться через CDN с `immutable` cache.

## Проект в цифрах

Цифры ниже считаются из [`manifest.json`](assets/pixel-city-pack-v4/manifest.json), а не поддерживаются вручную.

| Каталог | Количество |
|---|---:|
| Семейства зданий | 193 |
| Строительные стадии зданий | 965 |
| Props и городской декор | 163 |
| Модели транспорта | 8 |
| Terrain families | 12 |
| Все runtime PNG | 1 217 |
| Зарегистрированные MCP tools | 46 |

Полный визуальный контракт и текущий статус authored-миграции находятся в [ТЗ пака](assets/pixel-city-pack-v4/docs/GENERATION-SPEC.md) и [плане расширения](assets/pixel-city-pack-v4/docs/ASSET-EXPANSION-PLAN.md).

## Быстрый запуск в Docker

Нужны Docker Engine с Compose v2 и Git.

```bash
git clone https://github.com/afkbot-io/tasktopia.git
cd tasktopia
cp deploy/.env.self-host.example .env
```

Замените `POSTGRES_PASSWORD` в `.env` на результат `openssl rand -hex 32`, затем:

```bash
docker compose up -d --build
docker compose ps
curl -fsS http://127.0.0.1:3000/health
```

Откройте [http://localhost:3000](http://localhost:3000) и зарегистрируйтесь. Регистрация атомарно создаст аккаунт, первую страну, Государственный архив и первый город.

Данные PostgreSQL и загрузки сохраняются в named volumes. Контейнер приложения работает не от root, имеет healthcheck и по умолчанию доступен только на `127.0.0.1`.

## Установка на Ubuntu/Debian с HTTPS

До запуска направьте A/AAAA-запись домена на сервер. Автоматический установщик поставит Docker, PostgreSQL, nginx и Certbot, создаст секреты, запустит контейнеры и выпустит сертификат:

```bash
git clone --depth 1 https://github.com/afkbot-io/tasktopia.git /tmp/tasktopia-bootstrap
sudo /tmp/tasktopia-bootstrap/deploy/install-server.sh \
  --domain tasks.example.com \
  --email admin@example.com
```

По умолчанию проект устанавливается в `/srv/tasktopia/app`. Для приватного fork передайте `--repository`, доступный серверу по deploy key. Все параметры и ручная процедура описаны в [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

Обновление с резервной копией PostgreSQL:

```bash
sudo /srv/tasktopia/app/deploy/update-server.sh
```

## Подключение MCP

1. Зарегистрируйтесь и откройте «MCP-интеграции».
2. Создайте персональный токен с минимально необходимыми разрешениями.
3. Скопируйте endpoint вашего сервера: `https://tasks.example.com/mcp`.
4. Сохраните секрет в secret storage MCP-клиента, не в query string и не в Git.

```json
{
  "mcpServers": {
    "tasktopia": {
      "url": "https://tasks.example.com/mcp",
      "headers": {
        "Authorization": "Bearer ttp_mcp_..."
      }
    }
  }
}
```

Основной рабочий цикл агента:

```text
country.list → country.select → city.list → district.list
→ task.create → task.document_upsert → task.checklist_replace
→ task.report_progress → task.defect_create/update → task.set_status
```

Контракт, scopes, подтверждение destructive-операций и примеры payload: [docs/MCP.md](docs/MCP.md). Самодостаточная инструкция для внешнего AI: [`/ai.md`](https://tasktopia.online/ai.md).

## Как устроено

```mermaid
flowchart LR
    Human["Команда в браузере"] --> Web["React + PixiJS"]
    Agent["Codex / Claude / другой MCP-клиент"] --> MCP["MCP Streamable HTTP"]
    Web --> API["Fastify API"]
    MCP --> API
    API --> DB[("PostgreSQL 16")]
    API --> RT["Socket.IO affectedBounds"]
    RT --> Web
    CDN["Опциональный CDN"] --> Web
```

- **PostgreSQL** — единственный источник истины для рабочих сущностей и геометрии.
- **Fastify** — auth, API, MCP, миграции и генерация мира.
- **React** — план, настройки, карточки задач и управление страной.
- **PixiJS** — постоянный viewport, chunk streaming и анимация.
- **Versioned manifest** — связь семантического типа здания с проверенными PNG.

Подробнее: [архитектура](docs/ARCHITECTURE.md), [генерация мира](docs/WORLD-GENERATION.md), [здания](docs/BUILDINGS.md), [страны и доступ](docs/COUNTRIES-AND-ACCESS.md).

## Разработка

Нужны Node.js 24+, npm и PostgreSQL 16. Python 3 требуется только для пересборки графического пака.

```bash
npm ci
cp .env.example .env
docker compose up -d postgres
npm run seed
npm run dev
```

Локальный showcase из обложки:

```bash
npm run test:db:start
DATABASE_URL=postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test npm run seed:showcase
```

Основные проверки:

```bash
npm run typecheck
npm run lint
npm test
npm run build
npm run test:e2e
npm run assets:verify
```

Тяжёлые world-generation сценарии вынесены из обычного набора и запускаются отдельно. Правила contribution и обязательные quality gates: [CONTRIBUTING.md](CONTRIBUTING.md).

## Структура репозитория

```text
src/client/                         React UI и PixiJS-карта
src/server/                         Fastify, PostgreSQL, auth, MCP, worldgen
src/shared/                         DTO, контракты и runtime-каталог
assets/pixel-city-pack-v4/          source sheets, manifest и ТЗ графики
public/game-assets/v4/              готовый браузерный asset pack
scripts/                            seed, аудит, миграция и smoke tools
tests/                              unit, PostgreSQL integration и Playwright
deploy/                             Docker/nginx/Certbot install и update
docs/                               архитектура, MCP, эксплуатация и QA
```

## Безопасность

- браузерная сессия хранится в `HttpOnly` cookie;
- MCP использует отдельные отзываемые Bearer-токены, в БД хранится только SHA-256 hash;
- приложение и PostgreSQL не публикуются наружу при стандартной server-установке;
- destructive MCP tools требуют точного подтверждения текущего названия;
- секреты передаются только через environment и не входят в Docker image.

О найденной уязвимости сообщайте через private security advisory, а не публичный issue: [SECURITY.md](SECURITY.md).

## Лицензия

Tasktopia распространяется по лицензии [MIT](LICENSE): проект можно использовать, копировать, изменять, распространять и применять коммерчески при сохранении copyright notice и текста лицензии. Лицензия распространяется на код и включённые в репозиторий игровые ассеты, если рядом с конкретным файлом не указано иное.

---

<p align="center"><strong>Стройте не очередь карточек. Стройте страну, в которой видно движение работы.</strong></p>
