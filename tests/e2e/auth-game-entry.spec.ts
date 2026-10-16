import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('регистрация проходит два шага, сохраняет ввод при возврате и отправляет один полный запрос', async ({page},info) => {
  await enabledRegistration(page);
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
  await enabledRegistration(page);
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

test('touch: зависший PNG не задерживает первый рисунок, ввод и отправку формы',async({page},info)=>{
  const errors:string[]=[],reads:string[]=[];let release:(()=>void)|undefined,intercepted=0,loginCalls=0;
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(/\/scene|\/chunks|\/world\/viewport|pixi|WorldCanvas/.test(request.url()))reads.push(request.url());});
  await page.emulateMedia({reducedMotion:'reduce'});
  await page.route('**/game-assets/**/compact-rose-kindergarten-v1/stage-5.png',async route=>{
    intercepted++;await new Promise<void>(resolve=>{release=resolve;});
    await route.abort().catch(()=>undefined); // The bounded loader may already cancel this intercepted request.
  });
  await page.route('**/api/auth/login',async route=>{loginCalls++;await route.fulfill({status:401,json:{message:'Локальная проверка входа'}});});
  try {
    await page.goto('/');
    const canvas=page.locator('.auth-city-scene');
    await expect(canvas).toHaveAttribute('data-scene-state','progressive',{timeout:2500});
    await expect.poll(()=>intercepted).toBe(1);
    expect(Number(await canvas.getAttribute('data-loaded-assets'))).toBeGreaterThan(0);
    await page.getByLabel('Email',{exact:true}).fill('scene@example.test');
    await page.getByLabel('Пароль',{exact:true}).fill('local-scene-test-only');
    await page.getByRole('button',{name:'Открыть страну',exact:true}).click();
    await expect(page.getByRole('alert')).toHaveText('Локальная проверка входа');expect(loginCalls).toBe(1);
    await expect(page.getByLabel('Email',{exact:true})).toHaveValue('scene@example.test');
    await expect(canvas).toHaveAttribute('data-scene-state','partial');
    await expect(canvas).toHaveAttribute('data-pending-assets','0');await expect(canvas).toHaveAttribute('data-timed-out-assets','1');
    await expect(canvas).toHaveAttribute('data-scene-motion','static');
    expect(reads).toEqual([]);expect(errors).toEqual([]);
    await page.screenshot({path:info.outputPath('auth-hung-image-partial.png')});
  } finally {release?.();await page.unrouteAll({behavior:'ignoreErrors'});}
});

test('отказ фонового canvas оставляет авторизацию доступной и не запускает PNG загрузку',async({page})=>{
  const errors:string[]=[],assets:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.url().includes('/game-assets/'))assets.push(request.url());});
  await page.addInitScript(()=>{
    const original=HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,...args:Parameters<typeof original>){
      if(this.width===384&&this.height===304&&!this.classList.contains('auth-city-scene'))return null;
      return original.apply(this,args);
    } as typeof original;
  });
  await page.goto('/');await expect(page.locator('.auth-city-scene')).toHaveAttribute('data-scene-state','unavailable');
  await page.getByLabel('Email',{exact:true}).fill('canvas@example.test');
  await expect(page.getByRole('button',{name:'Открыть страну',exact:true})).toBeEnabled();
  expect(errors).toEqual([]);expect(assets).toEqual([]);
});


async function enabledRegistration(page:import('@playwright/test').Page) {
  await page.route('**/api/auth/config',route=>route.fulfill({json:{registrationEnabled:true}}));
}

test('touch: пароль можно показать с клавиатуры без отправки формы и потери ввода',async({page},info)=>{
  let submits=0;await page.route('**/api/auth/login',route=>{submits++;return route.fulfill({status:401,json:{message:'Проверка входа'}});});
  await page.goto('/');const password=page.getByLabel('Пароль',{exact:true});await password.fill('password-123');
  const show=page.getByRole('button',{name:'Показать пароль: Пароль',exact:true});await show.focus();await page.keyboard.press('Space');
  await expect(password).toHaveAttribute('type','text');await expect(password).toHaveValue('password-123');
  await expect(page.getByRole('button',{name:'Скрыть пароль: Пароль'})).toHaveAttribute('aria-pressed','true');
  expect(submits).toBe(0);await page.getByRole('button',{name:'Скрыть пароль: Пароль'}).click();
  await expect(password).toHaveAttribute('type','password');expect(submits).toBe(0);
  await page.screenshot({path:info.outputPath('password-entry.png')});
});

test('touch: ошибки регистрации связаны с полями и фокусом, исправление сохраняет черновик',async({page})=>{
  await enabledRegistration(page);let submits=0;await page.route('**/api/auth/register',route=>{submits++;return route.fulfill({status:409,json:{message:'Проверка email'}});});
  await page.goto('/');await page.getByRole('button',{name:'Регистрация',exact:true}).click();
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  const name=page.getByLabel('Имя',{exact:true});await expect(name).toBeFocused();await expect(name).toHaveAttribute('aria-invalid','true');
  await expect(name).toHaveAccessibleDescription('Заполните это поле');
  await name.fill('Строитель');await page.getByLabel('Email',{exact:true}).fill('invalid');
  await page.getByLabel('Пароль',{exact:true}).fill('password-123');await page.getByLabel('Повторите пароль',{exact:true}).fill('other-password-123');
  await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect(page.getByLabel('Email',{exact:true})).toBeFocused();await expect(page.getByLabel('Email',{exact:true})).toHaveAccessibleDescription('Введите корректный email');
  await page.getByLabel('Email',{exact:true}).fill('ux@example.test');await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  const confirmation=page.getByLabel('Повторите пароль',{exact:true});await expect(confirmation).toBeFocused();await expect(confirmation).toHaveAccessibleDescription('Пароли не совпадают');
  await confirmation.fill('password-123');await page.getByRole('button',{name:'Продолжить',exact:true}).click();
  await expect(page.getByLabel('Название вашей первой страны')).toBeFocused();expect(submits).toBe(0);
  await page.getByRole('button',{name:'Назад к аккаунту'}).click();await expect(name).toHaveValue('Строитель');await expect(page.getByLabel('Email',{exact:true})).toHaveValue('ux@example.test');
  await expect(confirmation).not.toHaveAttribute('aria-invalid','true');
  const violations=(await new AxeBuilder({page}).analyze()).violations.filter(v=>v.impact==='serious'||v.impact==='critical');expect(violations).toEqual([]);
});

test('touch: отказ auth config допускает повтор без перезагрузки и потери email',async({page})=>{
  let reads=0;await page.route('**/api/auth/config',route=>{reads++;return reads===1?route.fulfill({status:503,json:{message:'Проверка отказа'}}):route.fulfill({json:{registrationEnabled:true}});});
  await page.goto('/');await page.getByLabel('Email',{exact:true}).fill('retry@example.test');
  await page.getByRole('button',{name:'Повторить проверку регистрации',exact:true}).click();
  await expect(page.getByRole('button',{name:'Регистрация',exact:true})).toBeVisible();await expect(page.getByLabel('Email',{exact:true})).toHaveValue('retry@example.test');expect(reads).toBe(2);
  await expect(page.getByRole('button',{name:'Открыть страну',exact:true})).toBeEnabled();
});

test('touch: восстановление показывает пароль и связывает несовпадение с подтверждением',async({page})=>{
  let calls=0;await page.route('**/api/auth/recover',route=>{calls++;return route.fulfill({status:401,json:{message:'Проверка резервного кода'}});});
  await page.goto('/');await page.getByRole('button',{name:'Забыли пароль?'}).click();
  await page.getByLabel('Email',{exact:true}).fill('recovery@example.test');await page.getByLabel('Резервный код',{exact:true}).fill('local-test');
  await page.getByLabel('Новый пароль',{exact:true}).fill('password-123');await page.getByLabel('Повторите новый пароль',{exact:true}).fill('different-password-123');
  await page.getByRole('button',{name:'Показать пароль: Новый пароль',exact:true}).click();await expect(page.getByLabel('Новый пароль',{exact:true})).toHaveAttribute('type','text');
  await page.getByRole('button',{name:'Восстановить доступ',exact:true}).click();const confirmation=page.getByLabel('Повторите новый пароль',{exact:true});
  await expect(confirmation).toBeFocused();await expect(confirmation).toHaveAttribute('aria-invalid','true');await expect(confirmation).toHaveAccessibleDescription('Пароли не совпадают');expect(calls).toBe(0);
  await confirmation.fill('password-123');await page.getByRole('button',{name:'Восстановить доступ',exact:true}).click();
  await expect(page.getByRole('alert')).toHaveText('Проверка резервного кода');await expect(page.getByRole('alert')).toBeFocused();expect(calls).toBe(1);
  await expect(page.getByLabel('Резервный код',{exact:true})).toHaveValue('local-test');
});

test('touch: зависший auth config ограничен по времени, вход доступен и серверное отключение регистрации сохранено',async({page})=>{
  let release:(()=>void)|undefined,reads=0;const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/auth/config',async route=>{
    reads++;if(reads===1){await new Promise<void>(resolve=>{release=resolve;});await route.abort().catch(()=>undefined);}
    else await route.fulfill({json:{registrationEnabled:false}});
  });
  try {
    await page.goto('/');await page.getByLabel('Email',{exact:true}).fill('pending@example.test');
    await expect(page.getByRole('button',{name:'Открыть страну',exact:true})).toBeEnabled();
    const retry=page.getByRole('button',{name:'Повторить проверку регистрации',exact:true});await expect(retry).toBeVisible({timeout:10000});
    await retry.click();await expect(retry).toHaveCount(0);await expect(page.getByRole('button',{name:'Регистрация',exact:true})).toHaveCount(0);
    await expect(page.getByLabel('Email',{exact:true})).toHaveValue('pending@example.test');expect(reads).toBe(2);expect(errors).toEqual([]);
  } finally {release?.();await page.unrouteAll({behavior:'ignoreErrors'});}
});

test('touch: отказ принятия приглашения получает фокус и повтор не оставляет интерфейс заблокированным',async({page},info)=>{
  const base=new URL(String(info.project.use.baseURL));expect(['127.0.0.1','localhost','[::1]']).toContain(base.hostname);
  const fixtureEmail=process.env.E2E_AUTH_FIXTURE_EMAIL;
  const login=await page.request.post('/api/auth/login',{data:{email:fixtureEmail??'demo@tasktopia.local',password:fixtureEmail?'local-city-scale-fixture-only':'tasktopia-demo'}});expect(login.ok()).toBe(true);
  let calls=0;const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.route('**/api/invitations/accept',route=>{calls++;return route.fulfill({status:403,json:{message:'Приглашение недоступно'}});});
  await page.goto(`/#invite=${'A'.repeat(43)}`);const accept=page.getByRole('button',{name:'Принять приглашение',exact:true});
  await accept.click();await expect(page.getByRole('alert')).toHaveText('Приглашение недоступно');await expect(page.getByRole('alert')).toBeFocused();await expect(accept).toBeEnabled();
  await accept.click();await expect(accept).toBeEnabled();expect(calls).toBe(2);expect(errors).toEqual([]);
  const violations=(await new AxeBuilder({page}).analyze()).violations.filter(v=>v.impact==='serious'||v.impact==='critical');expect(violations).toEqual([]);
});
