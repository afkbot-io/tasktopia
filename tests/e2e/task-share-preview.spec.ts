import {expect,test} from "@playwright/test";
test("publishes a reviewable preview and revokes it from the task",async({page,browser},info)=>{
  test.skip(!/^http:\/\/(127\.0\.0\.1|localhost):/.test(process.env.E2E_BASE_URL??""),"Local fixture only");
  expect((await page.request.post("/api/auth/login",{data:{email:"demo@tasktopia.local",password:"tasktopia-demo"}})).ok()).toBe(true);
  const bootstrap=await (await page.request.get("/api/bootstrap")).json();
  await page.goto(`/task/1?countryId=${bootstrap.country.id}`);
  await expect(page.locator("#task-title")).toBeVisible();
  await page.getByRole("button",{name:"Поделиться превью",exact:true}).click();
  await expect(page.locator(".task-share-preview blockquote")).toContainText("#1");
  const anonymous=await browser.newContext();
  try {
    await page.getByRole("button",{name:"Создать ссылку с превью",exact:true}).click();
    const field=page.getByRole("textbox",{name:"Ссылка с превью",exact:true});await expect(field).toBeVisible();
    const url=await field.inputValue(),preview=await anonymous.newPage();
    await preview.goto(url);await expect(preview.locator("h1")).toContainText("#1");
    await expect(preview.locator('meta[property="og:title"]')).toHaveAttribute("content",/#1/);
    await preview.screenshot({path:info.outputPath("shared-preview.png")});
    await page.getByRole("button",{name:"Отозвать мои превью",exact:true}).click();
    await expect(page.locator(".task-share-preview")).toContainText("отозваны");
    const response=await preview.reload();expect(response!.status()).toBe(404);
    await expect(preview.locator("h1")).toContainText("ссылка недоступна");
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
    expect((await field.boundingBox())!.width).toBeLessThan(390);
  } finally {await page.getByRole("button",{name:"Отозвать мои превью",exact:true}).click();}
});
