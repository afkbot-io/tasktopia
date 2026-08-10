import { AppService } from "../src/server/app-service";
import { loginUser, registerUser } from "../src/server/auth";
import { config } from "../src/server/config";
import { createDb, transaction } from "../src/server/db";
import type { DistrictArchetype } from "../src/shared/contracts";

const db = await createDb(config.databaseUrl);
const service = new AppService(db);
const email = "demo@tasktopia.local";
const password = "tasktopia-demo";
let user;
try {
  user = (await registerUser(db, { email, password, name: "Тестовый правитель" })).user;
} catch {
  user = (await loginUser(db, email, password)).user;
}

await transaction(db, async () => {
  await db.prepare("UPDATE users SET name = ? WHERE id = ?").run("Тестовый правитель", user.id);
  await db.prepare("UPDATE countries SET name = ? WHERE id = ?").run("Тестовая страна", user.countryId);
  await db.prepare("DELETE FROM world_features_v6 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM roads_v3 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM cities_v3 WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM events WHERE country_id = ?").run(user.countryId);
  await db.prepare("DELETE FROM idempotency WHERE country_id = ?").run(user.countryId);
  await db.prepare("UPDATE countries SET seed = ?, world_version = 1 WHERE id = ?").run(424_242, user.countryId);
});

const city = await service.createCity(user.countryId, { name: "Riverside", idempotencyKey: "test-city" });
const archetypes: DistrictArchetype[] = ["NEW_BUILD", "PRIVATE", "MIXED_URBAN", "COMMERCIAL", "CIVIC"];
for (let index = 0; index < 10; index += 1) {
  const archetype = archetypes[index % archetypes.length]!;
  const district = await service.createDistrict(user.countryId, {
            cityId: city.id,
            name: `Тестовый район ${index + 1}`,
            archetype,
            capacitySp: 40,
            activate: index === 0,
            idempotencyKey: `test-district-${index}`,
  });
  for (let taskIndex = 0; taskIndex < 2; taskIndex += 1) {
    const firstTask = index === 0 && taskIndex === 0;
    const task = await service.createTask(user.countryId, {
                              cityId: city.id,
                              districtId: district.id,
                              title: `Задача района ${index + 1}.${taskIndex + 1}`,
                              description: firstTask ? "Проверить новый агентский workflow материалов задачи и прогресса." : undefined,
                              acceptanceCriteria: firstTask ? "- Документы читаются без горизонтального скролла\n- Чек-лист показывает фактический прогресс" : undefined,
                              systemAnalysis: firstTask ? "# Контекст\n\nМатериалы задачи обновляет AI-агент через MCP; человек использует карточку только для чтения." : undefined,
                              architecture: firstTask ? "# Контракт\n\nMarkdown-документы и пункты чек-листа принадлежат задаче и удаляются каскадно вместе с ней." : undefined,
                              designSystem: firstTask ? "# Представление\n\nЧетыре компактные полоски открывают один читаемый Markdown-просмотр." : undefined,
                              implementationPlan: firstTask ? "# План\n\n1. Подготовить миграцию.\n2. Обновить MCP.\n3. Проверить карточку в браузере." : undefined,
                              estimate: archetype === "PRIVATE" ? 1 : 2,
                              idempotencyKey: `test-task-${index}-${taskIndex}`,
                            });
    if (firstTask) await service.replaceTaskChecklist(user.countryId, {
      taskId: task.id,
      items: [{ title: "Подготовить миграцию", done: true }, { title: "Обновить MCP", done: true }, { title: "Проверить карточку в браузере" }],
      actor: "Тестовый AI-агент",
      idempotencyKey: "test-task-checklist-0-0",
    });
  }
}

console.log("Test data is ready: 1 city, 10 districts, 20 tasks.");
await db.close();
