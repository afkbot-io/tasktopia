import type { AppService } from "../app-service";
import type { CityDto, DistrictArchetype, DistrictDto, Estimate, TaskDto, TaskPriority, TaskStatus } from "../../shared/contracts";

export const DENSE_DEMO_SEED = 424_242;
export const DENSE_DEMO_CITY_COUNT = 3;
export const DENSE_DEMO_DISTRICTS_PER_CITY = 3;
export const DENSE_DEMO_TASKS_PER_DISTRICT = 10;

type TaskTemplate = {
  title: string;
  description: string;
  estimate: Estimate;
};

type DistrictTemplate = {
  name: string;
  goal: string;
  tasks: TaskTemplate[];
};

type CityTemplate = {
  key: string;
  name: string;
  description: string;
  districts: DistrictTemplate[];
};

const residentialTasks: TaskTemplate[] = [
  { title: "Благоустроить гостевую парковку", description: "Небольшая парковка у въезда в жилой квартал.", estimate: 1 },
  { title: "Построить семейный коттедж", description: "Компактный дом с зелёным двором.", estimate: 1 },
  { title: "Открыть угловое кафе", description: "Кафе для жителей возле главной улицы.", estimate: 2 },
  { title: "Построить ряд таунхаусов", description: "Плотная жилая застройка вдоль тихой улицы.", estimate: 2 },
  { title: "Открыть районную аптеку", description: "Аптека ежедневного спроса.", estimate: 2 },
  { title: "Построить садовый жилой дом", description: "Дом средней плотности с небольшим садом.", estimate: 3 },
  { title: "Открыть семейную клинику", description: "Медицинский объект районного уровня.", estimate: 3 },
  { title: "Построить небольшой офис", description: "Рабочие места рядом с жильём.", estimate: 3 },
  { title: "Открыть продуктовый магазин", description: "Магазин у пешеходного маршрута.", estimate: 3 },
  { title: "Построить общественную школу", description: "Крупный общественный объект квартала.", estimate: 6 },
];

const commercialTasks: TaskTemplate[] = [
  { title: "Разметить парковку для покупателей", description: "Короткая парковочная зона у торговой улицы.", estimate: 1 },
  { title: "Построить дом владельца магазина", description: "Небольшой жилой дом рядом с бизнесом.", estimate: 1 },
  { title: "Открыть ремесленную пекарню", description: "Небольшая торговая точка первой необходимости.", estimate: 2 },
  { title: "Открыть аптечный киоск", description: "Компактная коммерческая аптека.", estimate: 2 },
  { title: "Построить городской дуплекс", description: "Жильё над активной торговой улицей.", estimate: 2 },
  { title: "Открыть автосервис", description: "Сервисный объект рядом с коллекторной дорогой.", estimate: 3 },
  { title: "Построить офисный корпус", description: "Небольшое плотное деловое здание.", estimate: 3 },
  { title: "Открыть компактную заправку", description: "Дорожный сервис на въезде в район.", estimate: 3 },
  { title: "Открыть супермаркет", description: "Основной магазин торгового района.", estimate: 3 },
  { title: "Построить торговый центр", description: "Крупный якорный объект района.", estimate: 6 },
];

const civicTasks: TaskTemplate[] = [
  { title: "Создать служебную парковку", description: "Парковка общественного центра.", estimate: 1 },
  { title: "Построить дом смотрителя", description: "Небольшое жильё рядом с общественными зданиями.", estimate: 1 },
  { title: "Открыть почтовое отделение", description: "Повседневный городской сервис.", estimate: 2 },
  { title: "Построить жилой таунхаус", description: "Жильё для сотрудников городских служб.", estimate: 2 },
  { title: "Открыть районное кафе", description: "Небольшое кафе на общественной площади.", estimate: 2 },
  { title: "Построить библиотеку", description: "Образовательный и культурный объект.", estimate: 3 },
  { title: "Открыть пункт полиции", description: "Служба безопасности районного уровня.", estimate: 3 },
  { title: "Открыть пожарную часть", description: "Экстренная служба возле основной дороги.", estimate: 3 },
  { title: "Построить городской банк", description: "Финансовый сервис общественного центра.", estimate: 3 },
  { title: "Построить городской театр", description: "Крупный культурный объект и ориентир района.", estimate: 6 },
];

export const DENSE_DEMO_CITIES: CityTemplate[] = [
  {
    key: "riverside",
    name: "Riverside",
    description: "Плотный демонстрационный город у воды с жилыми, торговыми и общественными кварталами.",
    districts: [
      { name: "Садовый квартал", goal: "Создать спокойный жилой район с повседневными сервисами.", tasks: residentialTasks },
      { name: "Речной рынок", goal: "Собрать торговый район у главной городской дороги.", tasks: commercialTasks },
      { name: "Гражданский центр", goal: "Разместить общественные службы и культурные здания.", tasks: civicTasks },
    ],
  },
  {
    key: "harborview",
    name: "Harborview",
    description: "Дорожный и торговый город с тремя самостоятельными районами.",
    districts: [
      { name: "Портовые дома", goal: "Построить жильё и базовые сервисы для жителей.", tasks: residentialTasks },
      { name: "Торговые ряды", goal: "Развить магазины, офисы и дорожный сервис.", tasks: commercialTasks },
      { name: "Площадь служб", goal: "Сформировать доступный общественный центр.", tasks: civicTasks },
    ],
  },
  {
    key: "pinegate",
    name: "Pinegate",
    description: "Зелёный развивающийся город с разнообразной малоэтажной и общественной застройкой.",
    districts: [
      { name: "Сосновые улицы", goal: "Сформировать разнообразный жилой квартал.", tasks: residentialTasks },
      { name: "Малый бизнес", goal: "Разместить локальную торговлю и рабочие места.", tasks: commercialTasks },
      { name: "Городской сад", goal: "Объединить культурные и экстренные службы.", tasks: civicTasks },
    ],
  },
];

const STATUS_ORDER: TaskStatus[] = ["PLANNING", "STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"];
const PRIORITIES: TaskPriority[] = ["LOW", "NORMAL", "HIGH", "CRITICAL"];
const DISTRICT_ARCHETYPES: DistrictArchetype[] = ["PRIVATE", "COMMERCIAL", "CIVIC"];

export type DenseDemoResult = {
  cities: CityDto[];
  districts: DistrictDto[];
  tasks: TaskDto[];
};

export function seedDenseDemo(service: AppService, countryId: string): DenseDemoResult {
  for (let cityIndex = 0; cityIndex < DENSE_DEMO_CITIES.length; cityIndex += 1) {
    const citySpec = DENSE_DEMO_CITIES[cityIndex]!;
    const city = service.listCities(countryId).find((candidate) => candidate.name === citySpec.name) ?? service.createCity(countryId, {
      name: citySpec.name,
      description: citySpec.description,
      idempotencyKey: `dense-city-${citySpec.key}`,
    });

    for (let districtIndex = 0; districtIndex < citySpec.districts.length; districtIndex += 1) {
      const districtSpec = citySpec.districts[districtIndex]!;
      const lifecycle = districtIndex === 0 ? "COMPLETED" : districtIndex === 1 ? "ACTIVE" : "PLANNED";
      const district = service.listDistricts(countryId, city.id).find((candidate) => candidate.name === districtSpec.name) ?? service.createDistrict(countryId, {
        cityId: city.id,
        name: districtSpec.name,
        goal: districtSpec.goal,
        capacitySp: 26,
        activate: lifecycle !== "PLANNED",
        archetype: DISTRICT_ARCHETYPES[districtIndex],
        idempotencyKey: `dense-district-${citySpec.key}-${districtIndex}`,
      });

      for (let taskIndex = 0; taskIndex < districtSpec.tasks.length; taskIndex += 1) {
        const template = districtSpec.tasks[taskIndex]!;
        const title = `${template.title} — ${city.name}`;
        let task = service.listTasks(countryId, district.id).find((candidate) => candidate.title === title) ?? service.createTask(countryId, {
          cityId: city.id,
          districtId: district.id,
          title,
          description: `${template.description} Район «${district.name}», город ${city.name}.`,
          estimate: template.estimate,
          priority: PRIORITIES[(cityIndex + districtIndex + taskIndex) % PRIORITIES.length],
          idempotencyKey: `dense-task-${citySpec.key}-${districtIndex}-${taskIndex}`,
        });
        const targetIndex = lifecycle === "COMPLETED"
          ? STATUS_ORDER.indexOf("COMPLETED")
          : lifecycle === "PLANNED"
            ? STATUS_ORDER.indexOf("PLANNING")
            : taskIndex % STATUS_ORDER.length;
        for (let stageIndex = STATUS_ORDER.indexOf(task.status) + 1; stageIndex <= targetIndex; stageIndex += 1) {
          const status = STATUS_ORDER[stageIndex]!;
          task = service.updateTaskStatus(countryId, {
            taskId: task.id,
            status,
            progress: [0, 12, 52, 88, 100][stageIndex],
            comment: `Fixture: стадия ${stageIndex + 1} из 5 подтверждена.`,
            actor: "Dense demo fixture",
            idempotencyKey: `dense-task-${citySpec.key}-${districtIndex}-${taskIndex}-stage-${stageIndex}`,
          });
        }
      }
      if (lifecycle === "COMPLETED" && district.status !== "COMPLETED") {
        service.completeDistrict(countryId, district.id, `dense-district-${citySpec.key}-${districtIndex}-complete`);
      }
    }
  }

  return {
    cities: service.listCities(countryId),
    districts: service.listDistricts(countryId),
    tasks: service.listTasks(countryId),
  };
}
