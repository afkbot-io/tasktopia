import { useEffect, useRef } from 'react';
import { AUTH_SCENE_SIZE, createAuthScenePlan } from '../auth-scene-plan';
import { readWorldPreferences, subscribeWorldPreferences } from '../world-preferences';

let cachedPlan: ReturnType<typeof createAuthScenePlan> | undefined;

export function AuthWorldScene() {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const plan = cachedPlan ??= createAuthScenePlan();
    const canvas = ref.current!, ctx = canvas.getContext('2d');
    if (!ctx) { canvas.dataset.sceneState = 'unavailable'; return; }
    const background = document.createElement('canvas'); background.width = canvas.width; background.height = canvas.height;
    const ground = background.getContext('2d')!;
    const images = new Map<string, HTMLImageElement>(), pending: HTMLImageElement[] = [];
    let disposed = false, ready = false, timer: ReturnType<typeof setTimeout> | undefined;
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
    const resize = () => {
      const host = canvas.parentElement!, width = host.clientWidth;
      const scale = width >= 540 && host.clientHeight >= 608 ? 2 : 1;
      canvas.style.width = `${canvas.width*scale}px`; canvas.style.height = `${canvas.height*scale}px`; canvas.dataset.pixelScale = String(scale);
      canvas.style.left = `${Math.round(width/2)}px`; canvas.style.top = `${Math.round(host.clientHeight/2)}px`;
    };
    const observer = new ResizeObserver(resize); observer.observe(canvas.parentElement!); resize();
    const unsubscribe = subscribeWorldPreferences(refresh);
    document.addEventListener('visibilitychange',refresh); motion.addEventListener('change',refresh); compact.addEventListener('change',refresh);
    void Promise.all(plan.assets.map(url => new Promise<void>(resolve => {
      const image = new Image(); pending.push(image);
      image.onload = () => { images.set(url,image); resolve(); }; image.onerror = () => resolve(); image.src = url;
    }))).then(() => {
      if (disposed) return;
      ground.imageSmoothingEnabled = false; ground.clearRect(0,0,canvas.width,canvas.height);
      for (const tile of plan.tiles) { const image = images.get(tile.url); if (image) {ground.globalAlpha=tile.alpha??1; ground.drawImage(image,tile.sourceX,tile.sourceY,8,8,tile.x*8,tile.y*8,8,8); } }
      ground.globalAlpha=1;
      for (const sprite of plan.sprites) { const image = images.get(sprite.url); if (image) ground.drawImage(image,sprite.x,sprite.y,sprite.width,sprite.height); }
      ready = true; canvas.dataset.sceneState = images.size === plan.assets.length ? 'ready' : 'partial'; refresh();
    });
    return () => {
      disposed = true; if (timer) clearTimeout(timer); observer.disconnect(); unsubscribe();
      document.removeEventListener('visibilitychange',refresh); motion.removeEventListener('change',refresh); compact.removeEventListener('change',refresh);
      for (const image of pending) { image.onload = null; image.onerror = null; }
      images.clear();
    };
  }, []);
  return <canvas ref={ref} className="auth-city-scene" width={AUTH_SCENE_SIZE.width} height={AUTH_SCENE_SIZE.height} aria-hidden="true" data-scene-state="loading" />;
}
