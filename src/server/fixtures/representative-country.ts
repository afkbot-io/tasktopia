import type { AppService } from "../app-service";
import type { CityDto, CityMorphology, DistrictArchetype, DistrictDto, TaskDto, TaskStatus } from "../../shared/contracts";

export const REPRESENTATIVE_SEED = 987_321;
const STATUS_ORDER: TaskStatus[] = ["PLANNING", "STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"];
const ARCHETYPES: DistrictArchetype[] = ["NEW_BUILD", "PRIVATE", "MIXED_URBAN"];

type CompactCityFixtureOptions = {
  key: string;
  name: string;
  morphology?: CityMorphology;
  taskCount?: number;
  districtCount?: number;
  /** Keep readable task documents/checklist in the normal browser fixture. */
  includeTaskMaterials?: boolean;
};

export type RepresentativeCountryResult = { cities: CityDto[]; districts: DistrictDto[]; tasks: TaskDto[] };

const TASK_MATERIALS = {
  description: "Проверить новый агентский workflow материалов задачи и прогресса.",
  acceptanceCriteria: "- Документы читаются без горизонтального скролла\n- Чек-лист показывает фактический прогресс",
  systemAnalysis: "# Контекст\n\nМатериалы задачи обновляет AI-агент через MCP; человек использует карточку только для чтения.",
  architecture: "# Контракт\n\nMarkdown-документы и пункты чек-листа принадлежат задаче и удаляются каскадно вместе с ней.",
  designSystem: "# Представление\n\nЧетыре компактные полоски открывают один читаемый Markdown-просмотр.",
  implementationPlan: "# План\n\n1. Подготовить миграцию.\n2. Обновить MCP.\n3. Проверить карточку в браузере.",
};

/**
 * Real service calls are the only author of blocks, slots, access and roads.
 * No fixture injects cell coordinates, old lots, road cells or spatial JSON.
 * The default city has 40 numbered tasks in three distinct districts:
 * mixed active construction, a finished neighbourhood and planned expansion.
 */
export async function seedCompactCity(
  service: AppService,
  countryId: string,
  options: CompactCityFixtureOptions,
): Promise<CityDto> {
  const taskCount = options.taskCount ?? 40;
  const districtCount = options.districtCount ?? 3;
  if (!Number.isInteger(taskCount) || !Number.isInteger(districtCount) || districtCount < 3 || taskCount < districtCount) {
    throw new Error("A compact fixture needs at least three districts and one task per district.");
  }
  const prefix = `compact-fixture-v2-${options.key}`;
  const city = (await service.listCities(countryId)).find((candidate) => candidate.name === options.name)
    ?? await service.createCity(countryId, {
      name: options.name,
      description: "Компактный город: прямоугольные кварталы, связанные улицы, слоты домов 6×6 и парки-задачи.",
      morphology: options.morphology ?? "BALANCED",
      idempotencyKey: `${prefix}-city`,
    });
  const districts: DistrictDto[] = [];
  let taskNumber = 0;
  for (let districtIndex = 0; districtIndex < districtCount; districtIndex += 1) {
    const name = `Квартальный район ${districtIndex + 1}`;
    let district = (await service.listDistricts(countryId, city.id)).find((candidate) => candidate.name === name)
      ?? await service.createDistrict(countryId, {
        cityId: city.id, name,
        goal: "Последовательно заполнить слоты кварталов, сохраняя единый план улиц.",
        archetype: ARCHETYPES[districtIndex % ARCHETYPES.length],
        capacitySp: 100,
        activate: false,
        idempotencyKey: `${prefix}-district-${districtIndex}`,
      });
    districts.push(district);
    const completed = districtIndex > 0 && districtIndex < districtCount - 1;
    const planned = districtIndex === districtCount - 1;
    if (!planned && district.status !== "COMPLETED") {
      district = await service.activateDistrict(countryId, district.id, `${prefix}-activate-${districtIndex}`);
    }
    const count = Math.floor(taskCount / districtCount) + (districtIndex < taskCount % districtCount ? 1 : 0);
    const existingTasks = new Map((await service.listTasks(countryId, district.id)).map((task) => [task.title, task]));
    for (let index = 0; index < count; index += 1) {
      taskNumber += 1;
      const firstTask = districtIndex === 0 && index === 0;
      const park = index === 1;
      const title = `Задача района ${districtIndex + 1}.${index + 1}`;
      const taskPrefix = `${prefix}-task-${districtIndex}-${index}`;
      let task = existingTasks.get(title) ?? await service.createTask(countryId, {
        cityId: city.id, districtId: district.id, title,
        description: park ? "Парк квартала со своими стадиями обустройства." : "Компактный корпус в заранее выделенном слоте квартала.",
        ...(firstTask && options.includeTaskMaterials ? TASK_MATERIALS : {}),
        estimate: ([1, 2, 3, 6] as const)[index % 4]!,
        priority: (["NORMAL", "LOW", "HIGH", "NORMAL"] as const)[index % 4],
        visualKind: park ? "PARK" : undefined,
        parkVariant: park ? (["urban-formal", "urban-community", "urban-central"] as const)[districtIndex % 3] : undefined,
        idempotencyKey: taskPrefix,
      });
      const target: TaskStatus = planned ? "PLANNING" : completed ? "COMPLETED"
        : firstTask ? "IN_PROGRESS" : index === 1 ? "TESTING" : STATUS_ORDER[(index - 2) % STATUS_ORDER.length]!;
      for (let stage = STATUS_ORDER.indexOf(task.status) + 1; stage <= STATUS_ORDER.indexOf(target); stage += 1) {
        task = await service.updateTaskStatus(countryId, {
          taskId: task.id, status: STATUS_ORDER[stage]!,
          comment: "Штатное продвижение задачи компактного демо-города.",
          actor: "Compact city fixture", idempotencyKey: `${taskPrefix}-stage-${stage}`,
        });
      }
      if (firstTask && options.includeTaskMaterials) await service.replaceTaskChecklist(countryId, {
        taskId: task.id,
        items: [{ title: "Подготовить миграцию", done: true }, { title: "Обновить MCP", done: true }, { title: "Проверить карточку в браузере" }],
        actor: "Тестовый AI-агент", idempotencyKey: `${taskPrefix}-checklist`,
      });
    }
    if (completed && district.status !== "COMPLETED") {
      await service.completeDistrict(countryId, district.id, `${prefix}-complete-${districtIndex}`);
    }
  }
  if (taskNumber !== taskCount) throw new Error("Compact fixture task distribution lost tasks.");
  await service.activateDistrict(countryId, districts[0]!.id, `${prefix}-active-frontier`);
  return (await service.listCities(countryId)).find((candidate) => candidate.id === city.id)!;
}

export async function seedDevelopmentCountry(service: AppService, countryId: string): Promise<RepresentativeCountryResult> {
  await seedCompactCity(service, countryId, { key: "development", name: "Riverside Local", includeTaskMaterials: true });
  return {
    cities: await service.listCities(countryId),
    districts: await service.listDistricts(countryId),
    tasks: await service.listTasks(countryId),
  };
}
