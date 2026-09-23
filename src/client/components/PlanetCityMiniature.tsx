/** Tiny cartographic modules share a native 12×14 grid. They never load CITY
 * buildings; massing and lot identity remain stable across zoom and stages. */
type Module={key:string;wall?:string;roof?:string;detail?:string;green?:string;water?:string};
export const PLANET_CITY_MODULES:readonly Module[]=[
 {key:'cottage',wall:'M-4-1H4V4H-4Z',roof:'M-5-2H-3V-4H2V-2H5V0H-5Z',detail:'M-3 1H-1V2H-3ZM1 1H2V4H1Z'},
 {key:'duplex',wall:'M-5-2H5V4H-5Z',roof:'M-5-4H-1V-2H0V-4H5V-1H-5Z',detail:'M-4 0H-2V1H-4ZM2 0H4V1H2ZM-1 2H1V4H-1Z'},
 {key:'row-houses',wall:'M-5-3H5V4H-5Z',roof:'M-5-4H5V-2H-5Z',detail:'M-4-1H-3V0H-4ZM-1-1H0V0H-1ZM2-1H3V0H2ZM-4 2H-3V4H-4ZM-1 2H0V4H-1ZM2 2H3V4H2Z'},
 {key:'villa',wall:'M-5-1H2V4H-5ZM1-4H5V4H1Z',roof:'M-5-3H2V-1H-5ZM1-5H5V-3H1Z',detail:'M-3 1H-1V2H-3ZM2-2H4V0H2ZM2 2H3V4H2Z'},
 {key:'apartments',wall:'M-4-6H4V4H-4Z',roof:'M-4-7H4V-5H-4Z',detail:'M-3-4H-1V-3H-3ZM1-4H3V-3H1ZM-3-1H-1V0H-3ZM1-1H3V0H1ZM-1 2H1V4H-1Z'},
 {key:'courtyard',wall:'M-5-5H-2V4H-5ZM2-5H5V4H2ZM-2 1H2V4H-2Z',roof:'M-5-6H-2V-4H-5ZM2-6H5V-4H2ZM-2 0H2V2H-2Z',green:'M-1-2H1V0H-1Z',detail:'M-4-2H-3V0H-4ZM3-2H4V0H3Z'},
 {key:'terraces',wall:'M-5-2H5V4H-5ZM-2-5H4V-2H-2Z',roof:'M-5-3H-2V-1H-5ZM-2-6H4V-4H-2Z',detail:'M-1-3H1V-2H-1ZM-4 0H-2V1H-4ZM1 0H3V1H1Z'},
 {key:'corner-block',wall:'M-5-5H0V4H-5ZM0-2H5V4H0Z',roof:'M-5-6H0V-4H-5ZM0-3H5V-1H0Z',detail:'M-4-3H-2V-2H-4ZM-4 0H-2V1H-4ZM1 0H3V1H1Z'},
 {key:'office-slab',wall:'M-5-5H5V4H-5Z',roof:'M-5-6H5V-4H-5Z',detail:'M-4-3H4V-2H-4ZM-4-1H4V0H-4ZM-4 1H4V2H-4Z'},
 {key:'office-tower',wall:'M-3-8H3V4H-3Z',roof:'M-3-9H3V-7H-3Z',detail:'M-2-6H-1V1H-2ZM0-6H1V1H0ZM-1 2H1V4H-1Z'},
 {key:'campus',wall:'M-5-4H-1V4H-5ZM1-6H5V4H1Z',roof:'M-5-5H-1V-3H-5ZM1-7H5V-5H1Z',detail:'M-4-2H-2V0H-4ZM2-4H4V-2H2ZM2 0H4V2H2Z'},
 {key:'stepped-tower',wall:'M-5-2H5V4H-5ZM-3-5H3V-2H-3ZM-1-8H2V-5H-1Z',roof:'M-1-9H2V-7H-1ZM-3-6H-1V-4H-3ZM-5-3H-3V-1H-5Z',detail:'M0-6H1V-4H0ZM-2-3H2V-2H-2ZM-4 0H4V1H-4Z'},
 {key:'town-hall',wall:'M-5-2H5V4H-5ZM-1-6H2V-2H-1Z',roof:'M-5-4H5V-2H-5ZM-2-7H3V-5H-2Z',detail:'M-4 0H-3V3H-4ZM-1 0H0V3H-1ZM2 0H3V3H2Z'},
 {key:'fire-station',wall:'M-5-3H5V4H-5Z',roof:'M-5-4H5V-2H-5Z',detail:'M-4 0H-1V4H-4ZM1 0H4V4H1ZM2-6H3V-4H2Z'},
 {key:'clinic',wall:'M-4-5H4V4H-4Z',roof:'M-4-6H4V-4H-4Z',detail:'M-1-3H1V1H-1ZM-2-2H2V0H-2ZM-1 2H1V4H-1Z'},
 {key:'station',wall:'M-5-2H5V4H-5Z',roof:'M-5-3H5V-1H-5ZM-2-5H2V-3H-2Z',detail:'M-4 0H-2V3H-4ZM0 0H2V3H0ZM3 0H4V3H3Z'},
 {key:'garden',green:'M-5-1H5V4H-5ZM-4-4H-1V-1H-4ZM2-5H5V-1H2Z',roof:'M-1-1H1V4H-1Z',detail:'M-4 0H-3V1H-4ZM3 2H4V3H3Z'},
 {key:'fountain',green:'M-5 0H5V4H-5ZM-5-3H-3V0H-5ZM3-3H5V0H3Z',wall:'M-2-1H2V3H-2Z',water:'M-1-2H1V2H-1ZM-2 0H2V1H-2Z'},
 {key:'pavilion',green:'M-5 0H5V4H-5ZM-5-3H-3V0H-5Z',wall:'M-2-2H3V3H-2Z',roof:'M-3-3H-1V-5H2V-3H4V-1H-3Z',detail:'M-1 0H2V3H-1Z'},
 {key:'playground',green:'M-5 0H5V4H-5Z',roof:'M-4-3H-2V-1H-4ZM1-4H4V-3H1Z',wall:'M-4-1H-3V3H-4ZM-2-1H-1V3H-2ZM1-3H2V3H1ZM3-3H4V3H3Z',detail:'M1 0H4V1H1Z'},
 {key:'pond',green:'M-5-1H5V4H-5Z',water:'M-4 0H-2V-2H2V0H4V2H2V3H-3V2H-4Z'},
 {key:'parking',wall:'M-5-2H5V4H-5Z',detail:'M-4-1H4V0H-4ZM-3 0H-2V2H-3ZM0 0H1V2H0ZM3 0H4V2H3Z',roof:'M-4 1H-3V3H-4ZM1 1H2V3H1Z'},
 {key:'warehouse',wall:'M-5-3H5V4H-5Z',roof:'M-5-4H5V-1H-5Z',detail:'M-4 0H-1V4H-4ZM1 0H4V4H1Z'},
 {key:'construction',wall:'M-5 0H5V4H-5Z',roof:'M2-7H3V2H2ZM-2-7H6V-6H-2ZM5-6H6V-3H5Z',detail:'M-4 1H4V2H-4ZM-3 2H-2V4H-3ZM1 2H2V4H1Z'},
];
export function planetMiniatureModule(family:string,seed:number,stage:number):Module {
  if(stage<3)return PLANET_CITY_MODULES[23]!;
  if(/parking/.test(family))return PLANET_CITY_MODULES[21]!;
  if(/lake|water|pond/.test(family))return PLANET_CITY_MODULES[20]!;
  if(/warehouse|industrial|workshop/.test(family))return PLANET_CITY_MODULES[22]!;
  if(/fire/.test(family))return PLANET_CITY_MODULES[13]!;
  if(/hospital|clinic|medical/.test(family))return PLANET_CITY_MODULES[14]!;
  if(/station|airport|port/.test(family))return PLANET_CITY_MODULES[15]!;
  const group=/park|garden|orchard|promenade|fountain|botanical/.test(family)?16:/civic|police|school|shop/.test(family)?12:/office|tower/.test(family)?8:/apartment|block/.test(family)?4:0;
  return PLANET_CITY_MODULES[group+seed%4]!;
}
export function PlanetCityMiniature({id,family='',stage=5,x,y,zoom,module}: {id:string;family?:string;stage?:number;x:number;y:number;zoom:number;module?:Module}) {
  let hash=0;for(const char of id)hash=(Math.imul(hash,31)+char.charCodeAt(0))>>>0;
  const shape=module??planetMiniatureModule(family,hash,stage),roof=['#b87850','#789388','#d5bc7f'][hash%3]!;
  return <g transform={`translate(${x} ${y}) scale(${zoom})`} shapeRendering="crispEdges" data-miniature-family={family} data-miniature-module={shape.key}>
    <path d="M-5 3H6V5H-5Z" fill="#263f3b" opacity=".28" />
    {shape.green&&<path d={shape.green} fill="#658654"/>}
    {shape.wall&&<path d={shape.wall} fill={stage<5?'#a9a387':'#d6c69c'}/>}
    {shape.roof&&<path d={shape.roof} fill={shape.key==='construction'?'#d3b257':roof}/>}
    {shape.water&&<path d={shape.water} fill="#70aeb4"/>}
    {shape.detail&&<path d={shape.detail} fill={shape.key==='parking'?'#d9cea7':'#547778'}/>}
  </g>;
}
