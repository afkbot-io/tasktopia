import { describe, expect, it } from 'vitest';
import { filterMapAttention, mapAttentionFilterLabel } from '../src/client/map-attention-filters';
import type { MapAttentionTask } from '../src/shared/map-attention';
const rows:MapAttentionTask[]=[
  {id:'mine-testing-late',mine:true,status:'TESTING',dueAt:'2026-10-16T00:00:00Z',hasDefects:true},
  {id:'foreign-testing-late',mine:false,status:'TESTING',dueAt:'2026-10-16T00:00:00Z',hasDefects:true},
  {id:'mine-finished',mine:true,status:'COMPLETED',dueAt:'2026-10-16T00:00:00Z',hasDefects:false},
];
describe('combined map attention',()=>{
  it('intersects enabled filters, preserves single mine/completed and disables empty selection',()=>{
    expect(filterMapAttention(rows,[],Date.parse('2026-10-17'))).toEqual([]);
    expect(filterMapAttention(rows,['MINE'],0).map(row=>row.id)).toEqual(['mine-testing-late','mine-finished']);
    expect(filterMapAttention(rows,['MINE','TESTING','DEFECTS','OVERDUE'],Date.parse('2026-10-17')).map(row=>row.id)).toEqual(['mine-testing-late']);
    expect(filterMapAttention(rows,['MINE','TESTING','OVERDUE'],0)).toEqual([]);
    expect(mapAttentionFilterLabel(['TESTING','MINE'])).toBe('Мои объекты + Приёмка');
  });
});
