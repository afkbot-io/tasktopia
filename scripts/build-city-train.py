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
sheetPath=PACK/'reference/ai-authored/city-train-v3/sheet.png'
sheet=Image.open(sheetPath).convert('RGBA')
preview=Image.new('RGBA',(24*8,24),'#81955c')
for index,(part,direction) in enumerate((p,d) for p in ('locomotive','carriage') for d in ('east','north','west','south')):
 source=sheetPath
 column=0 if part=='locomotive' else 1
 row=('east','north','west','south').index(direction)
 top,bottom=((0,.235),(.235,.53),(.53,.66),(.66,1))[row]
 sourceRect=(column*sheet.width//2,round(top*sheet.height),(column+1)*sheet.width//2,round(bottom*sheet.height))
 cell=sheet.crop(sourceRect)
 image=micro.normalize(cell,24,(24,8) if direction in ('east','west') else (8,24))
 bounds=image.getbbox()
 if not bounds or set(image.getchannel('A').getdata())-set((0,255)):
  raise ValueError(f'{part}-{direction}: empty or blurred train sprite')
 width,height=bounds[2]-bounds[0],bounds[3]-bounds[1]
 if (direction in ('east','west') and not (width>=16 and 3<=height<=8)) or (direction in ('north','south') and not (height>=16 and 3<=width<=8)):
  raise ValueError(f'{part}-{direction}: wrong heading envelope {bounds}')
 relative=f'city-transport/{part}-{direction}.png'
 for base in (PACK/'runtime',ROOT/'public/game-assets/v5'):
  output=base/relative;output.parent.mkdir(parents=True,exist_ok=True);image.save(output,optimize=True)
 entries[f'{part}-{direction}']={'path':relative,'size':[24,24],'anchorPx':[12,12],'opaqueBounds':list(image.getbbox()),'source':str(source.relative_to(PACK)),'sourceRect':list(sourceRect),'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}
 preview.alpha_composite(image,(index*24,0))
(PACK/'city-train-manifest.json').write_text(json.dumps({'schemaVersion':2,'artSource':'AI_AUTHORED','styleProfile':'TASKTOPIA_COMPACT_CARTOON_HIGH_45_V1','sprites':entries},indent=2)+'\n')
preview.resize((1536,192),Image.Resampling.NEAREST).save(PACK/'reference/ai-authored/city-train-v3/preview.png')
ferrySource=PACK/'reference/ai-authored/city-ferry-v1/sheet.png'
ferrySheet=Image.open(ferrySource).convert('RGBA')
ferryPreview=Image.new('RGBA',(24*4,24),'#5c8787')
for index,direction in enumerate(('east','north','west','south')):
 column=index%2;row=index//2
 sourceRect=(column*ferrySheet.width//2,row*ferrySheet.height//2,(column+1)*ferrySheet.width//2,(row+1)*ferrySheet.height//2)
 image=micro.normalize(ferrySheet.crop(sourceRect),24,(16,6) if direction in ('east','west') else (6,16))
 relative=f'city-transport/ferry-{direction}.png'
 for base in (PACK/'runtime',ROOT/'public/game-assets/v5'):
  output=base/relative;output.parent.mkdir(parents=True,exist_ok=True);image.save(output,optimize=True)
 entries[f'ferry-{direction}']={'path':relative,'size':[24,24],'anchorPx':[12,12],'opaqueBounds':list(image.getbbox()),'source':str(ferrySource.relative_to(PACK)),'sourceRect':list(sourceRect),'sourceSha256':hashlib.sha256(ferrySource.read_bytes()).hexdigest(),'sha256':hashlib.sha256(output.read_bytes()).hexdigest()}
 ferryPreview.alpha_composite(image,(index*24,0))
(PACK/'city-train-manifest.json').write_text(json.dumps({'schemaVersion':2,'artSource':'AI_AUTHORED','styleProfile':'TASKTOPIA_COMPACT_CARTOON_HIGH_45_V1','sprites':entries},indent=2)+'\n')
ferryPreview.save(PACK/'reference/ai-authored/city-ferry-v1/native.png')
ferryPreview.resize((768,192),Image.Resampling.NEAREST).save(PACK/'reference/ai-authored/city-ferry-v1/preview.png')
