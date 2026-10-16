export type CityViewState={center:{x:number;y:number};scale:number};
export type CityViewRestoreRequest={view:CityViewState;token:number};
export type CityViewChangeMeta={source:"interaction"|"cleanup";restoreToken?:number};

export class CityViewRestoreQueue {
  private token=-Infinity;
  private latest:CityViewRestoreRequest|undefined;
  request(input:CityViewRestoreRequest):boolean {
    const view=readCityViewState(input.view);
    if(!Number.isSafeInteger(input.token)||input.token<0||input.token<=this.token||!view)return false;
    this.token=input.token;this.latest={view,token:input.token};return true;
  }
  cancel():void {this.latest=undefined;}
  take():CityViewRestoreRequest|undefined {const latest=this.latest;this.latest=undefined;return latest;}
  get epoch():number|undefined {return Number.isFinite(this.token)?this.token:undefined;}
}

export function readCityViewState(value:unknown):CityViewState|undefined {
  if(!value||typeof value!=="object"||Array.isArray(value))return;
  const {center,scale}=value as Partial<CityViewState>;
  if(!center||typeof center!=="object"||!Number.isFinite(center.x)||!Number.isFinite(center.y)
    ||Math.abs(center.x)>Number.MAX_SAFE_INTEGER||Math.abs(center.y)>Number.MAX_SAFE_INTEGER
    ||typeof scale!=="number"||!Number.isFinite(scale)||scale<.8||scale>4)return;
  return {center:{x:center.x,y:center.y},scale};
}

/** A single pending explicit pose; follow/animation is not navigation history. */
export class CityViewPublisher {
  private explicit=false;
  private publishedAt=-Infinity;
  markExplicit():void {this.explicit=true;}
  cancel():void {this.explicit=false;}
  get pending():boolean {return this.explicit;}
  flush(view:CityViewState,ready:boolean):CityViewState|undefined {
    if(!ready||!this.explicit)return;
    const parsed=readCityViewState(view);if(parsed)this.explicit=false;return parsed;
  }
  settle(now:number,view:CityViewState,ready:boolean):CityViewState|undefined {
    if(!this.explicit||!ready||!Number.isFinite(now)||now-this.publishedAt<250)return;
    const parsed=readCityViewState(view);if(!parsed)return;
    this.explicit=false;this.publishedAt=now;
    return parsed;
  }
}
