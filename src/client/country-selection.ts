import type { BootstrapDto } from '../shared/contracts';
import { api, ApiError } from './api';

/** Selecting a country changes the server session and cannot be undone by
 * aborting fetch. Serialize writes and always consume their confirmed result. */
export class CountrySelectionQueue {
  private tail:Promise<unknown>=Promise.resolve();
  private count=0;
  private generation=0;
  get pending(){return this.count>0;}
  invalidate() {
    this.generation++;
    this.count=0;
    this.tail=Promise.resolve();
  }
  select<T>(operation:()=>Promise<T>):Promise<T> {
    const generation=this.generation;
    this.count++;
    const execute=()=>{
      if(generation!==this.generation)throw new DOMException('Сессия изменилась','AbortError');
      return operation();
    };
    const result=this.tail.then(execute,execute);
    this.tail=result.catch(()=>undefined);
    return result.finally(()=>{if(generation===this.generation)this.count--;});
  }
}
const queue=new CountrySelectionQueue();
export const countrySelectionPending=()=>queue.pending;
export const invalidateCountrySelections=()=>queue.invalidate();
export const selectCountrySession=(countryId:string)=>queue.select(async()=>{
  try {return await api<BootstrapDto>(`/api/countries/${countryId}/select`,{method:'POST'});}
  catch(error) {
    // The server may have committed before the connection broke. Reconcile a
    // transient outcome without repeating a session mutation or bypassing 4xx.
    if(!(error instanceof ApiError)||error.status>=500) {
      const confirmed=await api<BootstrapDto>('/api/bootstrap').catch(()=>undefined);
      if(confirmed?.country.id===countryId)return confirmed;
    }
    throw error;
  }
});
