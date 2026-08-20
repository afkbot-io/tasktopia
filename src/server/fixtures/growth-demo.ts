import type { AppService } from "../app-service";
import type { CityDto, DistrictDto, Estimate, TaskDto, TaskPriority, TaskStatus } from "../../shared/contracts";

export const GROWTH_DEMO_SEED = 730_031;
export const GROWTH_TASKS_PER_DISTRICT = 10;
export const GROWTH_DISTRICT_COUNT = 10;

const DISTRICT_NAMES = [
  "Старый центр",
  "Берёзовые дворы",
  "Рыночная слобода",
  "Северные мастерские",
  "Университетский квартал",
  "Набережный район",
  "Южные сады",
  "Вокзальная площадь",
  "Новый деловой центр",
  "Парковая дуга",
] as const;

const LARGE_TITLES = [
  "Построить районную школу",
  "Открыть городской театр",
  "Построить торговый центр",
  "Построить жилую высотку",
  "Открыть общественную библиотеку",
] as const;

type GrowthTaskTemplate = { title: string; description: string; estimate: Estimate };

const BASE_TASKS: GrowthTaskTemplate[] = [
  { title: "Благоустроить небольшую парковку", description: "Карманная парковка для жителей и посетителей.", estimate: 1 },
  { title: "Построить малоэтажный жилой корпус", description: "Небольшой многоквартирный корпус с общим входом.", estimate: 1 },
  { title: "Открыть угловое кафе", description: "Небольшое кафе у пешеходного маршрута.", estimate: 2 },
  { title: "Построить ряд городских домов", description: "Компактная жилая застройка квартала.", estimate: 2 },
  { title: "Открыть районную аптеку", description: "Повседневный сервис для жителей.", estimate: 2 },
  { title: "Открыть районную клинику", description: "Общественная медицинская служба.", estimate: 3 },
  { title: "Построить небольшой офис", description: "Рабочие места рядом с жильём.", estimate: 3 },
  { title: "Открыть дорожный сервис", description: "Заправка или мастерская у основной улицы.", estimate: 3 },
  { title: "Открыть продуктовый магазин", description: "Основной магазин квартала.", estimate: 3 },
  { title: "", description: "Крупный ориентир и общественный центр района.", estimate: 6 },
];

const STATUS_ORDER: TaskStatus[] = ["PLANNING", "STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"];
const PRIORITIES: TaskPriority[] = ["LOW", "NORMAL", "HIGH", "CRITICAL"];

export type GrowthDemoResult = { city: CityDto; districts: DistrictDto[]; tasks: TaskDto[] };

export async function seedGrowthDemo(service: AppService, countryId: string, districtLimit = GROWTH_DISTRICT_COUNT): Promise<GrowthDemoResult> {
  const limit = Math.max(1, Math.min(GROWTH_DISTRICT_COUNT, Math.trunc(districtLimit)));
  const city = (await service.listCities(countryId)).find((candidate) => candidate.name === "Centuria") ?? await service.createCity(countryId, {
            name: "Centuria",
            description: "Live-test города, который последовательно растёт до ста задач.",
            morphology: "DENSE_CORE",
            idempotencyKey: "growth-city-centuria",
          });

  for (let districtIndex = 0; districtIndex < limit; districtIndex += 1) {
    if (districtIndex > 0) {
      const previousName = DISTRICT_NAMES[districtIndex - 1]!;
      const previous = (await service.listDistricts(countryId, city.id)).find((candidate) => candidate.name === previousName);
      if (previous && previous.status !== "COMPLETED" && (await service.listTasks(countryId, previous.id)).length === GROWTH_TASKS_PER_DISTRICT) {
        const previousTasks = await service.listTasks(countryId, previous.id);
        for (let taskIndex = 0; taskIndex < previousTasks.length; taskIndex += 1) {
          let task = previousTasks[taskIndex]!;
          for (let stageIndex = STATUS_ORDER.indexOf(task.status) + 1; stageIndex < STATUS_ORDER.length; stageIndex += 1) {
            task = await service.updateTaskStatus(countryId, {
                                                              taskId: task.id,
                                                              status: STATUS_ORDER[stageIndex]!,
                                                              progress: [0, 12, 52, 88, 100][stageIndex],
                                                              comment: "Live-test: задача завершена перед закрытием района.",
                                                              actor: "Growth live-test",
                                                              idempotencyKey: `growth-district-${districtIndex - 1}-close-task-${taskIndex}-stage-${stageIndex}`,
                                                            });
          }
        }
        await service.completeDistrict(countryId, previous.id, `growth-district-${districtIndex - 1}-complete`);
      }
    }
    const districtName = DISTRICT_NAMES[districtIndex]!;
    let district = (await service.listDistricts(countryId, city.id)).find((candidate) => candidate.name === districtName) ?? await service.createDistrict(countryId, {
                      cityId: city.id,
                      name: districtName,
                      goal: `Создать самостоятельный смешанный район №${districtIndex + 1}.`,
                      capacitySp: 26,
                      activate: true,
                      idempotencyKey: `growth-district-${districtIndex}`,
                    });
    if (district.status === "PLANNED") {
      district = await service.activateDistrict(countryId, district.id, `growth-district-${districtIndex}-activate`);
    }

    for (let taskIndex = 0; taskIndex < BASE_TASKS.length; taskIndex += 1) {
      const template = BASE_TASKS[taskIndex]!;
      const titleBase = taskIndex === BASE_TASKS.length - 1
        ? LARGE_TITLES[districtIndex % LARGE_TITLES.length]!
        : template.title;
      const title = `${titleBase} — ${districtName}`;
      let task = (await service.listTasks(countryId, district.id)).find((candidate) => candidate.title === title) ?? await service.createTask(countryId, {
                                cityId: city.id,
                                districtId: district.id,
                                title,
                                description: `${template.description} Город Centuria, район «${districtName}».`,
                                estimate: template.estimate,
                                priority: PRIORITIES[(districtIndex + taskIndex) % PRIORITIES.length],
                                idempotencyKey: `growth-task-${districtIndex}-${taskIndex}`,
                              });

      const targetStage = (districtIndex * GROWTH_TASKS_PER_DISTRICT + taskIndex) % STATUS_ORDER.length;
      for (let stageIndex = STATUS_ORDER.indexOf(task.status) + 1; stageIndex <= targetStage; stageIndex += 1) {
        task = await service.updateTaskStatus(countryId, {
                                          taskId: task.id,
                                          status: STATUS_ORDER[stageIndex]!,
                                          progress: [0, 12, 52, 88, 100][stageIndex],
                                          comment: `Live-test: подтверждена стадия ${stageIndex + 1} из 5.`,
                                          actor: "Growth live-test",
                                          idempotencyKey: `growth-task-${districtIndex}-${taskIndex}-stage-${stageIndex}`,
                                        });
      }
    }
  }

  return {
    city: (await service.listCities(countryId)).find((candidate) => candidate.id === city.id)!,
    districts: await service.listDistricts(countryId, city.id),
    tasks: (await service.listTasks(countryId)).filter((task) => task.cityId === city.id),
  };
}
