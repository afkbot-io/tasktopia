import type {BlockServiceRole, CityBlockV1} from '../../shared/block-world';
import {cityNeighbourhoodKey} from '../../shared/city-neighbourhood';

export const LOCAL_SERVICE_THRESHOLDS = {EDUCATION:8,MEDICAL:11,FIRE:15,POLICE:19} as const;
export type LocalServiceRole = keyof typeof LOCAL_SERVICE_THRESHOLDS;
type Block = Pick<CityBlockV1,'origin'|'width'|'height'>;
/** World anchored; crossing an administrative district never changes a zone. */
export const localServiceZone=cityNeighbourhoodKey;
const prefix=(zone:string,role:LocalServiceRole)=>`city:local-service:v1:${zone}:${role}:`;
const localRole=(role:BlockServiceRole):role is LocalServiceRole=>Object.hasOwn(LOCAL_SERVICE_THRESHOLDS,role);

/** Compile-local counters. No retained city history, candidate-wide layout scan
 * or new persistence table. Historical generations remain consumed. */
export class LocalCityServices {
  private zones=new Map<string,{buildings:number;roles:Set<LocalServiceRole>}>();
  private generations=new Map<string,number>();
  constructor(triggers:Iterable<string>){
    for(const trigger of triggers){
      const match=/^city:local-service:v1:(-?\d+:-?\d+):(EDUCATION|MEDICAL|FIRE|POLICE):(\d+)$/.exec(trigger);
      if(!match)continue;
      const generation=Number(match[3]);if(!Number.isSafeInteger(generation)||generation<1)continue;
      const key=prefix(match[1]!,match[2] as LocalServiceRole);
      this.generations.set(key,Math.max(this.generations.get(key)??0,generation));
    }
  }
  private zone(block:Block){
    const key=localServiceZone(block);let zone=this.zones.get(key);
    if(!zone){zone={buildings:0,roles:new Set()};this.zones.set(key,zone);}return zone;
  }
  addBuilding(block:Block):void{this.zone(block).buildings++;}
  addRole(block:Block,role:BlockServiceRole):void{if(localRole(role))this.zone(block).roles.add(role);}
  missing(block:Block,role:LocalServiceRole):boolean{
    const zone=this.zones.get(localServiceZone(block));
    return !!zone&&zone.buildings>=LOCAL_SERVICE_THRESHOLDS[role]&&!zone.roles.has(role);
  }
  reserve(block:Block,role:LocalServiceRole):string{
    if(!this.missing(block,role))throw new Error('Local service already reserved or below threshold');
    const key=prefix(localServiceZone(block),role),generation=(this.generations.get(key)??0)+1;
    if(!Number.isSafeInteger(generation))throw new Error('Local service generation exceeds safe range');
    this.generations.set(key,generation);this.addRole(block,role);return `${key}${generation}`;
  }
}
