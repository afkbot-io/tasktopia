export type AuthFieldConstraint = {
  value: string; required: boolean; type: string; minLength: number; maxLength: number;
  validity: Pick<ValidityState,'typeMismatch'|'badInput'>;
};
export type AuthFieldErrors = Record<string,string>;

export function authFieldError(input:AuthFieldConstraint):string {
  const value=input.type==='password'?input.value:input.value.trim();
  if(!value)return input.required?'Заполните это поле':'';
  if(input.validity.typeMismatch||input.validity.badInput)return input.type==='email'?'Введите корректный email':'Проверьте значение';
  if(input.minLength>0&&value.length<input.minLength)return `Не менее ${input.minLength} символов`;
  if(input.maxLength>0&&value.length>input.maxLength)return `Не более ${input.maxLength} символов`;
  return '';
}

/** Browser constraint metadata, including disabled ancestors and password reveal. */
export function readAuthFieldErrors(form:HTMLFormElement):AuthFieldErrors {
  const errors:AuthFieldErrors={};
  for(const element of form.elements){
    if(!(element instanceof HTMLInputElement)||!element.name||element.matches(':disabled'))continue;
    const error=authFieldError({value:element.value,required:element.required,
      type:element.dataset.passwordField!==undefined?'password':element.type,minLength:element.minLength,maxLength:element.maxLength,validity:element.validity});
    if(error)errors[element.name]=error;
  }
  const data=new FormData(form);
  if(data.has('passwordConfirmation')&&!errors.password&&!errors.passwordConfirmation&&data.get('password')!==data.get('passwordConfirmation'))errors.passwordConfirmation='Пароли не совпадают';
  return errors;
}

export function focusAuthFieldError(form:HTMLFormElement,errors:AuthFieldErrors) {
  if(!form.isConnected)return;
  const field=form.elements.namedItem(Object.keys(errors)[0]??'');
  if(field instanceof HTMLInputElement)field.focus();
}
