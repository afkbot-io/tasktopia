import { useEffect, useRef } from 'react';
import { AUTH_SCENE_SIZE, createAuthScenePlan } from '../auth-scene-plan';
import { readWorldPreferences, subscribeWorldPreferences } from '../world-preferences';
import { loadAuthSceneAssets } from '../auth-scene-assets';

let cachedPlan: ReturnType<typeof createAuthScenePlan> | undefined;

export function AuthWorldScene() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!, ctx = canvas.getContext('2d');
    if (!ctx) { canvas.dataset.sceneState = 'unavailable'; return; }
    const background = document.createElement('canvas'); background.width = canvas.width; background.height = canvas.height;
    const ground = background.getContext('2d');
    if (!ground) { canvas.dataset.sceneState = 'unavailable'; return; }
    const plan = cachedPlan ??= createAuthScenePlan();
    let images: ReadonlyMap<string, HTMLImageElement> = new Map();
    let disposed = false, ready = false, timer: ReturnType<typeof setTimeout> | undefined;
    let paintTimer: ReturnType<typeof setTimeout> | undefined;
    let sceneState: 'loading'|'progressive'|'partial'|'ready' = 'loading';
    const motion = matchMedia('(prefers-reduced-motion: reduce)'), compact = matchMedia('(max-width: 800px), (pointer: coarse)');
    const render = () => {
      if (disposed || !ready) return;
      const prefs = readWorldPreferences();
      const moving = !document.hidden && !motion.matches && !compact.matches && !prefs.reduceMotion && prefs.cityLife && prefs.quality !== 'ECONOMY';
      ctx.imageSmoothingEnabled = false; ctx.clearRect(0,0,canvas.width,canvas.height); ctx.drawImage(background,0,0);
      const t = moving ? performance.now()/1000 : 0;
      plan.actors.forEach((actor,index) => {
        const image = images.get(actor.url); if (!image) return;
        const span = index === 2 ? 14 : 27, start = index === 2 ? 19 : 9;
        const travel = (t*(index === 2 ? .6 : 1.8) + index*8)%span;
        const x = (index === 1 ? start+span-travel : start+travel)*8;
        const y = (index === 2 ? 12.5 : index === 1 ? 13.6 : 15.1)*8;
        ctx.globalAlpha = moving ? Math.min(1,travel/1.5,(span-travel)/1.5) : 1;
        ctx.drawImage(image,Math.round(x-actor.anchor.x),Math.round(y-actor.anchor.y));
      });
      ctx.globalAlpha = 1;
      canvas.dataset.sceneMotion = moving ? 'ambient' : 'static';
      if (moving) timer = setTimeout(render,100); // One bounded 10fps decorative scene.
    };
    const refresh = () => { if (timer) clearTimeout(timer); timer = undefined; render(); };
    const paint = () => {
      paintTimer = undefined;
      if (disposed) return;
      ground.imageSmoothingEnabled = false; ground.clearRect(0,0,canvas.width,canvas.height);
      for (const tile of plan.tiles) { const image = images.get(tile.url); if (image) {ground.globalAlpha=tile.alpha??1; ground.drawImage(image,tile.sourceX,tile.sourceY,8,8,tile.x*8,tile.y*8,8,8); } }
      ground.globalAlpha=1;
      for (const sprite of plan.sprites) { const image = images.get(sprite.url); if (image) ground.drawImage(image,sprite.x,sprite.y,sprite.width,sprite.height); }
      ready = true; refresh();canvas.dataset.sceneState = sceneState;
    };
    const resize = () => {
      const host = canvas.parentElement!, width = host.clientWidth;
      const scale = width >= 540 && host.clientHeight >= 608 ? 2 : 1;
      canvas.style.width = `${canvas.width*scale}px`; canvas.style.height = `${canvas.height*scale}px`; canvas.dataset.pixelScale = String(scale);
      canvas.style.left = `${Math.round(width/2)}px`; canvas.style.top = `${Math.round(host.clientHeight/2)}px`;
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas.parentElement!); resize();
    const unsubscribe = subscribeWorldPreferences(refresh);
    document.addEventListener('visibilitychange',refresh); motion.addEventListener('change',refresh); compact.addEventListener('change',refresh);
    const disposeAssets = loadAuthSceneAssets({ urls:plan.assets, imageFactory:()=>new Image(), onProgress:state=>{
      if (disposed) return;
      images = state.loaded;
      sceneState = state.pending > 0 ? images.size ? 'progressive' : 'loading' : state.failed ? 'partial' : 'ready';
      canvas.dataset.loadedAssets = String(images.size); canvas.dataset.pendingAssets = String(state.pending);
      canvas.dataset.failedAssets = String(state.failed); canvas.dataset.timedOutAssets = String(state.timedOut);
      // Coalesce bursts at the same decorative 10fps limit as the actors.
      // The form never awaits painting, downloads or this bounded watchdog.
      if (images.size > 0 || state.pending === 0) paintTimer ??= setTimeout(paint,100);
    } });
    return () => {
      disposed = true; if (timer) clearTimeout(timer); observer.disconnect(); unsubscribe();
      if (paintTimer) clearTimeout(paintTimer); disposeAssets();
      document.removeEventListener('visibilitychange',refresh); motion.removeEventListener('change',refresh); compact.removeEventListener('change',refresh);
      images = new Map();
    };
  }, []);
  return <canvas ref={ref} className="auth-city-scene" width={AUTH_SCENE_SIZE.width} height={AUTH_SCENE_SIZE.height} aria-hidden="true" data-scene-state="loading" />;
}
