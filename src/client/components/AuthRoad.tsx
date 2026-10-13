import { useEffect, useRef } from 'react';
import { gameAssetUrl } from '../../shared/catalog';
import { roadAtlasTile } from '../../shared/road-atlas';

/** Reuse the native road atlas; no rotated bitmap or decorative CSS road texture. */
export function AuthRoad({ vertical = false }: { vertical?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = ref.current!, context = canvas.getContext('2d');
    if (!context) return;
    const tile = roadAtlasTile({ x: 0, y: 0, mask: 15, structure: 'ROAD', roadClass: 'LOCAL' });
    const image = new Image();
    image.onload = () => {
      context.imageSmoothingEnabled = false;
      for (let y = 0; y < canvas.height; y += 16) for (let x = 0; x < canvas.width; x += 16)
        context.drawImage(image, tile.sourceX, tile.sourceY, 8, 8, x, y, 16, 16);
      canvas.dataset.materialLoaded = 'true';
    };
    image.src = gameAssetUrl(tile.url);
    return () => { image.onload = null; };
  }, []);
  return <canvas ref={ref} aria-hidden="true" width={vertical ? 48 : 496} height={vertical ? 432 : 48}
    className={`auth-world-road auth-world-road-${vertical ? 'v' : 'h'}`} />;
}
