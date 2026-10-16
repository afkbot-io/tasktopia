import type { Cell } from "../shared/contracts";
import type { TransportKind,TransportStopActivity } from "../shared/transport-schedule";

export type InspectionTask={countryId:string;taskId:string;title?:string};
type InspectionBase={title:string;phase:string;position?:Cell;local:boolean;task?:InspectionTask};
export type TransportInspection=InspectionBase&{kind:"TRANSPORT";transportKind:TransportKind;routeId:string;vehicleId:string;journeyId:string;
  activity:TransportStopActivity;fromName:string;toName?:string;progress:number;waiting:number;aboard:number;boarded:number;alighted:number};
export type RoadInspection=InspectionBase&{kind:"ROAD";id:string;closedCells:number;services:string[]};
export type PlaceInspection=InspectionBase&{kind:"PLACE";task:InspectionTask};
export type WorldInspection=TransportInspection|RoadInspection|PlaceInspection;
export type InspectionTarget={kind:"TRANSPORT";vehicleId:string;journeyId:string}|{kind:"ROAD";id:string}|{kind:"PLACE";taskId:string};
export type InspectionSnapshot={item:WorldInspection;following:boolean;ended:boolean;canFollow:boolean};
export type InspectionFrame={publication?:InspectionSnapshot;cameraPoint?:Cell};
export type InspectionOptions={active:boolean;reducedMotion:boolean;life:boolean};
const target=(item:WorldInspection):InspectionTarget=>item.kind==="TRANSPORT"?{kind:item.kind,vehicleId:item.vehicleId,journeyId:item.journeyId}
  :item.kind==="ROAD"?{kind:item.kind,id:item.id}:{kind:item.kind,taskId:item.task.taskId};
const matches=(selected:InspectionTarget,item:WorldInspection)=>selected.kind==="TRANSPORT"&&item.kind==="TRANSPORT"
  ? selected.vehicleId===item.vehicleId&&selected.journeyId===item.journeyId : selected.kind==="ROAD"&&item.kind==="ROAD"
    ? selected.id===item.id : selected.kind==="PLACE"&&item.kind==="PLACE"&&selected.taskId===item.task.taskId;

const copy=(item:WorldInspection):WorldInspection=>({...item,position:item.position?{...item.position}:undefined,
  task:item.task?{...item.task}:undefined,...(item.kind==="ROAD"?{services:[...item.services]}:{})}) as WorldInspection;

/** One exact real object. React sees bounded snapshots; camera follow reads the current simulation pose. */
export class CityWorldInspection {
  target:InspectionTarget|undefined;
  following=false;
  private item:WorldInspection|undefined;
  private ended=false;
  private enabled=true;
  private publishedAt=-Infinity;
  private signature="";
  open(item:WorldInspection):void {this.item=copy(item);this.target=target(item);this.following=false;this.ended=false;this.signature="";}
  close():void {this.item=undefined;this.target=undefined;this.following=false;this.ended=false;this.signature="";}
  follow():boolean {this.following=this.enabled&&!this.ended&&!!this.item?.local&&this.item.kind==="TRANSPORT"&&!!this.item.position;return this.following;}
  manualNavigation():void {this.following=false;}
  update(time:number,item:WorldInspection|undefined,options:InspectionOptions):InspectionFrame {
    if(!this.item)return{};
    this.enabled=options.active&&!options.reducedMotion&&options.life;
    if(!this.enabled)this.following=false;
    if(item&&this.target&&matches(this.target,item)&&!this.ended)this.item=item;
    else {this.ended=true;this.following=false;}
    if(!this.item.local||!this.item.position)this.following=false;
    const signature=`${this.item.phase}:${this.item.kind==="TRANSPORT"?this.item.activity:""}:${this.following}:${this.ended}:${this.enabled}:${this.item.local}:${!!this.item.position}`;
    if(this.ended&&signature===this.signature)return {};
    let publication:InspectionSnapshot|undefined;
    if(signature!==this.signature||time-this.publishedAt>=250||time<this.publishedAt){
      this.signature=signature;this.publishedAt=time;
      publication={item:copy(this.item),following:this.following,ended:this.ended,canFollow:this.enabled&&!this.ended&&this.item.kind==="TRANSPORT"&&this.item.local&&!!this.item.position};
    }
    return {publication,cameraPoint:this.following?this.item.position:undefined};
  }
}
