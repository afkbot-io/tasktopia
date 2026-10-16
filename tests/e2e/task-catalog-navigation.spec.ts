import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { BootstrapDto } from '../../src/shared/contracts';
import type { TaskListPageDto } from '../../src/shared/task-read-contracts';
import { openMapCity } from './map-navigation';
import { loadMapAttention } from '../../src/client/map-attention-loader';

async function session(page:Page) {
  const base=new URL(process.env.E2E_BASE_URL!);expect(['127.0.0.1','localhost','[::1]']).toContain(base.hostname);
  const email=process.env.E2E_CATALOG_FIXTURE_EMAIL??'demo@tasktopia.local';
  const login=await page.request.post('/api/auth/login',{data:{email,password:process.env.E2E_CATALOG_FIXTURE_EMAIL?'local-city-scale-fixture-only':'tasktopia-demo'}});expect(login.ok()).toBe(true);
  const response=await page.request.get('/api/bootstrap');expect(response.ok()).toBe(true);return await response.json() as BootstrapDto;
}
async function fifty(page:Page,countryId:string) {
  const response=await page.request.get(`/api/tasks/list-page?${new URLSearchParams({countryId,limit:'50'})}`);expect(response.ok()).toBe(true);return await response.json() as TaskListPageDto;
}
const taskNumbers=async(page:Page)=>page.getByRole('listbox',{name:'Найденные задачи'}).locator('strong').allTextContents();
const serious=async(page:Page)=> (await new AxeBuilder({page}).analyze()).violations.filter(item=>item.impact==='serious'||item.impact==='critical');

test('touch: поиск доступен после десяти результатов, страницы не растят DOM и выбор работает с клавиатуры',async({page},info)=>{
  const bootstrap=await session(page),first=await fifty(page,bootstrap.country.id);test.skip(!first.nextCursor,'This journey requires the frozen 200/1000-task scale fixture');
  const q=first.items[0]!.title.match(/^[^\d]+/)?.[0].trim()??first.items[0]!.title;
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  const reads:URL[]=[];page.on('request',request=>{if(request.url().includes('/api/tasks/list-page?'))reads.push(new URL(request.url()));});
  await page.goto('/');const input=page.getByRole('combobox',{name:'Поиск здания по номеру или названию'});await input.fill(q);
  const options=page.getByRole('listbox',{name:'Найденные задачи'}).getByRole('option');await expect(options).toHaveCount(50);const before=await taskNumbers(page);
  const pager=page.getByRole('navigation',{name:'Страницы поиска'});await pager.getByRole('button',{name:'Далее',exact:true}).click();
  await expect(pager.getByRole('status')).toHaveText('Страница 2');await expect(options).toHaveCount(50);const after=await taskNumbers(page);
  expect(after.some(number=>before.includes(number))).toBe(false);
  await pager.getByRole('button',{name:'Назад',exact:true}).click();await expect(options).toHaveCount(50);expect(await taskNumbers(page)).toEqual(before);
  await input.focus();for(let i=0;i<12;i++)await page.keyboard.press('ArrowDown');
  const active=page.locator('[role="option"][aria-selected="true"]');await expect(active).toHaveCount(1);const title=await active.locator('.task-search-title').innerText();
  await page.keyboard.press('Enter');await expect(page.getByRole('dialog').getByRole('heading',{name:title,exact:true})).toBeVisible();
  expect(reads.every(url=>url.searchParams.get('countryId')===bootstrap.country.id&&url.searchParams.get('limit')==='50')).toBe(true);expect(errors).toEqual([]);
  await page.screenshot({path:info.outputPath('catalog-search-keyboard.png')});
});

test('touch: каталог города сочетает условия, листает реальные страницы и возвращает фокус после Escape',async({page},info)=>{
  const bootstrap=await session(page);const first=await fifty(page,bootstrap.country.id);test.skip(!first.nextCursor,'Scale fixture required');
  await page.goto('/');await openMapCity(page);await expect(page.locator('.world-canvas')).toHaveAttribute('data-city-scene-commit','atomic');
  const trigger=page.getByLabel('Фильтры',{exact:true});await trigger.focus();await page.keyboard.press('Enter');
  const open=page.getByRole('button',{name:'Список задач города',exact:true});await open.focus();await page.keyboard.press('Enter');
  const dialog=page.getByRole('dialog',{name:'Задачи города'}),rows=dialog.locator('[data-task-id]');await expect(rows).toHaveCount(50);
  const firstIds=await rows.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-task-id')));
  const pager=dialog.getByRole('navigation',{name:'Страницы задач'});await pager.getByRole('button',{name:'Далее',exact:true}).click();
  await expect(rows).toHaveCount(50);const secondIds=await rows.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-task-id')));expect(secondIds.some(id=>firstIds.includes(id))).toBe(false);
  await dialog.getByRole('combobox',{name:'Статус',exact:true}).selectOption('COMPLETED');await dialog.getByRole('combobox',{name:'Тип задачи',exact:true}).selectOption('TASK');await dialog.getByRole('combobox',{name:'Приоритет',exact:true}).selectOption('NORMAL');await dialog.getByLabel('Мои задачи',{exact:true}).check();
  await expect(pager.getByRole('status')).toContainText('Страница 1');await expect(rows.first()).toBeVisible();
  expect((await rows.allTextContents()).every(text=>text.includes('Завершено')&&text.includes('Строительство')&&text.includes('Обычный приоритет'))).toBe(true);
  await dialog.getByLabel('Найти задачу',{exact:true}).fill('impossible-catalog-words-934827');await expect(dialog.getByText('Подходящих задач нет',{exact:true})).toBeVisible();await expect(rows).toHaveCount(0);
  await dialog.getByRole('button',{name:'Сбросить условия',exact:true}).click();await expect(rows).toHaveCount(50);
  await expect(pager.getByRole('status')).toContainText('Страница 1');
  expect(await rows.evaluateAll(nodes=>nodes.map(node=>node.getAttribute('data-task-id')))).toEqual(firstIds);
  for(const width of [390,320]){await page.setViewportSize({width,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await expect(dialog.getByRole('button',{name:'Закрыть каталог задач'})).toBeInViewport();}
  expect(await serious(page)).toEqual([]);await page.screenshot({path:info.outputPath('catalog-320.png')});
  await page.keyboard.press('Escape');await expect(dialog).toHaveCount(0);await expect(open).toBeFocused();
});

test('touch: каталог районов и задач открывается без canvas-click, корректно переживает отказ и повтор',async({page})=>{
  const bootstrap=await session(page);expect(bootstrap.initialCity).toBeTruthy();
  const cityPageResponse=await page.request.get(`/api/tasks/list-page?${new URLSearchParams({countryId:bootstrap.country.id,cityId:bootstrap.initialCity!.id,limit:'50'})}`);expect(cityPageResponse.ok()).toBe(true);const cityPage=await cityPageResponse.json() as TaskListPageDto;
  const query=cityPage.items[0]!.title.match(/^[^\d]+/)?.[0].trim()??cityPage.items[0]!.title;await page.goto('/');
  const menu=page.getByLabel('Меню',{exact:true});await menu.focus();await page.keyboard.press('Enter');await page.getByRole('button',{name:'Города',exact:true}).focus();await page.keyboard.press('Enter');
  let drawer=page.getByRole('complementary',{name:'Города'});await expect(drawer).toBeVisible();
  const districts=drawer.getByRole('button',{name:`Районы города ${bootstrap.initialCity!.name}`,exact:true});await districts.focus();await page.keyboard.press('Enter');
  drawer=page.getByRole('complementary',{name:'Районы города'});await expect(drawer.getByRole('heading',{name:/Районы/})).toBeFocused();
  const districtResponse=await page.request.get(`/api/plan/cities/${bootstrap.initialCity!.id}/districts`);const actualDistricts=await districtResponse.json();expect(actualDistricts.length).toBeGreaterThan(0);
  for(const district of actualDistricts)await expect(drawer.getByRole('button',{name:new RegExp(`^${district.name} `)})).toBeVisible();
  await drawer.getByRole('button',{name:'Все задачи города',exact:true}).click();const rows=drawer.locator('[data-task-id]');await expect(rows).toHaveCount(cityPage.items.length);
  let failed=true;await page.route('**/api/tasks/list-page?*',route=>failed?route.fulfill({status:503,json:{message:'Локальная проверка списка'}}):route.continue());
  await drawer.getByLabel('Найти задачу',{exact:true}).fill(query);await expect(drawer.getByRole('button',{name:'Повторить загрузку задач'})).toBeVisible();await expect(rows).toHaveCount(0);
  failed=false;await drawer.getByRole('button',{name:'Повторить загрузку задач'}).click();await expect(rows.first()).toBeVisible();
  await rows.first().focus();const title=await rows.first().locator('strong').innerText();await page.keyboard.press('Enter');await expect(page.getByRole('dialog')).toContainText(title.replace(/^#\d+ · /,''));
  await page.getByRole('button',{name:'Закрыть',exact:true}).click();await expect(drawer).toBeVisible();await expect(rows.first()).toBeFocused();
});

test('touch: сочетание подсветки переиспользует метаданные и сохраняет камеру и поверхность',async({page})=>{
  const bootstrap=await session(page);const metadata=await loadMapAttention(bootstrap.country.id,bootstrap.initialCity!.id,new AbortController().signal,async path=>{const response=await page.request.get(path);expect(response.ok()).toBe(true);return response.json();});
  const expected=metadata.filter(task=>task.mine&&task.status==='TESTING').length;await page.goto('/');await openMapCity(page);const host=page.locator('.world-canvas');await expect(host).toHaveAttribute('data-city-scene-commit','atomic');
  await page.getByLabel('Фильтры',{exact:true}).click();const menu=page.getByRole('navigation',{name:'Подсветка построек'});let reads=0;page.on('request',request=>{if(request.url().includes('/api/map-attention?'))reads++;});
  const before=await host.evaluate(node=>[node.getAttribute('data-camera-world-x'),node.getAttribute('data-camera-world-y'),node.getAttribute('data-ground-rebuilds')]);
  await menu.getByRole('button',{name:'Мои объекты',exact:true}).click();await expect(menu.getByRole('status')).toContainText('Найдено:');const loaded=reads;
  await menu.getByRole('button',{name:'Приёмка',exact:true}).click();await expect(menu.getByRole('button',{name:'Мои объекты',exact:true})).toHaveAttribute('aria-pressed','true');await expect(menu.getByRole('button',{name:'Приёмка',exact:true})).toHaveAttribute('aria-pressed','true');
  await expect(menu.getByRole('status')).toHaveText(`Найдено: ${expected}`);expect(reads).toBe(loaded);
  expect(await host.evaluate(node=>[node.getAttribute('data-camera-world-x'),node.getAttribute('data-camera-world-y'),node.getAttribute('data-ground-rebuilds')])).toEqual(before);
});

test('touch: настройки аккаунта позволяют показать каждый пароль без изменения аккаунта',async({page})=>{
  await session(page);let writes=0;await page.route('**/api/account/password',route=>{writes++;return route.abort();});await page.goto('/');await page.getByLabel('Меню',{exact:true}).click();await page.getByRole('button',{name:'Аккаунт и настройки',exact:true}).click();
  for(const label of ['Текущий пароль','Новый пароль','Повторите новый пароль']){
    const input=page.getByLabel(label,{exact:true});await input.fill('local-test-password');await page.getByRole('button',{name:`Показать пароль: ${label}`,exact:true}).click();await expect(input).toHaveAttribute('type','text');await expect(input).toHaveValue('local-test-password');
    await page.getByRole('button',{name:`Скрыть пароль: ${label}`,exact:true}).click();await expect(input).toHaveAttribute('type','password');
  }
  expect(writes).toBe(0);
});
