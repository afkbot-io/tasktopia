# ADR 0005: opt-in Web Push поверх durable events

- Статус: принято
- Дата: 2026-08-28

## Контекст

Realtime Socket.IO работает только в открытой вкладке. PWA должна получать
небольшие уведомления после явного согласия, не включая endpoint и ключи
подписки в события, ответы или логи. Недоступный push provider не должен влиять
на каноническую транзакцию задачи.

## Решение

- Browser subscription хранится отдельно, принадлежит пользователю и уникальна
  по SHA-256 endpoint. API никогда не возвращает endpoint, `p256dh` или `auth`.
- `events` остаётся единственным источником. Web runtime читает committed rows
  отдельным cursor-worker и создаёт уникальную delivery для пары
  `event + subscription`; в транзакции задачи нет сетевого push-вызова.
- Перед фактической отправкой worker повторно проверяет membership пользователя в
  стране события. HTTP 404/410 удаляет subscription, временные ошибки получают
  ограниченный retry до трёх попыток. Отсутствующие VAPID secrets полностью
  отключают worker, но не API, health и task workflow.
- Payload содержит только заголовок, строку `страна · город · район`, same-origin
  `/task/<номер>?countryId=<страна>&taskId=<задача>` и стабильный event tag.
  Номер задачи локален для страны; `taskId` позволяет клиенту запросить
  авторизованное текущее положение задачи, а не координаты из старого события.
  Service worker всегда показывает
  user-visible notification, отклоняет cross-origin click URL и восстанавливает
  изменившуюся browser subscription.
- Permission запрашивается только обработчиком кнопки. На iOS/iPadOS показывается
  инструкция Home Screen до standalone-режима. Отключение и logout удаляют
  серверную и локальную подписку текущего устройства.

## Уточнение границ безопасности — 2026-09-05

- Сохранение подписки и фактическая отправка принимают только HTTPS endpoints
  проверенных push-провайдеров: `fcm.googleapis.com`, прежний
  `android.googleapis.com`, `updates.push.services.mozilla.com`, поддомены
  `push.apple.com` и `notify.windows.com`. Запрещены пользовательские credentials,
  нестандартный порт и fragment. Это явная политика допустимых провайдеров, а не
  предварительный DNS-check с возможностью rebinding между проверкой и отправкой.
  Поддержка собственного push-сервера требует отдельного security review;
  универсального разрешения произвольного HTTPS egress нет.
- Домены сверены с первичными источниками:
  [Chrome FCM](https://developer.chrome.com/blog/push-notifications-on-the-open-web?hl=en),
  [прежний Google endpoint](https://developer.chrome.com/blog/web-push-interop-wins),
  [Mozilla Autopush](https://mozilla-services.github.io/autopush-rs/),
  [Apple Web Push](https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers),
  [Microsoft WNS](https://learn.microsoft.com/en-us/windows/apps/develop/notifications/push-notifications/wns-overview).
- `web-push` формирует зашифрованный запрос и VAPID, транспорт отправляет его с
  абсолютным дедлайном 5 секунд и `AbortSignal`. Redirect не выполняется, тело
  ответа провайдера не буферизуется. Логи ошибок не включают endpoint или ключи.
  HTTP 3xx считается окончательной ошибкой, а не новым адресом доставки.
- Владение endpoint проверяется атомарным `INSERT … ON CONFLICT … WHERE
  user_id=EXCLUDED.user_id`. Одновременная первая регистрация двумя пользователями
  не может заменить чужие ключи. Удаление своей прежней неподдерживаемой подписки
  остаётся доступным.
- Во время медленной отправки polling не накапливает очередь циклов. Остановка
  worker завершает только текущую отправку, ограниченную дедлайном транспорта,
  и не начинает остальные элементы пакета.
- Уже поставленный в очередь `/task/<номер>` при отправке получает явные
  идентификаторы из исходного durable event. Если проверяемой идентичности в
  событии нет, ссылка ведёт на `/`, а не в произвольно выбранную страну. История
  события и сохранённый payload очереди не переписываются; заголовок, текст и tag
  сохраняются.

Регрессии используют заглушки транспорта и изолированную тестовую БД: реальные
push-сообщения, production-подписки и развёртывание для этой проверки не нужны.

## Последствия

Доставка является изолированной и наблюдаемой через `push_deliveries_v1`.
Уникальная строка и notification tag подавляют обычные дубли; авария процесса
не может обеспечить математическую exactly-once гарантию после принятия push
provider, поэтому payload остаётся идемпотентным. При ротации VAPID public key
существующие подписки перестают быть пригодны: ключи следует хранить как
долгоживущий production secret и менять отдельной миграцией/rollout.

## Отклонённые варианты

- Push внутри task transaction: внешний timeout увеличивает latency и способен
  откатить уже валидную пользовательскую операцию.
- Хранение только в памяти или Socket.IO: не переживает restart и закрытую PWA.
- Автоматический prompt после login: нарушает user-gesture flow WebKit и не даёт
  пользователю понятного управления согласием.
