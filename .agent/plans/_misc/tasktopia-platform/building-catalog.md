# Каталог зданий и назначение задач

## Catalog schema

```ts
type BuildingCatalogEntry = {
  key: string;
  category: string;
  tags: string[];
  footprintTemplates: Array<{ offsets: Array<[number, number]>; rotations: number[] }>;
  estimateWeights: Partial<Record<1 | 2 | 3 | 6, number>>;
  roadAccess: "NONE" | "NEAR" | "DIRECT";
  terrain: string[];
  cityMinPopulation?: number;
  maxPerCity?: number;
  maxPerDistrict?: number;
  prerequisites?: string[];
  adjacencyPreferences?: string[];
  assetFamily: string;
  stages: 5;
};
```

Одна catalog entry не обязана иметь уникальную графику в MVP: несколько записей могут использовать общую asset family с palette/roof/decal variants. Доменная разновидность создаётся раньше полного набора художественных ассетов.

## Стартовый каталог

### Жильё — 10

| Key | Здание | Footprint | Estimate |
| --- | --- | ---: | --- |
| `res_cottage` | коттедж | 1 | 1–2 |
| `res_duplex` | дуплекс | 1 | 2 |
| `res_rowhouse` | рядный дом | 1–2 | 2–3 |
| `res_courtyard` | дом с внутренним двором | 2–3 | 3–6 |
| `res_lowrise` | малоэтажный дом | 1 | 2–3 |
| `res_midrise` | среднеэтажный дом | 1–2 | 3–6 |
| `res_tower` | жилая башня | 2 | 6 |
| `res_dormitory` | общежитие | 2 | 3–6 |
| `res_modular` | модульное жильё | 1 | 1–2 |
| `res_waterfront` | дом у воды | 1–2 | 3 |

### Экстренные и городские службы — 10

| Key | Здание | Footprint | Quota |
| --- | --- | ---: | --- |
| `civic_police` | полиция | 2 | 1 на город до расширения |
| `civic_fire` | пожарная часть | 2–3 | 1 на город |
| `civic_ambulance` | станция скорой | 1–2 | 1 на город |
| `civic_clinic` | клиника | 1–2 | 1–2 на город |
| `civic_hospital` | больница | 3 | unique landmark |
| `civic_school` | школа | 2–3 | по потребности жилья |
| `civic_library` | библиотека | 1–2 | 1 на город |
| `civic_cityhall` | мэрия | 2–3 | unique |
| `civic_post` | почта | 1 | 1–2 на город |
| `civic_courthouse` | суд | 2 | unique/late |

### Торговля и услуги — 10

| Key | Здание | Footprint | Notes |
| --- | --- | ---: | --- |
| `shop_kiosk` | киоск | 1 | micro variant cluster |
| `shop_convenience` | магазин у дома | 1 | частый |
| `shop_pharmacy` | аптека | 1 | рядом с жильём/клиникой |
| `shop_supermarket` | супермаркет | 2 | parking adjacency |
| `shop_mall` | торговый центр | 3 | estimate 6 |
| `shop_cafe` | кафе | 1 | центр/парк |
| `shop_restaurant` | ресторан | 1–2 | центр/вода |
| `service_gas` | заправка | 2 | direct road access |
| `service_hotel` | гостиница | 1–2 | центр/вокзал |
| `service_office` | офис | 1–2 | деловой район |

### Культура и отдых — 8

- `culture_theatre` — театр, 2–3 hex, unique;
- `culture_cinema` — кинотеатр, 2 hex;
- `culture_museum` — музей, 2–3 hex;
- `culture_stadium` — стадион, 3+ hex, post-MVP visual;
- `park_city` — городской парк, 2–3 hex;
- `park_playground` — площадка, 1 hex;
- `park_square` — площадь, 1–2 hex;
- `culture_community` — общественный центр, 1–2 hex.

### Транспорт и инфраструктура — 12

- `transport_parking` — парковка, 1–2 hex;
- `transport_bus_depot` — автобусное депо, 2 hex;
- `transport_station` — вокзал, 2–3 hex;
- `transport_port` — порт, 3+ hex и shoreline;
- `transport_airport` — аэропорт, 6+ hex, post-MVP;
- `infra_substation` — подстанция, 1 hex;
- `infra_water_tower` — водонапорная башня, 1 hex;
- `infra_waste` — переработка отходов, 2 hex;
- `infra_warehouse` — склад, 1–2 hex;
- `infra_workshop` — мастерская, 1 hex;
- `infra_factory` — фабрика, 2–3 hex;
- `infra_datacenter` — дата-центр, 2 hex.

Итого каталог содержит 50 записей. Для MVP достаточно 8–12 asset families и детерминированных вариантов крыш, фасадов и декалей; уникальные landmark families добавляются поэтапно.

## City needs model

Город хранит агрегированные capabilities:

- housing;
- food/retail;
- health;
- fire safety;
- police;
- education;
- culture;
- transport;
- utilities;
- jobs/industry;
- recreation.

Catalog entry добавляет значения capabilities. Selector сначала закрывает дефицит, затем повышает визуальное разнообразие.

## Semantic mapping

Task title/description могут давать tags:

- auth/security → police/datacenter/office;
- performance/infrastructure → substation/datacenter/transport;
- health/incident → clinic/ambulance/fire;
- docs/knowledge → library/school;
- commerce/payment → shop/office;
- media/design → theatre/museum/cinema;
- generic feature → housing/office/shop с city-needs приоритетом.

LLM classification является подсказкой. Итоговый выбор проходит deterministic catalog rules и placement validation.

## Micro tasks

Estimate 1 может визуально создавать группу мелких объектов на одном гексе: два киоска, маленькие домики, площадку, стройматериалы. В домене это одно building/task с одним footprint и несколькими child sprites, а не несколько независимых задач.

## Multihex templates

MVP поддерживает только связные шаблоны:

- 1 hex;
- 2 adjacent hexes;
- 3-hex straight;
- 3-hex compact triangle.

Каждый template проверяется во всех разрешённых rotations. Произвольные footprint polygons откладываются.

