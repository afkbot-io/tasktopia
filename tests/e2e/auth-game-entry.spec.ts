import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('регистрация проходит два шага, сохраняет ввод при возврате и отправляет один полный запрос', async ({page},info) => {
  let calls=0, payload:Record<string,unknown>={};
  await page.route('**/api/auth/register',async route=>{calls++;payload=route.request().postDataJSON();await route.fulfill({status:409,json:{message:'Проверка повторного email'}});});
  await page.goto('/');await page.getByRole('button',{name:'Регистрация',exact:true}).click();
  await page.screenshot({path:info.outputPath('registration-account.png')});
  await page.getByLabel('Имя',{exact:true}).fill('Градостроитель');await page.getByLabel('Email',{exact:true}).fill('builder@example.test');
  await page.getByLabel('Пароль',{exact:true}).fill('safe-password-123');await page.getByLabel('Повторите пароль',{exact:true}).fill('safe-password-123');
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();expect(calls).toBe(0);
  await expect(page.getByLabel('Название вашей первой страны')).toBeFocused();
  await page.screenshot({path:info.outputPath('registration-world-empty.png')});
  await page.getByLabel('Название вашей первой страны').fill('Зелёный берег');await page.getByLabel('Название первого города').fill('Гавань');
  await page.getByRole('button',{name:'Назад к аккаунту'}).click();await expect(page.getByLabel('Email',{exact:true})).toHaveValue('builder@example.test');
  await expect(page.getByLabel('Имя',{exact:true})).toBeFocused();
  await expect(page.getByLabel('Пароль',{exact:true})).toHaveValue('safe-password-123');
  await page.getByRole('button',{name:'Регистрация',exact:true}).click();
  await expect(page.getByLabel('Email',{exact:true})).toHaveValue('builder@example.test');
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();await expect(page.getByLabel('Название первого города')).toHaveValue('Гавань');
  await page.getByRole('button',{name:'Создать аккаунт',exact:true}).click();await expect(page.getByRole('alert')).toHaveText('Проверка повторного email');
  expect(calls).toBe(1);expect(payload).toEqual({name:'Градостроитель',email:'builder@example.test',password:'safe-password-123',passwordConfirmation:'safe-password-123',countryName:'Зелёный берег',cityName:'Гавань'});
  await page.screenshot({path:info.outputPath('registration-world.png')});
});

test('город входа нативный, не читает карту и сохраняет форму при отказе рисунка',async({page},info)=>{
  const errors:string[]=[],reads:string[]=[];page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(/\/scene|\/chunks|\/world\/viewport|pixi|WorldCanvas/.test(r.url()))reads.push(r.url());});
  await page.route('**/game-assets/**/compact-rose-kindergarten-v1/stage-5.png',route=>route.abort());
  await page.goto('/');await expect(page.locator('.auth-city-scene')).toHaveAttribute('data-scene-state','partial');
  await expect(page.getByRole('button',{name:'Открыть страну'})).toBeEnabled();expect(reads).toEqual([]);expect(errors).toEqual([]);
  await page.emulateMedia({reducedMotion:'reduce'});await expect(page.locator('.auth-city-scene')).toHaveAttribute('data-scene-motion','static');
  await page.screenshot({path:info.outputPath('auth-scene-partial.png')});
});

test('touch: обе регистрации доступны на коротком экране, поля не теряются и интерфейс доступен',async({page},info)=>{
  await page.setViewportSize({width:390,height:844});await page.goto('/');await page.getByRole('button',{name:'Регистрация',exact:true}).click();
  for (const [width,height] of [[320,568],[390,844],[768,600],[1440,480]]) {
    await page.setViewportSize({width,height});
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    const next=page.getByRole('button',{name:'Продолжить',exact:true});await next.scrollIntoViewIfNeeded();await expect(next).toBeInViewport();
  }
  await page.getByLabel('Имя',{exact:true}).fill('Тест');await page.getByLabel('Email',{exact:true}).fill('touch@example.test');
  await page.getByLabel('Пароль',{exact:true}).fill('password-123');await page.getByLabel('Повторите пароль',{exact:true}).fill('password-123');
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  for (const [width,height] of [[320,568],[390,844],[768,600],[1440,480]]) {
    await page.setViewportSize({width,height});const back=page.getByRole('button',{name:'Назад к аккаунту'});await back.scrollIntoViewIfNeeded();await expect(back).toBeInViewport();
    expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
    await page.screenshot({path:info.outputPath(`registration-${width}-${height}.png`)});
  }
  const violations=(await new AxeBuilder({page}).analyze()).violations.filter(v=>v.impact==='serious'||v.impact==='critical');expect(violations).toEqual([]);
});
