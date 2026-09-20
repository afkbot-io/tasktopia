import {expect,test} from "@playwright/test";
test("publishes a reviewable preview and revokes it from the task",async({page,browser})=>{
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL??""),"Local fixture only");
  expect((await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}})).ok()).toBe(true);
  const bootstrap=await (await page.request.get("/api/bootstrap")).json();
  await page.goto(`/task/1?countryId=${bootstrap.country.id}`);
  await expect(page.locator("#task-title")).toBeVisible();
  await page.getByRole("button",{name:"Поделиться превью",exact:true}).click();
  await expect(page.locator(".task-share-preview blockquote")).toContainText("#1");
  await page.getByRole("textbox",{name:"Публичное описание",exact:true}).fill("Текст для гостей");
  await page.getByRole("checkbox",{name:/Город:/}).uncheck();
  const browserErrors:string[]=[];page.on("pageerror",error=>browserErrors.push(error.message));
  const anonymous=await browser.newContext();
  try {
    await page.getByRole("button",{name:"Создать ссылку с превью",exact:true}).click();
    const field=page.getByRole("textbox",{name:"Ссылка с превью",exact:true});await expect(field).toBeVisible();
    const url=await field.inputValue(),preview=await anonymous.newPage();
    preview.on("pageerror",error=>browserErrors.push(error.message));
    await preview.goto(url);await expect(preview.locator("h1")).toContainText("#1");
    await expect(preview.locator('meta[property="og:title"]')).toHaveAttribute("content",/#1/);
    await expect(preview.locator('meta[property="og:description"]')).toHaveAttribute("content",/Текст для гостей/);
    await expect(preview.locator('.share-location')).not.toContainText(bootstrap.initialCity.name);
    await expect(preview.locator('.share-card')).toBeVisible();
    expect(await preview.locator('.share-card').evaluate((image:HTMLImageElement)=>image.naturalWidth)).toBe(1200);
    await preview.screenshot({path:"test-results/public-og-desktop.png"});
    await preview.setViewportSize({width:320,height:740});
    expect(await preview.evaluate(()=>document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    await preview.screenshot({path:"test-results/public-og-guest-mobile.png"});
    expect((await anonymous.request.get(`/api/task-share-previews?countryId=${bootstrap.country.id}&taskId=00000000-0000-4000-8000-000000000001`)).status()).toBe(401);
    expect((await anonymous.request.post("/api/task-share-previews",{data:{}})).status()).toBe(401);
    expect((await anonymous.request.delete(`/api/task-share-previews?countryId=${bootstrap.country.id}&taskId=00000000-0000-4000-8000-000000000001`)).status()).toBe(401);
    const crawler=await browser.newContext({javaScriptEnabled:false});
    try {
      const crawlerPage=await crawler.newPage();
      expect((await crawlerPage.goto(url))!.status()).toBe(200);
      await expect(crawlerPage.locator("h1")).toContainText("#1");
      await expect(crawlerPage.locator('meta[property="og:image"]')).toHaveAttribute("content",`${url}/image.png`);
      expect((await crawler.request.get(`${url}/image.png`)).status()).toBe(200);
    } finally {await crawler.close();}
    await preview.getByRole("link",{name:"Открыть Tasktopia",exact:true}).click();
    await expect(preview.getByRole("heading",{name:"Войти в Tasktopia",exact:true})).toBeVisible();
    await expect(preview.locator("#task-title")).toHaveCount(0);
    await preview.goto(url);
    await page.getByRole("button",{name:"Отозвать мои превью",exact:true}).click();
    await expect(page.locator(".task-share-preview")).toContainText("отозваны");
    expect((await anonymous.request.get(`${url}/image.png`)).status()).toBe(404);
    const response=await preview.reload();expect(response!.status()).toBe(404);
    await expect(preview.locator("h1")).toContainText("ссылка недоступна");
    expect(browserErrors).toEqual([]);
  } finally {await anonymous.close();await page.getByRole("button",{name:"Отозвать мои превью",exact:true}).click();}
});

test("recovers the same preview after losing a successful publication response",async({page})=>{
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL??""),"Local fixture only");
  await page.setViewportSize({width:390,height:844});
  await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}});
  const bootstrap=await (await page.request.get("/api/bootstrap")).json();
  await page.goto(`/task/1?countryId=${bootstrap.country.id}`);
  await expect(page.locator("#task-title")).toBeVisible();
  await page.getByRole("button",{name:"Поделиться превью",exact:true}).click();
  let lostUrl="",loseNext=true;
  await page.route("**/api/task-share-previews",async route=>{
    if(route.request().method()==="POST"&&loseNext){
      loseNext=false;const response=await route.fetch();expect(response.status()).toBe(200);
      lostUrl=(await response.json()).url;await route.abort("failed");
    } else await route.continue();
  });
  try {
    const create=page.getByRole("button",{name:"Создать ссылку с превью",exact:true});
    await create.click();await expect(page.locator(".task-share-preview [role=status]")).toBeVisible();
    await create.click();
    const field=page.getByRole("textbox",{name:"Ссылка с превью",exact:true});await expect(field).toBeVisible();
    expect(await field.inputValue()).toBe(lostUrl);
    await page.context().grantPermissions(["clipboard-read","clipboard-write"]);
    await page.getByRole("button",{name:"Скопировать превью",exact:true}).click();
    await expect(page.locator(".task-share-preview [role=status]")).toHaveText("Ссылка скопирована");
    expect(await page.evaluate(()=>navigator.clipboard.readText())).toBe(lostUrl);
    expect((await field.boundingBox())!.width).toBeLessThan(390);
    await page.screenshot({path:"test-results/public-og-mobile.png"});
  } finally {await page.getByRole("button",{name:"Отозвать мои превью",exact:true}).click();}
});


test("offers visible controls, recovers draft loading and publishes only the selected fields",async({page,browser})=>{
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL??""),"Local fixture only");
  await page.setViewportSize({width:390,height:844});
  await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}});
  const b=await (await page.request.get("/api/bootstrap")).json();
  await page.goto(`/task/1?countryId=${b.country.id}`);
  await expect(page.locator("#task-title")).toBeVisible();
  let fail=true;
  await page.route("**/api/task-share-previews?**",async route=>{
    if(route.request().method()==="GET"&&fail){fail=false;await route.fulfill({status:503,contentType:"application/json",body:JSON.stringify({error:"Unavailable",message:"Временная ошибка"})});}
    else await route.continue();
  });
  const toggle=page.getByRole("button",{name:"Поделиться превью",exact:true});
  expect((await toggle.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  expect(await toggle.evaluate(el=>getComputedStyle(el).borderTopStyle)).toBe("solid");
  await toggle.focus();await page.keyboard.press("Enter");
  await expect(toggle).toHaveAttribute("aria-expanded","true");
  await expect(page.locator(".task-share-preview [role=status]")).toContainText("Временная ошибка");
  await expect(page.getByRole("button",{name:"Создать ссылку с превью",exact:true})).toHaveCount(0);
  await page.getByRole("button",{name:"Обновить данные превью",exact:true}).click();
  await page.getByRole("checkbox",{name:"Краткое описание",exact:true}).uncheck();
  await page.getByRole("checkbox",{name:/Страна:/}).uncheck();
  await page.getByRole("checkbox",{name:/Город:/}).uncheck();
  await expect(page.getByRole("textbox",{name:"Публичное описание",exact:true})).toHaveCount(0);
  await page.locator(".task-share-preview").screenshot({path:"test-results/public-og-controls-mobile.png"});
  await page.getByRole("button",{name:"Создать ссылку с превью",exact:true}).click();
  const field=page.getByRole("textbox",{name:"Ссылка с превью",exact:true});await expect(field).toBeVisible();
  const url=await field.inputValue(),guest=await browser.newContext();
  try {
    const response=await guest.request.get(url);expect(response.status()).toBe(200);
    const html=await response.text();
    expect(html).not.toContain(b.country.name);expect(html).not.toContain(b.initialCity.name);
    expect(html).toContain('property="og:description" content=""');
    await page.evaluate(()=>Object.defineProperty(navigator,"clipboard",{configurable:true,value:undefined}));
    await page.getByRole("button",{name:"Скопировать превью",exact:true}).click();
    await expect(page.locator(".task-share-preview [role=status]")).toContainText("скопируйте ссылку из поля");
    expect((await field.boundingBox())!.width).toBeLessThan(390);
  } finally {await guest.close();await page.getByRole("button",{name:"Отозвать мои превью",exact:true}).click();}
});
