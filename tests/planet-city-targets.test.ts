import { describe, expect, it } from 'vitest';
import { planetCityAtPoint, layoutPlanetCityLabels } from '../src/client/planet-city-targets';
const cities = [
  { id:'a', countryId:'one', name:'Первый', center:{x:100,y:100}, radius:10 },
  { id:'b', countryId:'one', name:'Второй', center:{x:125,y:100}, radius:10 },
];
describe('выбор реального города на планете', () => {
  it('выбирает ближайший город, не весь остров и не порядок DTO', () => {
    expect(planetCityAtPoint({x:123,y:100},cities)?.id).toBe('b');
    expect(planetCityAtPoint({x:123,y:100},[...cities].reverse())?.id).toBe('b');
    expect(planetCityAtPoint({x:300,y:100},cities)).toBeUndefined();
  });
  it('разводит соседние подписи и сохраняет привязку к городу', () => {
    const labels = layoutPlanetCityLabels(cities,500,300);
    expect(labels.map(l=>l.id)).toEqual(['a','b']);
    expect(labels[0]!.y).not.toBe(labels[1]!.y);
    expect(labels[1]!.center).toEqual({x:125,y:100});
  });
  it('не показывает подписи вне экрана',()=> {
    expect(layoutPlanetCityLabels([{...cities[0]!,center:{x:-100,y:20}}],500,300)).toEqual([]);
  });
});
