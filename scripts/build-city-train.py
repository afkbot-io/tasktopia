#!/usr/bin/env python3
"""Normalize authored train headings using the established micro-sprite pipeline."""
import hashlib
import importlib.util
import json
from pathlib import Path
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
PACK=ROOT/'assets/pixel-city-pack'
spec=importlib.util.spec_from_file_location('micro_builder',ROOT/'scripts/build-micro-ambient.py')
micro=importlib.util.module_from_spec(spec)
spec.loader.exec_module(micro)
entries={}
preview=Image.new('RGBA',(24*4,24),'#81955c')
for index,(part,direction) in enumerate((p,d) for p in ('locomotive','carriage') for d in ('east','north')):
 source=PACK/f'reference/ai-authored/city-train-v1/sources/{part}-{direction}.png'
 image=micro.normalize(Image.open(source).convert('RGBA'),24,(24,8) if direction=='east' else (8,24))
 bounds=image.getbbox()
 if not bounds or set(image.getchannel('A').getdata())-set((0,255)):
  raise ValueError(f'{part}-{direction}: empty or blurred train sprite')
 width,height=bounds[2]-bounds[0],bounds[3]-bounds[1]
 if (direction=='east' and not (width>=16 and 3<=height<=8)) or (direction=='north' and not (height>=16 and 3<=width<=8)):
  raise ValueError(f'{part}-{direction}: wrong heading envelope {bounds}')
 relative=f'city-transport/{part}-{direction}.png'
 for base in (PACK/'runtime',ROOT/'public/game-assets/v5'):
  output=base/relative;output.parent.mkdir(parents=True,exist_ok=True);image.save(output,optimize=True)
 entries[f'{part}-{direction}']={'path':relative,'size':[24,24],'anchorPx':[12,12],'opaqueBounds':list(image.getbbox()),'source':str(source.relative_to(PACK)),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}
 preview.alpha_composite(image,(index*24,0))
(PACK/'city-train-manifest.json').write_text(json.dumps({'schemaVersion':1,'sprites':entries},indent=2)+'\n')
preview.resize((768,192),Image.Resampling.NEAREST).save(PACK/'reference/ai-authored/city-train-v1/preview.png')
