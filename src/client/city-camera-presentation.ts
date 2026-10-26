export type CityCameraPose={x:number;y:number;scale:number};

export class CityCameraPresentation {
  pending: CityCameraPose | undefined;
  constructor(private presented: CityCameraPose) {}
  stage(pose:CityCameraPose,ready:(pose:CityCameraPose)=>boolean):CityCameraPose {
    if(ready(pose)){this.pending=undefined;this.presented={...pose};return this.presented;}
    this.pending={...pose};return this.presented;
  }
  commitPending(ready:(pose:CityCameraPose)=>boolean):CityCameraPose|undefined {
    const pending=this.pending;
    if(!pending||!ready(pending))return undefined;
    return this.stage(pending,ready);
  }
}
