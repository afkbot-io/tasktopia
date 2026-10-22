import { expect, it } from 'vitest';
import { Container, Graphics } from 'pixi.js';
import type { ChunkDistrictDto } from '../src/shared/contracts';
import { drawDistrictBoundary } from '../src/client/components/WorldCanvas';

it('keeps exact district hit targets and holes without allocating filled GPU geometry for interaction', () => {
  const tooltipLayer = new Container();
  const district = { id: 'district', name: 'Район', color: '#81975b', status: 'ACTIVE',
    cells: [{ x: -2, y: 0 }, { x: -1, y: 0 }, { x: 9, y: 0 }, { x: 10, y: 0 }] } as ChunkDistrictDto;
  const group = drawDistrictBoundary(district, tooltipLayer);
  try {
    expect(group.eventMode).toBe('static');
    expect(group.interactiveChildren).toBe(false);
    expect(group.hitArea!.contains(-8, 4)).toBe(true);
    expect(group.hitArea!.contains(84, 4)).toBe(true);
    expect(group.hitArea!.contains(40, 4)).toBe(false);
    expect(group.hitArea!.contains(88, 4)).toBe(false);
    const instructions = group.children.flatMap(child => child instanceof Graphics ? child.context.instructions : []);
    expect(instructions.some(instruction => instruction.action === 'stroke')).toBe(true);
    expect(instructions.filter(instruction => instruction.action === 'fill')).toHaveLength(0);
    expect(tooltipLayer.children).toHaveLength(0);
  } finally { group.destroy({ children: true }); tooltipLayer.destroy({ children: true }); }
});
