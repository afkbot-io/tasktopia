import { expect, test } from "@playwright/test";

test("ссылка открывает карточку без карты; закрытие загружает нужный город", async ({ page }) => {
  await page.request.post("/api/auth/login", {data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}});
  const bootstrap = await (await page.request.get("/api/bootstrap")).json();
  const mapRequests: string[] = [];
  page.on("request", request => { if (/\/scene(?:\?|$)|\/api\/planet|\/assets\/.*(?:WorldCanvas|PlanetAtlasCanvas)/.test(request.url())) mapRequests.push(request.url()); });
  await page.goto(`/task/1?countryId=${bootstrap.country.id}`);
  await expect(page.locator("#task-title")).toBeVisible();
  await page.getByRole("tab", {name:/Обсуждение/}).click();
  await expect(page.getByRole("heading", {name:"Ход работы"})).toBeVisible();
  expect(mapRequests).toEqual([]);
  await expect(page.locator(".map-region, canvas")).toHaveCount(0);
  await page.getByRole("button", {name:"Закрыть",exact:true}).click();
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-loading", "false", {timeout:45_000});
  await expect(page.locator(".task-modal")).toHaveCount(0);
  expect(mapRequests.some(url => url.includes("/scene"))).toBe(true);
  const [task] = await (await page.request.get("/api/tasks/search?q=1&limit=1")).json();
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-focus-x", String(task.origin.x));
  await expect(page.locator(".world-canvas")).toHaveAttribute("data-focus-y", String(task.origin.y));
});

test("ошибки ссылки и карточки допускают повтор без загрузки мира", async ({page}) => {
  await page.request.post("/api/auth/login", {data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}});
  let failResolve = true, failDetail = true;
  await page.route("**/api/tasks/resolve?*", route => failResolve ? route.fulfill({status:503,json:{error:"TEMPORARY",message:"Связь прервалась"}}) : route.continue());
  await page.route(/\/api\/tasks\/[a-f0-9-]{36}$/, route => failDetail ? route.fulfill({status:503,json:{error:"TEMPORARY",message:"Связь прервалась"}}) : route.continue());
  await page.goto("/task/1");
  await expect(page.getByRole("alert")).toContainText("Связь прервалась");
  await expect(page.locator(".map-region")).toHaveCount(0);
  failResolve = false;
  await page.getByRole("button",{name:"Повторить",exact:true}).click();
  await expect(page.getByRole("dialog")).toHaveAttribute("aria-label","Задача недоступна");
  failDetail = false;
  await page.getByRole("button",{name:"Повторить",exact:true}).click();
  await expect(page.locator("#task-title")).toBeVisible();
  await expect(page.locator(".map-region")).toHaveCount(0);
});

test("закрытая во время поиска карточка не возвращается с поздним ответом", async ({page}) => {
  await page.request.post("/api/auth/login", {data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}});
  let release!:()=>void;
  const gate = new Promise<void>(resolve => { release=resolve; });
  let requested=false;
  await page.route("**/api/tasks/resolve?*", async route => {requested=true;await gate;await route.continue();});
  try {
    await page.goto("/task/1");
    await expect.poll(()=>requested).toBe(true);
    await page.getByRole("button",{name:"Закрыть",exact:true}).click();
    const response = page.waitForResponse(r=>r.url().includes("/api/tasks/resolve?"));
    release();await response;
    await expect(page.locator('.planet-atlas[data-planet-ready="true"]')).toBeVisible({timeout:30_000});
    await expect(page.locator(".task-modal")).toHaveCount(0);
    await expect(page.locator(".world-canvas")).toHaveCount(0);
    expect(new URL(page.url()).pathname).toBe("/");
  } finally {release();}
});

test("карточка читается на узком и низком экране, все разделы доступны с клавиатуры", async ({page}, info) => {
  await page.request.post("/api/auth/login", {data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}});
  await page.setViewportSize({width:320,height:640});
  await page.goto("/task/1");
  await expect(page.locator("#task-title")).toBeVisible();
  const errors:string[]=[];page.on("pageerror", e=>errors.push(e.message));
  for(const name of ["Задача","Материалы","Обсуждение","История"]) {
    const tab=page.getByRole("tab",{name:new RegExp(`^${name}`)});await tab.focus();await page.keyboard.press("Enter");
    await expect(tab).toHaveAttribute("aria-selected","true");
    expect(await page.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const panel=page.getByRole("tabpanel",{name:new RegExp(`^${name}`)});await expect(panel).toBeVisible();
    expect(await panel.evaluate(el=>el.clientWidth)).toBeGreaterThan(250);
  }
  await page.getByRole("tab",{name:"Задача",exact:true}).click();
  await page.screenshot({path:info.outputPath("task-entry-320.png")});
  await page.getByRole("button",{name:"Превью",exact:true}).click();
  await expect(page.getByRole("button",{name:"Создать ссылку на превью",exact:true})).toBeVisible();
  await page.screenshot({path:info.outputPath("task-entry-preview-320.png")});
  await page.setViewportSize({width:740,height:320});
  await page.getByRole("button",{name:"Превью",exact:true}).click();
  await page.getByRole("tab",{name:/Обсуждение/}).click();
  await expect(page.getByRole("heading",{name:"Ход работы"})).toBeVisible();
  expect(errors).toEqual([]);
});

test("истёкшая сессия возвращает вход и сохраняет ссылку на задачу", async ({page}) => {
  await page.request.post("/api/auth/login", {data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}});
  let expired=false;
  await page.route(/\/api\/tasks\/[a-f0-9-]{36}$/, async route => {
    if(!expired) {expired=true;await page.request.post('/api/auth/logout');await route.fulfill({status:401,json:{error:'UNAUTHORIZED'}});}
    else await route.continue();
  });
  await page.goto('/task/1');
  await expect(page.getByRole('heading',{name:'Войти в Tasktopia',exact:true})).toBeVisible();
  await page.getByLabel('Email').fill('demo@tasktopia.local');await page.getByLabel('Пароль').fill('tasktopia-demo');
  await page.getByRole('button',{name:'Открыть страну',exact:true}).click();
  await expect(page.locator('#task-title')).toBeVisible();
  await expect(page.locator('.map-region,canvas')).toHaveCount(0);
});

test("ссылка в другой мир выбирает его один раз и загружает правильный город после закрытия", async ({page}) => {
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL??""),"Изолированная локальная БД");
  const database=process.env.E2E_DATABASE_URL??"postgres://tasktopia:tasktopia@127.0.0.1:55432/tasktopia_test";
  expect(["127.0.0.1","localhost"]).toContain(new URL(database).hostname);
  expect(new URL(database).pathname).toBe("/tasktopia_test");
  const {createDb}=await import("../../src/server/db");
  const {AppService}=await import("../../src/server/app-service");
  const {registerUser,createCountry}=await import("../../src/server/auth");
  const db=await createDb(database,{migrate:false}),service=new AppService(db);
  try {
    const {user}=await registerUser(db,{email:`task-entry-${crypto.randomUUID()}@example.test`,name:"Путешественник",password:"password123"});
    const destination=await createCountry(db,user.id,"Другой мир");
    const city=await service.createCity(destination,{name:"Город назначения",idempotencyKey:crypto.randomUUID()});
    await service.createDistrict(destination,{cityId:city.id,name:"Район назначения",activate:true,idempotencyKey:crypto.randomUUID()});
    const task=await service.createTask(destination,{cityId:city.id,title:"Задача другого мира",estimate:1,idempotencyKey:crypto.randomUUID()});
    await page.request.post("/api/auth/login",{data:{email:user.email,password:"password123"}});
    await page.request.post(`/api/countries/${user.countryId}/select`);
    const selections:string[]=[];page.on("request",r=>{if(r.url().endsWith('/select'))selections.push(r.url());});
    await page.goto(`/task/${task.taskNumber}?taskId=${task.id}`);
    await expect(page.locator("#task-title")).toHaveText(task.title);
    await expect(page.locator(".map-region,canvas")).toHaveCount(0);
    expect(selections).toHaveLength(1);
    expect((await (await page.request.get('/api/bootstrap')).json()).country.id).toBe(destination);
    await page.getByRole("button",{name:"Закрыть",exact:true}).click();
    await expect(page.locator(".world-canvas")).toHaveAttribute("data-loading","false",{timeout:45_000});
    await expect(page.locator(".header-city")).toContainText(city.name);
    await expect(page.locator(".world-canvas")).toHaveAttribute("data-focus-x",String(task.origin.x));
  } finally {await db.close();}
});

test("контраст и прокрутка четырёх разделов соответствуют WCAG AA", async ({page,browserName}) => {
  test.skip(browserName!=="chromium","Одинаковая палитра; браузерная геометрия отдельно проверяется в WebKit");
  const {default:AxeBuilder}=await import("@axe-core/playwright");
  await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}});
  await page.setViewportSize({width:320,height:740});await page.goto('/task/1');
  await expect(page.locator('#task-title')).toBeVisible();
  for(const name of ['Задача','Материалы','Обсуждение','История']) {
    await page.getByRole('tab',{name:new RegExp(`^${name}`)}).click();
    const result=await new AxeBuilder({page}).include('.task-modal').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();
    expect(result.violations).toEqual([]);
  }
});

test("карточка PWA остаётся внутри безопасной области экрана", async ({page,browserName}, info) => {
  test.skip(browserName!=="chromium","CDP-эмуляция выреза экрана доступна в Chromium");
  await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}});
  const cdp=await page.context().newCDPSession(page);
  for(const viewport of [{width:390,height:844,insets:{top:47,bottom:34,left:0,right:0}},{width:844,height:390,insets:{top:0,bottom:21,left:47,right:47}}]) {
    await page.setViewportSize(viewport);
    await cdp.send("Emulation.setSafeAreaInsetsOverride",{insets:viewport.insets});
    await page.goto('/task/1');await expect(page.locator('#task-title')).toBeVisible();
    const card=await page.getByRole('dialog').boundingBox();
    expect(card!.y).toBeGreaterThanOrEqual(viewport.insets.top);
    expect(card!.y+card!.height).toBeLessThanOrEqual(viewport.height-viewport.insets.bottom);
    expect(card!.x).toBeGreaterThanOrEqual(viewport.insets.left);
    expect(card!.x+card!.width).toBeLessThanOrEqual(viewport.width-viewport.insets.right);
    const close=await page.getByRole('button',{name:'Закрыть',exact:true}).boundingBox();
    expect(close!.y).toBeGreaterThanOrEqual(viewport.insets.top);
    await page.getByRole('tab',{name:'История',exact:true}).click();
    await page.screenshot({path:info.outputPath(`task-safe-area-${viewport.width}.png`)});
  }
});
