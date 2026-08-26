import type { AppService } from "../app-service";
import type {
  CityDto,
  CityMorphology,
  DistrictArchetype,
  DistrictDto,
  Estimate,
  TaskDto,
  TaskPriority,
  TaskStatus,
} from "../../shared/contracts";

export const REPRESENTATIVE_SEED = 987_321;

type TaskTemplate = { title: string; description: string; estimate: Estimate };
type DistrictTemplate = { name: string; archetype: DistrictArchetype };
type CityTemplate = {
  key: string;
  name: string;
  description: string;
  morphology: CityMorphology;
  districts: DistrictTemplate[];
};

const ESTIMATES: Estimate[] = [1, 1, 2, 2, 2, 3, 3, 3, 3, 6];

const TASKS_BY_ARCHETYPE: Record<DistrictArchetype, Omit<TaskTemplate, "estimate">[]> = {
  NEW_BUILD: [
    { title: "Подготовить секцию малых апартаментов", description: "Компактная секция нового жилого комплекса." },
    { title: "Построить стартовый корпус новостройки", description: "Первый корпус единого ансамбля высоток." },
    { title: "Построить стеклянную жилую башню", description: "Высотный жилой корпус с общим двором." },
    { title: "Построить корпус апартаментов", description: "Плотная многоквартирная секция." },
    { title: "Открыть длинный магазин в стилобате", description: "Торговая галерея первого этажа." },
    { title: "Построить кирпичную высотку", description: "Многоэтажный дом второй очереди." },
    { title: "Построить угловой жилой комплекс", description: "Корпус формирует периметр квартала." },
    { title: "Открыть супермаркет первого этажа", description: "Повседневная торговля внутри нового квартала." },
    { title: "Построить офисную башню", description: "Высотный деловой корпус рядом с жильём." },
    { title: "Построить многофункциональный жилой комплекс", description: "Крупная доминанта с торговым первым этажом." },
  ],
  PRIVATE: [
    { title: "Построить небольшой жилой корпус", description: "Компактный малоэтажный многоквартирный дом." },
    { title: "Построить кирпичный дворовый корпус", description: "Низкий ЖК с общим озеленённым двором." },
    { title: "Построить галерейный жилой корпус", description: "Протяжённый малоэтажный дом вдоль улицы." },
    { title: "Построить секционный малоэтажный ЖК", description: "Несколько квартирных секций с общим входом." },
    { title: "Открыть угловое кафе", description: "Небольшой сервис для жителей района." },
    { title: "Построить ЖК с зелёной крышей", description: "Малоэтажный корпус с общей кровельной террасой." },
    { title: "Построить ряд малоэтажных корпусов", description: "Единый фронт жилого квартала." },
    { title: "Открыть районную аптеку", description: "Локальный магазин ежедневного спроса." },
    { title: "Открыть семейную клинику", description: "Небольшая служба для соседних кварталов." },
    { title: "Построить среднеэтажный жилой ансамбль", description: "Крупная задача мало-/среднеэтажного района." },
  ],
  COMMERCIAL: [
    { title: "Открыть парковку западного входа", description: "Парковка для посетителей торговой улицы." },
    { title: "Открыть парковку восточного входа", description: "Вторая парковочная площадка района." },
    { title: "Открыть угловое кафе", description: "Кафе у основного пешеходного потока." },
    { title: "Открыть коммерческую аптеку", description: "Торговая точка ежедневного спроса." },
    { title: "Открыть длинную пекарню", description: "Протяжённый магазин вдоль улицы." },
    { title: "Построить городской автосервис", description: "Сервис у коллекторной дороги." },
    { title: "Открыть районную заправку", description: "Дорожный сервис торгового района." },
    { title: "Построить офисный корпус", description: "Рабочие места в коммерческом квартале." },
    { title: "Открыть большой супермаркет", description: "Основной магазин района." },
    { title: "Построить торговый центр", description: "Крупный якорный объект." },
  ],
  CIVIC: [
    { title: "Создать служебную парковку", description: "Парковка муниципального центра." },
    { title: "Создать гостевую парковку", description: "Площадка для посетителей городских служб." },
    { title: "Открыть районный пункт полиции", description: "Компактная служба безопасности." },
    { title: "Открыть районную амбулаторию", description: "Медицинская служба квартала." },
    { title: "Открыть кафе общественного центра", description: "Небольшой сервис на площади." },
    { title: "Построить районную библиотеку", description: "Культурный объект района." },
    { title: "Построить городской банк", description: "Общественный финансовый сервис." },
    { title: "Открыть почтовое отделение", description: "Городская служба связи." },
    { title: "Построить пожарную часть", description: "Экстренная служба у основной улицы." },
    { title: "Построить городской театр", description: "Крупная культурная доминанта." },
  ],
  MIXED_URBAN: [
    { title: "Создать карманную парковку", description: "Небольшая площадка смешанного квартала." },
    { title: "Построить компактный жилой дом", description: "Жильё у городской улицы." },
    { title: "Открыть угловое кафе", description: "Активный первый этаж квартала." },
    { title: "Построить малоэтажный галерейный корпус", description: "Переход от низкой к плотной застройке." },
    { title: "Открыть районную аптеку", description: "Повседневный городской сервис." },
    { title: "Построить средний жилой корпус", description: "Многоквартирный дом смешанного района." },
    { title: "Построить небольшой офис", description: "Рабочие места рядом с жильём." },
    { title: "Открыть семейную клинику", description: "Медицинская служба района." },
    { title: "Открыть продуктовый магазин", description: "Магазин на главной улице." },
    { title: "Построить крупный смешанный комплекс", description: "Жилая и коммерческая доминанта." },
  ],
};

function districtSeries(prefix: string, archetypes: DistrictArchetype[]): DistrictTemplate[] {
  return archetypes.map((archetype, index) => ({ name: `${prefix} ${index + 1}`, archetype }));
}

const METROPOLIS_ARCHETYPES: DistrictArchetype[] = [
  "NEW_BUILD", "NEW_BUILD", "NEW_BUILD", "NEW_BUILD", "NEW_BUILD",
  "NEW_BUILD", "CIVIC", "COMMERCIAL", "NEW_BUILD", "NEW_BUILD",
  "NEW_BUILD", "NEW_BUILD", "NEW_BUILD", "NEW_BUILD", "MIXED_URBAN",
  "COMMERCIAL", "NEW_BUILD", "NEW_BUILD", "NEW_BUILD", "NEW_BUILD",
];

const REPRESENTATIVE_CITIES: CityTemplate[] = [
  {
    key: "riverside-metropolis", name: "Riverside", morphology: "DENSE_CORE",
    description: "Большой плотный город на 200 задач с несколькими центрами новостроек.",
    districts: districtSeries("Квартал Риверсайда", METROPOLIS_ARCHETYPES),
  },
  {
    key: "pinegate-garden", name: "Pinegate", morphology: "GARDEN_CITY",
    description: "Небольшой зелёный город малоэтажных ЖК, парков и локальных сервисов.",
    districts: districtSeries("Сосновый район", ["PRIVATE", "PRIVATE", "COMMERCIAL", "CIVIC", "PRIVATE", "MIXED_URBAN"]),
  },
  {
    key: "harborview-poly", name: "Harborview", morphology: "POLYCENTRIC",
    description: "Компактный портовый город со смешанным и торговым характером.",
    districts: districtSeries("Портовый район", ["MIXED_URBAN", "NEW_BUILD", "COMMERCIAL", "CIVIC", "MIXED_URBAN"]),
  },
  {
    key: "stonebridge-balanced", name: "Stonebridge", morphology: "BALANCED",
    description: "Малый сбалансированный город у межгородской дороги.",
    districts: districtSeries("Каменный район", ["PRIVATE", "NEW_BUILD", "COMMERCIAL", "CIVIC"]),
  },
];

const DEVELOPMENT_CITIES: CityTemplate[] = [
  {
    ...REPRESENTATIVE_CITIES[0]!,
    key: "local-riverside",
    name: "Riverside Local",
    description: "Локальный проверочный город: один город, десять районов и компактный набор задач.",
    districts: REPRESENTATIVE_CITIES[0]!.districts.slice(0, 10),
  },
];

const STATUS_ORDER: TaskStatus[] = ["PLANNING", "STARTED", "IN_PROGRESS", "TESTING", "COMPLETED"];
const PRIORITIES: TaskPriority[] = ["LOW", "NORMAL", "HIGH", "CRITICAL"];

function targetStatus(role: "COMPLETED" | "ACTIVE" | "PLANNED", taskIndex: number): TaskStatus {
  if (role === "COMPLETED") return "COMPLETED";
  if (role === "PLANNED") return "PLANNING";
  return STATUS_ORDER[taskIndex % STATUS_ORDER.length]!;
}

type RepresentativeCountryResult = { cities: CityDto[]; districts: DistrictDto[]; tasks: TaskDto[] };

async function seedCountryFixture(
  service: AppService,
  countryId: string,
  cities: CityTemplate[],
  tasksPerDistrict: number,
): Promise<RepresentativeCountryResult> {
  for (let cityIndex = 0; cityIndex < cities.length; cityIndex += 1) {
    const citySpec = cities[cityIndex]!;
    const city = (await service.listCities(countryId)).find((candidate) => candidate.name === citySpec.name) ?? await service.createCity(countryId, {
                      name: citySpec.name,
                      description: citySpec.description,
                      morphology: citySpec.morphology,
                      idempotencyKey: `representative-city-${citySpec.key}`,
                    });
    const activeIndex = citySpec.districts.length - 2;

    for (let districtIndex = 0; districtIndex < citySpec.districts.length; districtIndex += 1) {
      const districtSpec = citySpec.districts[districtIndex]!;
      const lifecycle = districtIndex < activeIndex ? "COMPLETED" : districtIndex === activeIndex ? "ACTIVE" : "PLANNED";
      const district = (await service.listDistricts(countryId, city.id)).find((candidate) => candidate.name === districtSpec.name) ?? await service.createDistrict(countryId, {
                                cityId: city.id,
                                name: districtSpec.name,
                                goal: `Сформировать самостоятельный район типа ${districtSpec.archetype}.`,
                                capacitySp: 26,
                                activate: lifecycle !== "PLANNED",
                                archetype: districtSpec.archetype,
                                idempotencyKey: `representative-district-${citySpec.key}-${districtIndex}`,
                              });
      const templates = TASKS_BY_ARCHETYPE[districtSpec.archetype];
      for (let taskIndex = 0; taskIndex < tasksPerDistrict; taskIndex += 1) {
        const template = templates[taskIndex]!;
        const title = `${template.title} — ${district.name}`;
        let task = (await service.listTasks(countryId, district.id)).find((candidate) => candidate.title === title) ?? await service.createTask(countryId, {
                                          cityId: city.id,
                                          districtId: district.id,
                                          title,
                                          description: `${template.description} Город ${city.name}.`,
                                          estimate: ESTIMATES[taskIndex]!,
                                          priority: PRIORITIES[(cityIndex + districtIndex + taskIndex) % PRIORITIES.length],
                                          idempotencyKey: `representative-task-${citySpec.key}-${districtIndex}-${taskIndex}`,
                                        });
        const target = targetStatus(lifecycle, taskIndex);
        for (let stageIndex = STATUS_ORDER.indexOf(task.status) + 1; stageIndex <= STATUS_ORDER.indexOf(target); stageIndex += 1) {
          task = await service.updateTaskStatus(countryId, {
                                                    taskId: task.id,
                                                    status: STATUS_ORDER[stageIndex]!,
                                                    progress: [0, 12, 52, 88, 100][stageIndex],
                                                    comment: lifecycle === "COMPLETED" ? "Район завершён по демо-плану." : "Активная реализация района.",
                                                    actor: "Representative country fixture",
                                                    idempotencyKey: `representative-task-${citySpec.key}-${districtIndex}-${taskIndex}-stage-${stageIndex}`,
                                                  });
        }
      }
      if (lifecycle === "COMPLETED" && district.status !== "COMPLETED") {
        await service.completeDistrict(countryId, district.id, `representative-district-${citySpec.key}-${districtIndex}-complete`);
      }
    }
  }

  return { cities: await service.listCities(countryId), districts: await service.listDistricts(countryId), tasks: await service.listTasks(countryId) };
}

export function seedDevelopmentCountry(service: AppService, countryId: string): Promise<RepresentativeCountryResult> {
  return seedCountryFixture(service, countryId, DEVELOPMENT_CITIES, 3);
}
