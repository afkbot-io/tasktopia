import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Field } from '../src/client/components/ui';

describe('shared accessible form field',()=>{
  it('preserves a supplied id and external description while linking hint and error',()=>{
    const html=renderToStaticMarkup(createElement(Field,{label:'Email',id:'entry-email',type:'email',hint:'Адрес аккаунта',error:'Введите корректный email','aria-describedby':'existing-help'}));
    expect(html).toContain('<label for="entry-email">Email</label>');
    expect(html).toContain('aria-describedby="existing-help entry-email-hint entry-email-error"');
    expect(html).toContain('aria-invalid="true"');
    expect(html).toContain('id="entry-email-error"');
  });
  it('keeps passwords masked and its keyboard action outside the input label',()=>{
    const html=renderToStaticMarkup(createElement(Field,{label:'Пароль',id:'entry-password',type:'password',autoComplete:'current-password',disabled:true}));
    expect(html).toContain('type="password"');expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('<label for="entry-password">Пароль</label>');
    expect(html).toContain('type="button"');expect(html).toContain('aria-controls="entry-password"');
    expect(html).toContain('aria-pressed="false"');expect(html).toContain('aria-label="Показать пароль: Пароль"');
    const button=html.match(/<button[^>]+>/)?.[0];expect(button).toContain('disabled=""');
  });
});
