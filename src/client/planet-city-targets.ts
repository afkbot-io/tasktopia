import { affineProject, type PlanetMapCamera, type PlanetMapCountry, type ProjectedPlanetAtlas } from '../shared/planet-atlas';

export type PlanetCityTarget = { id: string; countryId: string; name: string; center: {x:number;y:number}; radius: number };

export function planetCityTargets(countries: PlanetMapCountry[], atlas: ProjectedPlanetAtlas, camera: PlanetMapCamera): PlanetCityTarget[] {
  return countries.flatMap(country => country.cities.map(city => {
    const center = affineProject(country.cityAnchors[city.id]!, atlas, camera);
    const icons = country.districtIcons.filter(icon => icon.cityId === city.id);
    const radius = Math.max(8 * camera.zoom, ...icons.map(icon => Math.hypot(icon.center.x-center.x, icon.center.y-center.y) + 5 * camera.zoom));
    return {id:city.id,countryId:country.id,name:city.name || 'Новый город',center,radius};
  }));
}

/** Hit envelopes may overlap at distant zoom. Nearest center wins, independent of DTO order. */
export function planetCityAtPoint(point: {x:number;y:number}, cities: readonly PlanetCityTarget[]): PlanetCityTarget | undefined {
  return cities.map(city=>({city,distance:Math.hypot(point.x-city.center.x,point.y-city.center.y)}))
    .filter(entry=>entry.distance<=Math.max(16,entry.city.radius))
    .sort((a,b)=>a.distance-b.distance || a.city.id.localeCompare(b.city.id))[0]?.city;
}

export function layoutPlanetCityLabels(cities: readonly PlanetCityTarget[], width: number, height: number, scale = 1, origin = { x: 0, y: 0 }) {
  const placed: Array<PlanetCityTarget & {x:number;y:number;width:number;height:number}> = [];
  for (const city of [...cities].sort((a,b)=>a.id.localeCompare(b.id))) {
    if (city.center.x<origin.x || city.center.x>origin.x+width || city.center.y<origin.y || city.center.y>origin.y+height) continue;
    const w=Math.min(180,Math.max(90,city.name.length*7+24))*scale, h=26*scale;
    const x=Math.max(origin.x+4,Math.min(origin.x+width-w-4,city.center.x-w/2));
    const start=Math.max(origin.y+4,city.center.y-Math.min(city.radius,70)-h-8);
    // Labels remain outside the miniature; a leader always retains its exact anchor.
    const slots=[start,city.center.y+Math.min(city.radius,70)+8,start-h-6,start+h+6];
    const y=slots.find(y=>y>=origin.y+4 && y+h<origin.y+height-4 && placed.every(p=>x+w+4<=p.x || x>=p.x+p.width+4 || y+h+4<=p.y || y>=p.y+p.height+4));
    if (y!==undefined) placed.push({...city,x,y,width:w,height:h});
  }
  return placed;
}
