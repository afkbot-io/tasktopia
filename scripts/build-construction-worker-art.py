# coding: utf-8
"""Register generated frames at their feet and normalize without repainting."""
from pathlib import Path
import json, hashlib
from PIL import Image
ROOT = Path(__file__).resolve().parents[1]
FAMILY = ROOT / 'assets/pixel-city-pack/reference/ai-authored/construction-worker-v1'
source = FAMILY / 'sources/sheet.png'
raw = Image.open(source).convert('RGBA')
frames=[]
for row in range(2):
    for col, direction in enumerate(('north','east','south','west')):
        rect=(col*raw.width//4,row*raw.height//2,(col+1)*raw.width//4,(row+1)*raw.height//2)
        frame=raw.crop(rect)
        alpha=frame.getchannel('A').point(lambda a: 255 if a>=128 else 0)
        box=alpha.getbbox()
        assert box, 'Empty worker frame'
        feet=[x for y in range(box[3]-max(1,(box[3]-box[1])//12),box[3]) for x in range(box[0],box[2]) if alpha.getpixel((x,y))]
        frames.append((direction,row,frame,box,sum(feet)/len(feet)))
scale=min(5/max(b[2]-b[0] for _,_,_,b,_ in frames),6/max(b[3]-b[1] for _,_,_,b,_ in frames))
output=FAMILY/'normalized';output.mkdir(exist_ok=True)
preview=Image.new('RGBA',(48,24),'#81975b')
record={'sourceSha256':hashlib.sha256(source.read_bytes()).hexdigest(),'scale':scale,'frames':[]}
for index,(direction,row,frame,box,foot_x) in enumerate(frames):
    size=(max(1,round((box[2]-box[0])*scale)),max(1,round((box[3]-box[1])*scale)))
    small=frame.crop(box).resize(size,Image.Resampling.NEAREST)
    alpha=small.getchannel('A').point(lambda a:255 if a>=128 else 0)
    small=small.convert('RGB').quantize(colors=8,dither=Image.Dither.NONE).convert('RGBA');small.putalpha(alpha)
    native=Image.new('RGBA',(8,8));native.alpha_composite(small,(round(4-(foot_x-box[0])*scale),7-size[1]))
    name=f'construction-worker-{direction}-{row}.png';native.save(output/name,optimize=True)
    preview.alpha_composite(native,((index%4)*12+2,(index//4)*12+2))
    record['frames'].append({'key':name[:-4],'size':[8,8],'anchorPx':[4,8],'opaqueBounds':native.getchannel('A').getbbox(),'sha256':hashlib.sha256((output/name).read_bytes()).hexdigest()})
# One shared quantization palette across poses prevents colour flicker.
contact=Image.new('RGB',(64,8))
for index,entry in enumerate(record['frames']):
    contact.paste(Image.open(output/(entry['key']+'.png')).convert('RGB'),(index*8,0))
palette=contact.quantize(colors=8,dither=Image.Dither.NONE)
preview=Image.new('RGBA',(48,24),'#81975b')
for index,entry in enumerate(record['frames']):
    target=output/(entry['key']+'.png');native=Image.open(target).convert('RGBA');alpha=native.getchannel('A')
    native=native.convert('RGB').quantize(palette=palette,dither=Image.Dither.NONE).convert('RGBA');native.putalpha(alpha);native.save(target,optimize=True)
    entry['sha256']=hashlib.sha256(target.read_bytes()).hexdigest()
    preview.alpha_composite(native,((index%4)*12+2,(index//4)*12+2))
preview.resize((768,384),Image.Resampling.NEAREST).save(FAMILY/'preview.png')
(FAMILY/'normalization.json').write_text(json.dumps(record,indent=2)+'\n')

# Publication uses the same shared prop atlas as existing street furniture.
import sys
if '--publish' in sys.argv:
    import importlib.util
    spec=importlib.util.spec_from_file_location('publisher',ROOT/'scripts/build-pixel-city-pack.py')
    publisher=importlib.util.module_from_spec(spec);spec.loader.exec_module(publisher)
    pack=ROOT/'assets/pixel-city-pack'
    manifest=json.loads((pack/'manifest.json').read_text())
    catalog_path=pack/'catalog/ai-authored-props.json'
    catalog=[e for e in json.loads(catalog_path.read_text()) if not e['key'].startswith('compact-construction-worker-')]
    for frame in record['frames']:
        key='compact-'+frame['key']; art=Image.open(output/(frame['key']+'.png')).convert('RGBA');b=art.getchannel('A').getbbox()
        entry={'label':key,'path':f'props/{key}.png','size':[8,8],'footprintCells':[1,1], 'anchorPx':[4,8],
               'occupiedSize':[b[2]-b[0],b[3]-b[1]],'artSource':'AI_AUTHORED',
               'sourceSheet':'ai-authored/construction-worker-v1/sources/sheet.png',
               'visualProfile':'TASKTOPIA_V5_MICRO_DIRECTIONAL'}
        manifest['props'][key]=entry;publisher.save(art,entry['path'])
        catalog.append(dict(key=key,sheet=entry['sourceSheet'],artSource=entry['artSource'],visualProfile=entry['visualProfile'],size=entry['size'],footprintCells=entry['footprintCells']))
    publisher.pack_props(manifest)
    digest=hashlib.sha256()
    for path in sorted((pack/'runtime').rglob('*.png')):
        digest.update(str(path.relative_to(pack/'runtime')).encode());digest.update(path.read_bytes())
    manifest['assetRevision']=digest.hexdigest()[:16]
    for path in (pack/'manifest.json',ROOT/'public/game-assets/v5/manifest.json'):
        path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    catalog_path.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
    print(manifest['assetRevision'])
