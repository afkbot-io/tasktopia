import { describe, expect, it } from 'vitest';
import { authFieldError, type AuthFieldConstraint } from '../src/client/auth-form-validation';
const field=(values:Partial<AuthFieldConstraint>={}):AuthFieldConstraint=>({value:'',required:true,type:'text',minLength:-1,maxLength:-1,validity:{typeMismatch:false,badInput:false},...values});
describe('authentication field constraints',()=>{
  it('explains missing and malformed email before a network request',()=>{
    expect(authFieldError(field())).toBe('Заполните это поле');
    expect(authFieldError(field({value:'invalid',type:'email',validity:{typeMismatch:true,badInput:false}}))).toBe('Введите корректный email');
    expect(authFieldError(field({value:'ux@example.test',type:'email'}))).toBe('');
  });
  it('checks human names after trimming but preserves password spaces',()=>{
    expect(authFieldError(field({value:'  ',minLength:2}))).toBe('Заполните это поле');
    expect(authFieldError(field({value:' X ',minLength:2}))).toBe('Не менее 2 символов');
    expect(authFieldError(field({value:'        ',type:'password',minLength:8}))).toBe('');
    expect(authFieldError(field({value:'short',type:'password',minLength:8}))).toBe('Не менее 8 символов');
  });
  it('retains the API length bound and allows optional empty fields',()=>{
    expect(authFieldError(field({value:'longer',maxLength:5}))).toBe('Не более 5 символов');
    expect(authFieldError(field({required:false,minLength:2}))).toBe('');
  });
});
