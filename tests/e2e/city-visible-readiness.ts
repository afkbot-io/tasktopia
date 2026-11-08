import {expect,type Locator,type TestInfo} from '@playwright/test';

// Visible CITY readiness is independent of the offscreen prewarm queue.
export async function expectVisibleCityGround(host:Locator,info:TestInfo,phase:string){
 let last:Record<string,string|undefined>|undefined;
 try{
   await expect.poll(async()=>{
     last=await host.evaluate(node=>{
       const d=(node as HTMLElement).dataset;
       return {citySceneCommit:d.citySceneCommit,cityFirstFrameRendered:d.cityFirstFrameRendered,
         cityCriticalGroundReady:d.cityCriticalGroundReady,cameraPresentationPending:d.cameraPresentationPending,
         cameraPaddingVisibleUntextured:d.cameraPaddingVisibleUntextured,cameraPaddingTargetUnbaked:d.cameraPaddingTargetUnbaked,
         loading:d.loading,loadError:d.loadError,groundBakeQueue:d.groundBakeQueue,cityHaloGroundPending:d.cityHaloGroundPending,
         cameraPaddingTerrainPending:d.cameraPaddingTerrainPending,cameraPaddingRoadPending:d.cameraPaddingRoadPending,
         cameraPaddingTreePending:d.cameraPaddingTreePending,groundCache:d.groundCache,ambientAssets:d.ambientAssets,
         movementPreparing:d.movementPreparing,mobilityReady:d.mobilityReady,renderScale:d.renderScale,
         cameraWorldX:d.cameraWorldX,cameraWorldY:d.cameraWorldY};
     });
     return {commit:last.citySceneCommit,frame:last.cityFirstFrameRendered,critical:last.cityCriticalGroundReady,
       presentation:last.cameraPresentationPending,visibleUntextured:last.cameraPaddingVisibleUntextured,
       targetUnbaked:last.cameraPaddingTargetUnbaked,loading:last.loading,failed:last.loadError==="true"};
   },{timeout:15_000,message:"The actual visible city ground and camera must be ready before controlling movement"}).toEqual({
     commit:"atomic",frame:"true",critical:"true",presentation:"false",visibleUntextured:"0",targetUnbaked:"0",loading:"false",failed:false,
   });
 }finally{
   await info.attach(`visible-ground-${phase}`,{body:JSON.stringify({phase,coverage:last?"observed-last-public-snapshot":"unavailable",snapshot:last}),contentType:"application/json"});
 }
}
