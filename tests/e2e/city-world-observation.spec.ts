import {expect,test,devices,type Page} from "@playwright/test";
import {readFileSync} from "node:fs";
import type {CitySceneDto} from "../../src/shared/city-scene-contract";
import {planCityAirServices} from "../../src/shared/city-air-service";
import {planCityRailServices} from "../../src/shared/city-rail-service";
import {planCitySeaServices} from "../../src/shared/city-sea-service";
import {TRANSPORT_EPOCH,transportJourney} from "../../src/shared/transport-schedule";
import {installSceneClock} from "./city-scene-clock";
test.use(process.env.E2E_OBSERVATION_TOUCH==="true"?{...devices["Pixel 7"],serviceWorkers:"block"}:{});
test.skip(process.env.E2E_WORLD_OBSERVATION!=="true","Requires the isolated owned transport world");
const fixture=()=>JSON.parse(readFileSync(".builder/world-reliability-evolution-20261016/transport/functional-fixture.json","utf8")) as {sites:{countryId:string;city:{id:string;name:string}}[]};
async function entry(page:Page,kind:"AIR"|"RAIL"|"SEA"){
 expect(new URL(process.env.E2E_BASE_URL!).hostname).toMatch(/^(127\.0\.0\.1|localhost)$/);
 const site=fixture().sites[0]!;await installSceneClock(page);
 await page.addInitScript(()=>localStorage.setItem("tasktopia:world-preferences:v2",JSON.stringify({quality:"NORMAL",cityLife:true,sound:false})));
 expect((await page.request.post("/api/auth/login",{data:{email:"transport-qa@example.test",password:"tasktopia-transport-qa"}})).status()).toBe(200);
 const scene=await(await page.request.get(`/api/countries/${site.countryId}/cities/${site.city.id}/scene`)).json() as CitySceneDto;
 const plan=kind==="AIR"?planCityAirServices(scene)[0]!:kind==="RAIL"?planCityRailServices(scene.railway!,scene.railConnections??[])[0]!:planCitySeaServices(scene.ports??[],scene.seaConnections??[])[0]!;
 expect(plan).toBeTruthy();const stop=kind==="AIR"?scene.airports![0]!.taskId:kind==="RAIL"?scene.railway!.stationId:scene.ports![0]!.taskId;
 const origin=TRANSPORT_EPOCH-plan.schedule.offsetMs+(stop===plan.schedule.fromId?0:plan.schedule.dwellMs+plan.schedule.travelMs)+12_000;
 // Playwright's fulfilled Firefox responses do not decode the zstd body kept
 // by route.fetch. Read the real payload without compression before replacing
 // only the simulation-clock header; native compression is tested separately.
 await page.route("**/api/**",async route=>{const response=await route.fetch({headers:{...route.request().headers(),"accept-encoding":"identity"}});await route.fulfill({response,headers:{...response.headers(),"x-tasktopia-server-time":String(origin)}});});
 expect((await page.request.post(`/api/countries/${site.countryId}/select`)).status()).toBe(200);
 await page.goto("/");await expect(page.locator(".planet-atlas")).toHaveAttribute("data-planet-ready","true",{timeout:30_000});
 const target=page.locator(`.planet-city-targets [data-city-id="${site.city.id}"]`);await target.focus();await page.keyboard.press("Enter");
 const host=page.locator(".world-canvas");await expect(host).toHaveAttribute("data-city-scene-commit","atomic",{timeout:30_000});await expect(host).toHaveAttribute("data-mobility-ready","true");
 return {host,scene,site};
}
for(const [kind,title] of [["AIR","Самолёт"],["RAIL","Поезд"],["SEA","Паром"]] as const)test(`real ${kind} inspector opens without automatic motion, follows only on request and cancels on manual navigation`,async({page},info)=>{
 test.setTimeout(90_000);const errors:string[]=[];page.on("pageerror",error=>errors.push(error.message));
 const {host,site,scene}=await entry(page,kind),canvas=host.locator("canvas"),identity=await canvas.elementHandle();
 await page.evaluate(()=>document.fonts.ready);expect(await page.evaluate(()=>document.fonts.check("400 14px Manrope"))).toBe(true);
 const readPose=()=>host.evaluate(node=>{const d=(node as HTMLElement).dataset;return {x:d.cameraWorldX,y:d.cameraWorldY,scale:d.renderScale};});
 const before=await readPose(),trigger=page.getByRole("button",{name:"Сейчас в городе",exact:true});
 const nav=(await page.getByRole("navigation",{name:"Уровень карты"}).boundingBox())!,button=(await trigger.boundingBox())!;
 const overlaps=(a:typeof nav,b:typeof nav)=>a.x<b.x+b.width&&a.x+a.width>b.x&&a.y<b.y+b.height&&a.y+a.height>b.y;
 expect(overlaps(nav,button),"Tour trigger must not cover map navigation").toBe(false);await trigger.click();
 const tour=page.getByRole("complementary",{name:"Интересное в городе"});await expect(tour).toBeVisible();expect(await readPose()).toEqual(before);
 await tour.getByRole("button").filter({has:page.getByText(title,{exact:true})}).first().click();
 const panel=page.getByRole("complementary",{name:"Наблюдение за городом"});await expect(panel.getByRole("heading",{name:title,exact:true})).toBeVisible();
 await expect(panel).toContainText(site.city.name);await expect(panel).not.toContainText("Другой город");
 const follow=panel.getByRole("button",{name:"Следить за транспортом",exact:true});await expect(follow).toHaveAttribute("aria-pressed","false");
 await expect(host).toHaveAttribute("data-camera-presentation-pending","false");const chosen=await readPose();await page.waitForTimeout(350);expect(await readPose()).toEqual(chosen);
 await follow.click();await expect(panel.getByRole("button",{name:"Прекратить слежение"})).toHaveAttribute("aria-pressed","true");
 const selectedVehicle=(await panel.getAttribute("data-world-vehicle"))!;
 const plans=kind==="AIR"?planCityAirServices(scene):kind==="RAIL"?planCityRailServices(scene.railway!,scene.railConnections??[]):planCitySeaServices(scene.ports??[],scene.seaConnections??[]);
 const plan=plans.find(plan=>plan.vehicleId===selectedVehicle)!;
 const stop=kind==="AIR"?scene.airports![0]!.taskId:kind==="RAIL"?scene.railway!.stationId:scene.ports![0]!.taskId;
 const now=Number(await host.getAttribute("data-road-event-server-now")),journey=transportJourney(plan.schedule,stop,now,plan.fleetIndex);
 const movingBefore=await readPose();
 await page.clock.fastForward(Math.max(0,journey.phase==="STOPPED"?plan.schedule.dwellMs-journey.dwellElapsedMs:0)+2500);
 await page.clock.runFor(250);
 await expect.poll(readPose).not.toEqual(movingBefore);
 await expect(host).toHaveAttribute("data-camera-presentation-pending","false");
 await canvas.focus();await page.keyboard.press("ArrowRight");await expect(follow).toHaveAttribute("aria-pressed","false");
 const rect=(await panel.boundingBox())!;expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.y).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual((page.viewportSize()!).width);
 expect(overlaps(rect,nav),"Inspector must leave map navigation usable").toBe(false);
 await page.screenshot({path:info.outputPath(`native-${kind.toLowerCase()}-inspector.png`)});
 await follow.click();await expect(panel.getByRole("button",{name:"Прекратить слежение"})).toBeVisible();
 await page.emulateMedia({reducedMotion:"reduce"});await expect(host).toHaveAttribute("data-animation-active","false");
 await expect(panel.getByRole("button",{name:"Прекратить слежение"})).toHaveCount(0);
 await panel.getByRole("button",{name:"Открыть задачу",exact:true}).click();await expect(page.locator("#task-title")).toBeVisible();
 expect(await identity!.evaluate(node=>node.isConnected)).toBe(true);expect(errors).toEqual([]);
});

test("a real road episode exposes actual services and closures, ends cleanly and never leaves a permanent map label",async({page},info)=>{
 test.setTimeout(90_000);const {host}=await entry(page,"AIR");
 await page.clock.pauseAt(await page.evaluate(()=>new Date(Date.now()+1000).toISOString()));
 let kind="";
 for(let attempt=0;attempt<4&&!kind;attempt++){
  const next=Number(await host.getAttribute("data-road-event-next-start")),now=Number(await host.getAttribute("data-road-event-server-now"));
  await page.clock.fastForward(Math.max(0,next-now+300));await page.clock.runFor(200);
  for(let step=0;step<3&&!kind;step++){kind=(await host.getAttribute("data-road-event"))??"";if(!kind)await page.clock.runFor(300);}
 }
 expect(kind,"Owned road graph must dispatch one reachable real episode").not.toBe("");
 const names:Record<string,string>={ACCIDENT:"Дорожная авария",REPAIR:"Ремонт дороги",FIRE:"Пожар на дороге",MEDICAL:"Медицинская помощь",PATROL:"Патруль",BREAKDOWN:"Помощь сломавшейся машине",WATER:"Ремонт водопровода"};
 await page.getByRole("button",{name:"Сейчас в городе",exact:true}).click();
 await page.getByRole("complementary",{name:"Интересное в городе"}).getByRole("button").filter({has:page.getByText(names[kind]!,{exact:true})}).click();
 const panel=page.getByRole("complementary",{name:"Наблюдение за городом"});await expect(panel).toHaveAttribute("data-world-kind","ROAD");
 expect(Number(await panel.getAttribute("data-closed-cells"))).toBe(Number(await host.getAttribute("data-road-closed-cells")));
 await expect(panel).toContainText(/Полиция|Пожарные|Скорая помощь|Ремонтная служба|Эвакуатор/);
 await page.screenshot({path:info.outputPath("native-road-inspector.png")});
 await page.clock.fastForward(31_000);await page.clock.runFor(300);
 await expect(host).toHaveAttribute("data-road-event","");await expect(host).toHaveAttribute("data-road-closed-cells","0");
 await expect(panel).toContainText("Это событие завершилось.");
 await panel.getByRole("button",{name:"Закрыть наблюдение"}).click();await expect(panel).toHaveCount(0);
 await expect(host.locator("canvas")).toBeFocused();
});
