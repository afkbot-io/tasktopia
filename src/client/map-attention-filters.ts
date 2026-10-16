import { matchesMapAttention, type MapAttentionMode, type MapAttentionTask } from '../shared/map-attention';
export const MAP_ATTENTION_FILTERS:readonly (readonly [MapAttentionMode,string])[]=[['MINE','Мои объекты'],['TESTING','Приёмка'],['DEFECTS','Нужен ремонт'],['OVERDUE','Срыв сроков']];
export function filterMapAttention(tasks:readonly MapAttentionTask[],modes:readonly MapAttentionMode[],now:number):MapAttentionTask[]{
  return modes.length?tasks.filter(task=>modes.every(mode=>matchesMapAttention(task,mode,now))):[];
}
export function mapAttentionFilterLabel(modes:readonly MapAttentionMode[]):string|undefined {
  const labels=MAP_ATTENTION_FILTERS.filter(([mode])=>modes.includes(mode)).map(([,label])=>label);
  return labels.length?labels.join(' + '):undefined;
}
