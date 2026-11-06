/** An internal generation zone, never an administrative district or UI object. */
export const CITY_NEIGHBOURHOOD_CELLS=128;
export type NeighbourhoodBlock={origin:{x:number;y:number};width:number;height:number};
export const cityNeighbourhoodKey=(block:NeighbourhoodBlock):string=>
  `${Math.floor((block.origin.x+block.width/2)/CITY_NEIGHBOURHOOD_CELLS)}:${Math.floor((block.origin.y+block.height/2)/CITY_NEIGHBOURHOOD_CELLS)}`;
