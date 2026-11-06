import type {CityLifeKind} from './city-life';
import type {RoadEventKind} from './city-road-events';
import type {EverydayKind} from './city-everyday-life';

export const CITY_LIFE_ACTIONS = ["BAG","BOX","BULB","BUNTING","COLLECT","CONE","CUP","ENVELOPE","FIRST_AID","FLOWERS","FOOD","HOSE","INSPECT","KEY","LABEL","LADDER","MEASURE","MOP","MUSIC","PAINT","PLANT","PRUNE","RAKE","READ","SIGN","SIGNAL","SORT","SWEEP","TICKET","TOOLS","UNPACK","WASH","WATER","WAVE"] as const;
export type CityLifeAction = typeof CITY_LIFE_ACTIONS[number];
export const CITY_LIFE_CONTEXTS = ['HOME','SHOP','GREEN','PAVED','WATER_EDGE','EDUCATION','MEDICAL','POLICE','FIRE','CIVIC','RAILWAY','AIRPORT','PORT'] as const;
export type CityLifeContext = typeof CITY_LIFE_CONTEXTS[number];
type ContextRule = CityLifeContext | 'ANY' | 'BUILDING';
type Steps = readonly [CityLifeAction,CityLifeAction] | readonly [CityLifeAction,CityLifeAction,CityLifeAction];
type RecipeBase = {readonly id:string;readonly label:string};
export type NeighbourhoodRecipe = RecipeBase & {readonly channel:'NEIGHBOURHOOD';readonly kind:CityLifeKind;readonly contexts:readonly ContextRule[];readonly steps:Steps};
export type RoadRecipe = RecipeBase & {readonly channel:'ROAD';readonly kind:RoadEventKind};
export type EverydayRecipe = RecipeBase & {readonly channel:'EVERYDAY';readonly kind:EverydayKind;readonly freshCompletion:boolean};
export type CityEventRecipe = NeighbourhoodRecipe | RoadRecipe | EverydayRecipe;
export const CITY_RECIPE_WORK_MS = 12_000;

/** Each script has a distinct observable action sequence at a real site.
 * Context lists are shared, never expanded into81 sites for every task. */
export const NEIGHBOURHOOD_RECIPES = [
  {id:"home-moving",channel:'NEIGHBOURHOOD',kind:"MOVING",label:"Переезд: разбор коробок",contexts:["HOME"],steps:["BOX","UNPACK","SORT"]},
  {id:"home-parcel",channel:'NEIGHBOURHOOD',kind:"DELIVERY",label:"Получение посылки",contexts:["HOME"],steps:["TICKET","UNPACK","READ"]},
  {id:"home-groceries",channel:'NEIGHBOURHOOD',kind:"DELIVERY",label:"Продукты для дома",contexts:["HOME"],steps:["BAG","FOOD","SORT"]},
  {id:"home-flowers",channel:'NEIGHBOURHOOD',kind:"GARDEN",label:"Цветы у входа",contexts:["HOME"],steps:["FLOWERS","WATER","BUNTING"]},
  {id:"home-furniture",channel:'NEIGHBOURHOOD',kind:"MOVING",label:"Доставка обстановки",contexts:["HOME"],steps:["BOX","MEASURE","UNPACK"]},
  {id:"home-gift",channel:'NEIGHBOURHOOD',kind:"CELEBRATION",label:"Подарок соседям",contexts:["HOME"],steps:["BOX","FLOWERS","WAVE"]},
  {id:"home-letter",channel:'NEIGHBOURHOOD',kind:"READING",label:"Письмо у дома",contexts:["HOME"],steps:["ENVELOPE","READ","COLLECT"]},
  {id:"home-sort",channel:'NEIGHBOURHOOD',kind:"MOVING",label:"Разбор домашних вещей",contexts:["HOME"],steps:["SORT","LABEL","BOX"]},
  {id:"home-tea",channel:'NEIGHBOURHOOD',kind:"CELEBRATION",label:"Чай на крыльце",contexts:["HOME"],steps:["CUP","READ","WAVE"]},
  {id:"home-reading",channel:'NEIGHBOURHOOD',kind:"READING",label:"Чтение на воздухе",contexts:["HOME"],steps:["READ","INSPECT","TICKET"]},
  {id:"home-mail",channel:'NEIGHBOURHOOD',kind:"DELIVERY",label:"Проверка почты",contexts:["HOME"],steps:["ENVELOPE","KEY","TICKET"]},
  {id:"home-recycle",channel:'NEIGHBOURHOOD',kind:"CLEANING",label:"Подготовка вторсырья",contexts:["HOME"],steps:["SORT","COLLECT","BAG"]},
  {id:"shop-stock",channel:'NEIGHBOURHOOD',kind:"DELIVERY",label:"Приём товара",contexts:["SHOP"],steps:["BOX","SORT","LABEL"]},
  {id:"shop-produce",channel:'NEIGHBOURHOOD',kind:"DELIVERY",label:"Доставка продуктов",contexts:["SHOP"],steps:["BAG","FOOD","TICKET"]},
  {id:"shop-bread",channel:'NEIGHBOURHOOD',kind:"DELIVERY",label:"Разбор хлебных корзин",contexts:["SHOP"],steps:["BOX","FOOD","SORT"]},
  {id:"shop-window",channel:'NEIGHBOURHOOD',kind:"MAINTENANCE",label:"Уход за витриной",contexts:["SHOP"],steps:["WASH","SIGN","INSPECT"]},
  {id:"shop-market",channel:'NEIGHBOURHOOD',kind:"DELIVERY",label:"Подготовка прилавка",contexts:["SHOP"],steps:["BOX","SIGN","FOOD"]},
  {id:"shop-flowers",channel:'NEIGHBOURHOOD',kind:"DELIVERY",label:"Цветочный заказ",contexts:["SHOP"],steps:["FLOWERS","LABEL","WAVE"]},
  {id:"shop-coffee",channel:'NEIGHBOURHOOD',kind:"DELIVERY",label:"Кофе с собой",contexts:["SHOP"],steps:["TICKET","CUP","WAVE"]},
  {id:"shop-parcel",channel:'NEIGHBOURHOOD',kind:"DELIVERY",label:"Передача отправления",contexts:["SHOP"],steps:["ENVELOPE","LABEL","BOX"]},
  {id:"shop-inventory",channel:'NEIGHBOURHOOD',kind:"MAINTENANCE",label:"Проверка поставки",contexts:["SHOP"],steps:["TICKET","SORT","INSPECT"]},
  {id:"shop-decor",channel:'NEIGHBOURHOOD',kind:"CELEBRATION",label:"Оформление витрины",contexts:["SHOP"],steps:["SIGN","BUNTING","WAVE"]},
  {id:"garden-water",channel:'NEIGHBOURHOOD',kind:"GARDEN",label:"Полив посадок",contexts:["GREEN"],steps:["WATER","PLANT","INSPECT"]},
  {id:"garden-prune",channel:'NEIGHBOURHOOD',kind:"GARDEN",label:"Обрезка ветвей",contexts:["GREEN"],steps:["PRUNE","COLLECT","WATER"]},
  {id:"garden-rake",channel:'NEIGHBOURHOOD',kind:"GARDEN",label:"Сбор листвы",contexts:["GREEN"],steps:["RAKE","COLLECT","BAG"]},
  {id:"garden-plant",channel:'NEIGHBOURHOOD',kind:"GARDEN",label:"Новые растения",contexts:["GREEN"],steps:["MEASURE","PLANT","WATER"]},
  {id:"garden-mulch",channel:'NEIGHBOURHOOD',kind:"GARDEN",label:"Уход за почвой",contexts:["GREEN"],steps:["BAG","RAKE","WATER"]},
  {id:"garden-seed",channel:'NEIGHBOURHOOD',kind:"GARDEN",label:"Разметка посевов",contexts:["GREEN"],steps:["LABEL","PLANT","WATER"]},
  {id:"garden-check",channel:'NEIGHBOURHOOD',kind:"GARDEN",label:"Осмотр цветника",contexts:["GREEN"],steps:["INSPECT","PRUNE","FLOWERS"]},
  {id:"garden-supply",channel:'NEIGHBOURHOOD',kind:"DELIVERY",label:"Садовые принадлежности",contexts:["GREEN"],steps:["BOX","UNPACK","WATER"]},
  {id:"garden-edge",channel:'NEIGHBOURHOOD',kind:"GARDEN",label:"Уход за краем дорожки",contexts:["GREEN"],steps:["MEASURE","PRUNE","SWEEP"]},
  {id:"garden-tools",channel:'NEIGHBOURHOOD',kind:"GARDEN",label:"Очистка садового инструмента",contexts:["GREEN"],steps:["TOOLS","WASH","COLLECT"]},
  {id:"garden-label",channel:'NEIGHBOURHOOD',kind:"GARDEN",label:"Таблички у растений",contexts:["GREEN"],steps:["READ","LABEL","PLANT"]},
  {id:"garden-mark",channel:'NEIGHBOURHOOD',kind:"GARDEN",label:"Отметка садовых работ",contexts:["GREEN"],steps:["PRUNE","LABEL","INSPECT"]},
  {id:"garden-decor",channel:'NEIGHBOURHOOD',kind:"CELEBRATION",label:"Оформление сквера",contexts:["GREEN"],steps:["FLOWERS","BUNTING","SIGN"]},
  {id:"garden-display",channel:'NEIGHBOURHOOD',kind:"CELEBRATION",label:"Небольшая выставка цветов",contexts:["GREEN"],steps:["SIGN","TICKET","FLOWERS"]},
  {id:"culture-practice",channel:'NEIGHBOURHOOD',kind:"MUSIC",label:"Музыкальная репетиция",contexts:["GREEN","CIVIC","EDUCATION"],steps:["MUSIC","WAVE","MUSIC"]},
  {id:"culture-books",channel:'NEIGHBOURHOOD',kind:"READING",label:"Обмен книгами",contexts:["GREEN","CIVIC","EDUCATION"],steps:["BAG","READ","ENVELOPE"]},
  {id:"culture-drawing",channel:'NEIGHBOURHOOD',kind:"ART",label:"Рисование на воздухе",contexts:["GREEN","CIVIC","EDUCATION"],steps:["TICKET","PAINT","INSPECT"]},
  {id:"culture-flowers",channel:'NEIGHBOURHOOD',kind:"CELEBRATION",label:"Составление букета",contexts:["GREEN","CIVIC","EDUCATION"],steps:["FLOWERS","PRUNE","BUNTING"]},
  {id:"culture-festival",channel:'NEIGHBOURHOOD',kind:"CELEBRATION",label:"Подготовка украшений",contexts:["GREEN","CIVIC","EDUCATION"],steps:["BOX","BUNTING","SIGN"]},
  {id:"culture-lecture",channel:'NEIGHBOURHOOD',kind:"CULTURE",label:"Рассказ на площади",contexts:["GREEN","CIVIC","EDUCATION"],steps:["TICKET","READ","WAVE"]},
  {id:"culture-break",channel:'NEIGHBOURHOOD',kind:"MUSIC",label:"Перерыв музыканта",contexts:["GREEN","CIVIC","EDUCATION"],steps:["MUSIC","READ","CUP"]},
  {id:"culture-notice",channel:'NEIGHBOURHOOD',kind:"CELEBRATION",label:"Афиша дворовой встречи",contexts:["GREEN","CIVIC","EDUCATION"],steps:["SIGN","LABEL","READ"]},
  {id:"clean-sweep",channel:'NEIGHBOURHOOD',kind:"CLEANING",label:"Подметание подхода",contexts:["ANY"],steps:["SWEEP","COLLECT","INSPECT"]},
  {id:"clean-entry",channel:'NEIGHBOURHOOD',kind:"CLEANING",label:"Мытьё подхода",contexts:["ANY"],steps:["MOP","WASH","COLLECT"]},
  {id:"clean-leaves",channel:'NEIGHBOURHOOD',kind:"CLEANING",label:"Уборка листьев у входа",contexts:["ANY"],steps:["RAKE","COLLECT","LABEL"]},
  {id:"clean-litter",channel:'NEIGHBOURHOOD',kind:"CLEANING",label:"Сбор мелкого мусора",contexts:["ANY"],steps:["COLLECT","BAG","SORT"]},
  {id:"clean-store",channel:'NEIGHBOURHOOD',kind:"CLEANING",label:"Уборочные принадлежности",contexts:["BUILDING"],steps:["KEY","COLLECT","WASH"]},
  {id:"clean-check",channel:'NEIGHBOURHOOD',kind:"CLEANING",label:"Уборка и осмотр",contexts:["ANY"],steps:["WASH","TOOLS","INSPECT"]},
  {id:"clean-recycle",channel:'NEIGHBOURHOOD',kind:"CLEANING",label:"Сортировка собранного",contexts:["ANY"],steps:["SORT","LABEL","COLLECT"]},
  {id:"clean-yard",channel:'NEIGHBOURHOOD',kind:"CLEANING",label:"Уборка дворовой дорожки",contexts:["ANY"],steps:["SWEEP","MOP","WAVE"]},
  {id:"clean-unpack",channel:'NEIGHBOURHOOD',kind:"CLEANING",label:"Подготовка к уборке",contexts:["ANY"],steps:["BOX","UNPACK","MOP"]},
  {id:"clean-after",channel:'NEIGHBOURHOOD',kind:"CLEANING",label:"Снятие временного оформления",contexts:["ANY"],steps:["BUNTING","COLLECT","SWEEP"]},
  {id:"maint-measure",channel:'NEIGHBOURHOOD',kind:"MAINTENANCE",label:"Замер у входа",contexts:["BUILDING"],steps:["MEASURE","INSPECT"]},
  {id:"maint-door",channel:'NEIGHBOURHOOD',kind:"MAINTENANCE",label:"Осмотр входа",contexts:["BUILDING"],steps:["INSPECT","TOOLS","LADDER"]},
  {id:"maint-porch",channel:'NEIGHBOURHOOD',kind:"MAINTENANCE",label:"Обновление крыльца",contexts:["BUILDING"],steps:["SWEEP","PAINT","INSPECT"]},
  {id:"maint-lamp",channel:'NEIGHBOURHOOD',kind:"MAINTENANCE",label:"Замена лампы у двери",contexts:["BUILDING"],steps:["LADDER","BULB","INSPECT"]},
  {id:"maint-canopy",channel:'NEIGHBOURHOOD',kind:"MAINTENANCE",label:"Проверка козырька",contexts:["BUILDING"],steps:["MEASURE","LADDER","TOOLS"]},
  {id:"maint-sign",channel:'NEIGHBOURHOOD',kind:"MAINTENANCE",label:"Монтаж таблички",contexts:["BUILDING"],steps:["MEASURE","SIGN","TOOLS"]},
  {id:"maint-rail",channel:'NEIGHBOURHOOD',kind:"MAINTENANCE",label:"Уход за ограждением входа",contexts:["BUILDING"],steps:["WASH","PAINT","TOOLS"]},
  {id:"maint-window",channel:'NEIGHBOURHOOD',kind:"MAINTENANCE",label:"Мытьё окна у входа",contexts:["BUILDING"],steps:["LADDER","WASH","INSPECT"]},
  {id:"maint-tile",channel:'NEIGHBOURHOOD',kind:"MAINTENANCE",label:"Обслуживание покрытия",contexts:["BUILDING"],steps:["MEASURE","TOOLS","SWEEP"]},
  {id:"maint-drain",channel:'NEIGHBOURHOOD',kind:"MAINTENANCE",label:"Очистка стока",contexts:["BUILDING"],steps:["INSPECT","COLLECT","WASH"]},
  {id:"maint-lock",channel:'NEIGHBOURHOOD',kind:"MAINTENANCE",label:"Обслуживание замка",contexts:["BUILDING"],steps:["KEY","TOOLS","INSPECT"]},
  {id:"maint-steps",channel:'NEIGHBOURHOOD',kind:"MAINTENANCE",label:"Мытьё ступеней",contexts:["BUILDING"],steps:["SWEEP","MOP","WASH"]},
  {id:"service-books",channel:'NEIGHBOURHOOD',kind:"DELIVERY",label:"Возврат учебных книг",contexts:["EDUCATION"],steps:["TICKET","READ","BAG"]},
  {id:"service-school",channel:'NEIGHBOURHOOD',kind:"DELIVERY",label:"Учебные принадлежности",contexts:["EDUCATION"],steps:["BOX","SORT","READ"]},
  {id:"service-notice",channel:'NEIGHBOURHOOD',kind:"MAINTENANCE",label:"Обновление школьной информации",contexts:["EDUCATION"],steps:["READ","SIGN","TICKET"]},
  {id:"service-medical",channel:'NEIGHBOURHOOD',kind:"DELIVERY",label:"Приём медицинских принадлежностей",contexts:["MEDICAL"],steps:["BOX","FIRST_AID","TICKET"]},
  {id:"service-kit",channel:'NEIGHBOURHOOD',kind:"MAINTENANCE",label:"Проверка аптечки",contexts:["MEDICAL"],steps:["FIRST_AID","INSPECT","LABEL"]},
  {id:"service-safety",channel:'NEIGHBOURHOOD',kind:"DELIVERY",label:"Памятки по безопасности",contexts:["POLICE"],steps:["TICKET","ENVELOPE","WAVE"]},
  {id:"service-permit",channel:'NEIGHBOURHOOD',kind:"DELIVERY",label:"Документы у администрации",contexts:["CIVIC"],steps:["TICKET","READ","LABEL"]},
  {id:"service-drill",channel:'NEIGHBOURHOOD',kind:"DRILL",label:"Учебная проверка расчёта",contexts:["FIRE"],steps:["SIGNAL","CONE","HOSE"]},
  {id:"service-hose",channel:'NEIGHBOURHOOD',kind:"DRILL",label:"Проверка пожарного оснащения",contexts:["FIRE"],steps:["HOSE","INSPECT","TOOLS"]},
  {id:"transport-bag",channel:'NEIGHBOURHOOD',kind:"DELIVERY",label:"Подготовка багажа",contexts:["AIRPORT"],steps:["BAG","LABEL","TICKET"]},
  {id:"transport-gate",channel:'NEIGHBOURHOOD',kind:"MAINTENANCE",label:"Информация у терминала",contexts:["AIRPORT"],steps:["SIGN","TICKET","WAVE"]},
  {id:"transport-luggage",channel:'NEIGHBOURHOOD',kind:"MOVING",label:"Разбор дорожных вещей",contexts:["RAILWAY"],steps:["BOX","LABEL","BAG"]},
  {id:"transport-ticket",channel:'NEIGHBOURHOOD',kind:"DELIVERY",label:"Проверка проездных документов",contexts:["RAILWAY"],steps:["TICKET","ENVELOPE","READ"]},
  {id:"transport-cargo",channel:'NEIGHBOURHOOD',kind:"DELIVERY",label:"Маркировка груза",contexts:["PORT"],steps:["BOX","TOOLS","LABEL"]},
  {id:"transport-quay",channel:'NEIGHBOURHOOD',kind:"MAINTENANCE",label:"Осмотр подхода к причалу",contexts:["PORT"],steps:["SIGNAL","INSPECT","TICKET"]},
] as const satisfies readonly NeighbourhoodRecipe[];

// Preserve the existing road planner's order and every finite handler.
export const ROAD_EVENT_RECIPES = [
  {id:"road-accident",channel:'ROAD',kind:"ACCIDENT",label:"Дорожная авария"},
  {id:"road-repair",channel:'ROAD',kind:"REPAIR",label:"Ремонт дороги"},
  {id:"road-fire",channel:'ROAD',kind:"FIRE",label:"Пожар на дороге"},
  {id:"road-medical",channel:'ROAD',kind:"MEDICAL",label:"Медицинская помощь"},
  {id:"road-patrol",channel:'ROAD',kind:"PATROL",label:"Патруль"},
  {id:"road-breakdown",channel:'ROAD',kind:"BREAKDOWN",label:"Помощь сломавшейся машине"},
  {id:"road-water",channel:'ROAD',kind:"WATER",label:"Ремонт водопровода"},
] as const satisfies readonly RoadRecipe[];

// Opening entries stay in the confirmed-completion path, not a random window.
export const EVERYDAY_EVENT_RECIPES = [
  {id:"daily-school",channel:'EVERYDAY',kind:"SCHOOL",label:"В школу",freshCompletion:false},
  {id:"daily-kindergarten",channel:'EVERYDAY',kind:"KINDERGARTEN",label:"В детский сад",freshCompletion:false},
  {id:"daily-bus",channel:'EVERYDAY',kind:"BUS",label:"Городской автобус",freshCompletion:false},
  {id:"daily-market",channel:'EVERYDAY',kind:"MARKET",label:"Ярмарка",freshCompletion:false},
  {id:"daily-sport",channel:'EVERYDAY',kind:"SPORT",label:"Игра во дворе",freshCompletion:false},
  {id:"daily-dog",channel:'EVERYDAY',kind:"DOG",label:"Прогулка с собакой",freshCompletion:false},
  {id:"daily-birds",channel:'EVERYDAY',kind:"BIRDS",label:"Кормление птиц",freshCompletion:false},
  {id:"open-school",channel:'EVERYDAY',kind:"OPEN_SCHOOL",label:"Открытие школы",freshCompletion:true},
  {id:"open-kindergarten",channel:'EVERYDAY',kind:"OPEN_KINDERGARTEN",label:"Открытие детского сада",freshCompletion:true},
  {id:"open-shop",channel:'EVERYDAY',kind:"OPEN_SHOP",label:"Первые покупатели",freshCompletion:true},
  {id:"open-fire",channel:'EVERYDAY',kind:"OPEN_FIRE",label:"Открытие пожарной части",freshCompletion:true},
  {id:"open-building",channel:'EVERYDAY',kind:"OPEN_BUILDING",label:"Новоселье",freshCompletion:true},
] as const satisfies readonly EverydayRecipe[];

export const CITY_EVENT_CATALOG:readonly CityEventRecipe[] = Object.freeze([...NEIGHBOURHOOD_RECIPES,...ROAD_EVENT_RECIPES,...EVERYDAY_EVENT_RECIPES]);
const byId=new Map<string,CityEventRecipe>(CITY_EVENT_CATALOG.map(recipe=>[recipe.id,recipe]));
export const cityEventRecipe=(id:string):CityEventRecipe|undefined=>byId.get(id);
const noRecipes:readonly NeighbourhoodRecipe[]=Object.freeze([]);
const eligible=new Map<CityLifeContext,readonly NeighbourhoodRecipe[]>(CITY_LIFE_CONTEXTS.map(context=>[
  context,Object.freeze(NEIGHBOURHOOD_RECIPES.filter((recipe:NeighbourhoodRecipe)=>recipe.contexts.includes('ANY')||recipe.contexts.includes(context)
    ||recipe.contexts.includes('BUILDING')&&!['GREEN','PAVED','WATER_EDGE'].includes(context))),
] as const));
export const eligibleNeighbourhoodRecipes=(context:CityLifeContext):readonly NeighbourhoodRecipe[]=>eligible.get(context)??noRecipes;

/** The controller supplies elapsed time only after actual arrival. */
export function sampleRecipeAction(recipe:NeighbourhoodRecipe,elapsed:number):{action:CityLifeAction;step:number}|undefined{
  if(!Number.isFinite(elapsed)||elapsed<0||elapsed>=CITY_RECIPE_WORK_MS)return;
  const step=Math.floor(elapsed/CITY_RECIPE_WORK_MS*recipe.steps.length);
  return {action:recipe.steps[step]!,step};
}
