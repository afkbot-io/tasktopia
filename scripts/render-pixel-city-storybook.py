#!/usr/bin/env python3
"""Build a standalone, manifest-driven visual QA storybook for Tasktopia Pixel City.

The output is deliberately separate from the game client. It uses the exact
runtime PNG files and their manifest geometry, so artists can review the whole
pack without generating a world or mutating production data.
"""

from __future__ import annotations

import argparse
import json
import struct
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "assets/pixel-city-pack"
MANIFEST_PATH = PACK / "manifest.json"
BUILDING_CATALOG_PATH = PACK / "catalog/buildings.json"
RUNTIME = PACK / "runtime"
DEFAULT_OUTPUT = ROOT / "screenshots/pixel-city-storybook/index.html"

AREA_TYPES = (
    {"key": "urban-formal", "label": "Формальный городской парк", "size": [18, 10], "focus": "fountain-large"},
    {"key": "urban-community", "label": "Районный парк", "size": [16, 10], "focus": "park-bandstand"},
    {"key": "urban-central", "label": "Центральный парк", "size": [12, 10], "focus": "park-sculpture"},
    {"key": "urban-botanical", "label": "Ботанический сад", "size": [10, 9], "focus": "park-pond"},
    {"key": "urban-amusement", "label": "Парк развлечений", "size": [10, 8], "focus": "playground-carousel"},
    {"key": "urban-grove", "label": "Городская роща", "size": [8, 7], "focus": "picnic-table"},
    {"key": "urban-park", "label": "Компактный городской парк", "size": [7, 6], "focus": "fountain-small"},
)


def png_size(path: Path) -> tuple[int, int]:
    """Read a PNG canvas without decoding its pixel payload."""
    with path.open("rb") as source:
        header = source.read(24)
    if len(header) != 24 or header[:8] != b"\x89PNG\r\n\x1a\n":
        raise ValueError(f"not a PNG: {path}")
    return struct.unpack(">II", header[16:24])


def asset_url(relative_path: str) -> str:
    return f"../../assets/pixel-city-pack/runtime/{relative_path}"


def classify_prop(key: str) -> str:
    groups = (
        ("Жители и активности", ("walker-", "resident-", "fisher-", "cyclist-", "scooter-")),
        ("Деревья и кустарники", ("tree-", "shrub-", "bush-", "flower-")),
        ("Парки и площадки", ("park-", "playground-", "fountain-", "gazebo", "bandstand", "statue-", "topiary-", "pond-", "picnic-", "planter-")),
        ("Улицы и транспорт", ("bus-stop-", "city-bus-", "streetlamp", "traffic-light-", "utility-pole", "bench-", "trash-", "recycling-", "bollard", "bicycle-", "mailbox", "fire-hydrant", "city-sign-", "guardrail-")),
        ("События и спецтехника", ("fire-engine-", "incident-", "airplane-", "active-district-")),
        ("Природа и животные", ("animal-", "boat-", "reed-", "rock-", "hill-", "mountain-")),
        ("Ограждения и архив", ("fence-", "archive-")),
    )
    for label, prefixes in groups:
        if key.startswith(prefixes):
            return label
    return "Прочий декор"


def load_storybook_data() -> tuple[dict[str, Any], list[str]]:
    manifest = json.loads(MANIFEST_PATH.read_text(encoding="utf-8"))
    building_catalog = json.loads(BUILDING_CATALOG_PATH.read_text(encoding="utf-8"))
    review_by_key = {
        entry["key"]: {
            "reviewed": bool(entry.get("reviewed")),
            "sourceKind": "stages",
        }
        for entry in building_catalog["buildings"]
    }
    errors: list[str] = []
    for entry in building_catalog["buildings"]:
        if len(entry.get("stageSources", [])) != 3 or len(entry.get("stageSha256", [])) != 3:
            errors.append(f"{entry['key']}: expected exactly three authored sources for stages 3-5")
    buildings: list[dict[str, Any]] = []
    for key, entry in sorted(manifest["buildings"].items(), key=lambda item: (item[1]["category"], item[0])):
        stages = []
        if len(entry["stages"]) != 5:
            errors.append(f"{key}: expected 5 stages, got {len(entry['stages'])}")
        for index, relative_path in enumerate(entry["stages"], start=1):
            path = RUNTIME / relative_path
            if not path.exists():
                errors.append(f"{key}: missing {relative_path}")
                continue
            size = list(png_size(path))
            if size != entry["spriteSize"]:
                errors.append(f"{key}: stage {index} is {size}, expected {entry['spriteSize']}")
            stages.append({
                "number": index,
                "url": asset_url(relative_path),
                "runtimeComposed": index <= 2,
            })
        buildings.append({
            "key": key,
            "label": entry["label"],
            "category": entry["category"],
            "rarity": entry["rarity"],
            "platform": entry["platform"],
            "spriteSize": entry["spriteSize"],
            "footprintCells": entry["footprintCells"],
            "anchorPx": entry["anchorPx"],
            "stages": stages,
            "review": review_by_key.get(key, {"reviewed": False, "sourceKind": "missing"}),
            "tags": entry.get("tags", []),
        })

    props: list[dict[str, Any]] = []
    for key, entry in sorted(manifest["props"].items()):
        path = RUNTIME / entry["path"]
        if not path.exists():
            errors.append(f"{key}: missing {entry['path']}")
            continue
        size = list(png_size(path))
        if size != entry["size"]:
            errors.append(f"{key}: prop is {size}, expected {entry['size']}")
        props.append({
            "key": key,
            "label": entry["label"],
            "url": asset_url(entry["path"]),
            "size": entry["size"],
            "footprintCells": entry["footprintCells"],
            "group": classify_prop(key),
            "visualProfile": entry.get("visualProfile"),
        })
        if entry.get("artSource") == "AI_AUTHORED" and not str(entry.get("visualProfile", "")).startswith("TASKTOPIA_V5_"):
            errors.append(f"{key}: active authored prop does not use the V5 visual profile")

    vehicles: list[dict[str, Any]] = []
    for key, entry in sorted(manifest["vehicles"].items()):
        views = []
        for direction in ("horizontal", "north", "south"):
            view = entry[direction]
            path = RUNTIME / view["path"]
            if not path.exists():
                errors.append(f"{key}: missing {view['path']}")
                continue
            size = list(png_size(path))
            if size != view["size"]:
                errors.append(f"{key}/{direction}: {size}, expected {view['size']}")
            views.append({"direction": direction, "url": asset_url(view["path"]), "size": view["size"]})
        vehicles.append({"key": key, "views": views})

    tiles = [
        {"key": key, "url": asset_url(entry["path"]), "role": entry["materialRole"]}
        for key, entry in sorted(manifest["tiles"].items())
    ]
    terrain = [
        {"key": key, "variants": [asset_url(path) for path in paths]}
        for key, paths in sorted(manifest["terrain"].items())
    ]
    data = {
        "pack": {
            "version": manifest["version"],
            "revision": manifest["assetRevision"],
            "gridPx": manifest["gridPx"],
            "materialProfile": manifest["materialProfile"],
        },
        "buildings": buildings,
        "props": props,
        "vehicles": vehicles,
        "tiles": tiles,
        "terrain": terrain,
        "areas": AREA_TYPES,
        "counts": {
            "buildings": len(buildings),
            "stages": sum(len(item["stages"]) for item in buildings),
            "props": len(props),
            "vehicles": len(vehicles),
            "areas": len(AREA_TYPES),
            "terrainFamilies": len(terrain),
            "reviewedBuildings": sum(1 for item in buildings if item["review"]["reviewed"]),
        },
    }
    return data, errors


def html_document(data: dict[str, Any]) -> str:
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    return f'''<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Tasktopia Pixel City — Asset Storybook</title>
  <style>
    :root {{ color-scheme: dark; --zoom: 1; --cell: calc(8px * var(--zoom)); --ink:#ecf1df; --muted:#9badad; --line:#35505a; --panel:#102126; --deep:#071418; --accent:#f0c84b; --cyan:#62c6e8; }}
    * {{ box-sizing:border-box }}
    html {{ scroll-behavior:smooth }}
    body {{ margin:0; background:#071215; color:var(--ink); font:14px/1.45 Inter,ui-sans-serif,system-ui,sans-serif }}
    button,input,select {{ font:inherit }}
    img {{ image-rendering:pixelated; image-rendering:crisp-edges }}
    header {{ position:sticky; top:0; z-index:50; display:grid; grid-template-columns:minmax(220px,1fr) minmax(300px,2fr) auto; gap:16px; align-items:center; padding:14px 20px; background:rgba(7,20,24,.96); border-bottom:1px solid var(--line); backdrop-filter:blur(12px) }}
    h1,h2,h3,p {{ margin:0 }}
    h1 {{ font-size:18px; letter-spacing:.04em }}
    h2 {{ font-size:24px; margin-bottom:6px }}
    h3 {{ font-size:14px }}
    .eyebrow {{ color:var(--cyan); font-size:10px; letter-spacing:.16em; text-transform:uppercase; font-weight:800 }}
    .summary {{ color:var(--muted); font-size:12px }}
    .controls {{ display:flex; gap:8px; flex-wrap:wrap; justify-content:flex-end }}
    .control {{ border:1px solid var(--line); background:#0c1c21; color:var(--ink); border-radius:9px; padding:8px 10px }}
    input.control {{ min-width:260px }}
    main {{ max-width:2200px; margin:0 auto; padding:26px 20px 100px }}
    .hero {{ display:flex; justify-content:space-between; gap:24px; align-items:end; margin-bottom:24px }}
    .stats {{ display:flex; gap:8px; flex-wrap:wrap }}
    .stat {{ min-width:104px; padding:10px 12px; border:1px solid var(--line); background:var(--panel); border-radius:10px }}
    .stat b {{ display:block; font-size:20px; color:var(--accent) }}
    .section {{ margin:34px 0 54px }}
    .section-head {{ display:flex; align-items:end; justify-content:space-between; gap:16px; margin-bottom:16px }}
    .district {{ border:1px solid var(--line); border-radius:14px; overflow:hidden; background:#0c1a1e; box-shadow:0 18px 60px #0007 }}
    .district-title {{ padding:12px 16px; display:flex; justify-content:space-between; background:#13272c; border-bottom:1px solid var(--line) }}
    .city-lines {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(760px,1fr)); gap:2px; background:#29434b }}
    .family {{ display:grid; grid-template-columns:200px minmax(0,1fr); min-height:160px; background-color:#718e50; background-image:url('../../assets/pixel-city-pack/runtime/terrain/grass-0.png') }}
    .family:nth-child(even) {{ background-image:url('../../assets/pixel-city-pack/runtime/terrain/grass-1.png') }}
    .family-info {{ align-self:stretch; padding:16px; background:linear-gradient(90deg,#0b1b20f2,#0b1b20c7 82%,transparent); z-index:2 }}
    .family-key {{ color:#b5c7c5; font:11px/1.4 ui-monospace,SFMono-Regular,Consolas,monospace; word-break:break-all }}
    .badges {{ display:flex; flex-wrap:wrap; gap:5px; margin-top:10px }}
    .badge {{ padding:2px 6px; border-radius:999px; border:1px solid #45616a; background:#11272d; color:#bcd0cd; font-size:10px }}
    .badge.ok {{ color:#8ce58e; border-color:#397341 }} .badge.queue {{ color:#f0c84b; border-color:#806c31 }}
    .stage-street {{ min-width:0; display:flex; gap:16px; align-items:end; overflow:auto; padding:20px 28px 22px; border-bottom:calc(3 * var(--cell)) solid transparent; border-image:url('../../assets/pixel-city-pack/runtime/tiles/road.png') 8 repeat }}
    .plot {{ position:relative; flex:0 0 auto; display:flex; align-items:end; justify-content:center; min-width:calc(var(--w) * 1px * var(--zoom) + 2 * var(--cell)); height:calc(var(--h) * 1px * var(--zoom) + 4 * var(--cell)); padding:var(--cell); background-image:url('../../assets/pixel-city-pack/runtime/tiles/pavement.png'); background-size:var(--cell) var(--cell); border:1px solid #78909866 }}
    .plot[data-platform="YARD"] {{ background-image:url('../../assets/pixel-city-pack/runtime/terrain/meadow-0.png') }}
    .plot[data-platform="ASPHALT"] {{ background-image:url('../../assets/pixel-city-pack/runtime/tiles/road.png') }}
    .grid-on .plot::after,.grid-on .park-canvas::after {{ content:""; position:absolute; inset:0; pointer-events:none; background-image:linear-gradient(#f0c84b28 1px,transparent 1px),linear-gradient(90deg,#f0c84b28 1px,transparent 1px); background-size:var(--cell) var(--cell) }}
    .stage-img {{ display:block; width:calc(var(--w) * 1px * var(--zoom)); height:calc(var(--h) * 1px * var(--zoom)); object-fit:contain }}
    .stage-no {{ position:absolute; left:5px; top:5px; z-index:3; width:20px; height:20px; display:grid; place-items:center; border-radius:5px; background:#071418e8; border:1px solid #557079; color:var(--accent); font:700 11px ui-monospace,monospace }}
    .runtime-note {{ position:absolute; right:5px; top:5px; z-index:3; max-width:calc(100% - 34px); padding:3px 6px; border-radius:5px; background:#071418e8; border:1px solid #557079; color:#bcd0cd; font:700 9px/1.2 ui-monospace,monospace; text-align:right }}
    .atlas {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:12px }}
    .asset-card {{ min-width:0; border:1px solid var(--line); border-radius:12px; background:var(--panel); overflow:hidden }}
    .asset-card-info {{ padding:10px 12px; border-bottom:1px solid var(--line) }}
    .asset-card-stage {{ min-height:240px; display:flex; align-items:end; justify-content:center; overflow:auto; padding:14px; background-image:url('../../assets/pixel-city-pack/runtime/tiles/pavement.png'); background-size:var(--cell) var(--cell) }}
    .compare {{ overflow:auto; border:1px solid var(--line); border-radius:12px }}
    .compare-row {{ min-width:980px; display:grid; grid-template-columns:250px repeat(5,minmax(140px,1fr)); border-bottom:1px solid var(--line); background:var(--panel) }}
    .compare-row:last-child {{ border-bottom:0 }}
    .compare-meta {{ padding:12px; position:sticky; left:0; z-index:3; background:#102126 }}
    .compare-stage {{ position:relative; min-height:180px; display:flex; align-items:end; justify-content:center; padding:12px; border-left:1px solid var(--line); background-image:url('../../assets/pixel-city-pack/runtime/tiles/pavement.png'); background-size:var(--cell) var(--cell); overflow:hidden }}
    .compare-stage img {{ max-width:100%; max-height:360px; object-fit:contain }}
    .park-grid,.transport-grid,.prop-groups,.tile-grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(320px,1fr)); gap:14px }}
    .park-grid {{ grid-template-columns:1fr }}
    .park-card,.transport-card,.prop-group,.tile-card {{ border:1px solid var(--line); border-radius:12px; background:var(--panel); padding:14px; overflow:auto }}
    .park-stages {{ display:flex; gap:10px; margin-top:12px; align-items:start }}
    .park-canvas {{ position:relative; display:grid; grid-template-columns:repeat(var(--cols),var(--cell)); grid-template-rows:repeat(var(--rows),var(--cell)); flex:0 0 auto; border:1px solid #648087 }}
    .park-cell {{ width:var(--cell); height:var(--cell); background-size:var(--cell) var(--cell) }}
    .park-prop {{ position:absolute; z-index:2; image-rendering:pixelated; transform:translate(-50%,-100%) scale(var(--zoom)); transform-origin:bottom center }}
    .view-row {{ display:flex; align-items:end; gap:18px; min-height:116px; padding:14px; margin-top:10px; background-image:url('../../assets/pixel-city-pack/runtime/tiles/road.png'); background-size:var(--cell) var(--cell) }}
    .view {{ text-align:center; min-width:64px }} .view img {{ display:block; margin:auto; transform:scale(4); transform-origin:center bottom; margin-bottom:26px }}
    .view small {{ color:var(--muted) }}
    .prop-rack {{ display:grid; grid-template-columns:repeat(auto-fill,minmax(104px,1fr)); gap:8px; margin-top:12px }}
    .prop {{ min-height:112px; padding:8px; display:flex; flex-direction:column; justify-content:end; align-items:center; gap:8px; background:#0a191d; border:1px solid #29464e; border-radius:8px; text-align:center; overflow:hidden }}
    .prop img {{ transform:scale(3); transform-origin:center bottom; margin:28px 0 12px }}
    .prop span {{ width:100%; color:#b8c9c6; font:10px/1.25 ui-monospace,monospace; overflow-wrap:anywhere }}
    .tile-rack {{ display:flex; flex-wrap:wrap; gap:12px; margin-top:12px }}
    .tile {{ width:104px; text-align:center }} .tile img {{ width:64px; height:64px; image-rendering:pixelated; border:1px solid var(--line) }}
    .empty {{ padding:36px; border:1px dashed var(--line); color:var(--muted); text-align:center; border-radius:12px }}
    .switcher {{ position:fixed; z-index:100; left:50%; bottom:18px; transform:translateX(-50%); display:flex; align-items:center; gap:8px; padding:8px; border:1px solid #67838d; border-radius:14px; background:#071418f2; box-shadow:0 12px 40px #000a }}
    .switcher a {{ padding:8px 11px; border-radius:8px; color:var(--muted); text-decoration:none; border:1px solid transparent }}
    .switcher a.active {{ color:#071418; background:var(--accent); font-weight:800 }}
    [hidden] {{ display:none!important }}
    @media(max-width:900px) {{ header {{ grid-template-columns:1fr }} .controls {{ justify-content:flex-start }} input.control {{ min-width:100% }} .hero {{ align-items:start; flex-direction:column }} .family {{ grid-template-columns:1fr }} .family-info {{ background:#0b1b20e8 }} }}
  </style>
</head>
<body class="grid-on">
  <header>
    <div><div class="eyebrow">Pixel City V5 · visual QA</div><h1>Tasktopia Asset Storybook</h1></div>
    <input id="search" class="control" type="search" placeholder="Поиск по названию, key или тегу…" aria-label="Поиск ассетов">
    <div class="controls">
      <select id="category" class="control" aria-label="Категория"><option value="ALL">Все категории</option><option>HOUSE</option><option>COMMERCIAL</option><option>CIVIC</option><option>HIGHRISE</option></select>
      <select id="stage" class="control" aria-label="Стадия"><option value="ALL">Все 5 стадий</option><option value="1">Стадия 1</option><option value="2">Стадия 2</option><option value="3">Стадия 3</option><option value="4">Стадия 4</option><option value="5">Стадия 5</option></select>
      <select id="zoom" class="control" aria-label="Масштаб"><option value="1">1× native</option><option value="2">2×</option><option value="3">3×</option><option value="4">4×</option></select>
      <button id="grid" class="control" type="button">Сетка 8 px</button>
    </div>
  </header>
  <main>
    <section class="hero">
      <div><div class="eyebrow">Без генерации мира · только runtime-ассеты</div><h2 id="variant-title"></h2><p class="summary">Все изображения берутся напрямую из manifest.json. Никакого ресайза с искажением: CSS меняет только целочисленный nearest-neighbour масштаб.</p></div>
      <div class="stats" id="stats"></div>
    </section>
    <div id="content"></div>
    <section class="section" id="parks"><div class="section-head"><div><div class="eyebrow">AREA · 5 стадий</div><h2>Парки и рощи</h2></div><p class="summary">Покрытие собирается из реальных тайлов, декор — из реальных props.</p></div><div class="park-grid" id="park-grid"></div></section>
    <section class="section" id="transport"><div class="section-head"><div><div class="eyebrow">Три направления + west mirror</div><h2>Транспорт</h2></div></div><div class="transport-grid" id="transport-grid"></div></section>
    <section class="section" id="props"><div class="section-head"><div><div class="eyebrow">Ambient</div><h2>Жители, деревья, улицы и декор</h2></div></div><div class="prop-groups" id="prop-groups"></div></section>
    <section class="section" id="materials"><div class="section-head"><div><div class="eyebrow">8×8 material contract</div><h2>Рельеф, тайлы и разметка</h2></div></div><div class="tile-grid"><div class="tile-card"><h3>Terrain</h3><div class="tile-rack" id="terrain-rack"></div></div><div class="tile-card"><h3>Infrastructure</h3><div class="tile-rack" id="tile-rack"></div></div></div></section>
  </main>
  <nav class="switcher" aria-label="Режим Storybook"><a data-variant="A" href="?variant=A">A · Город</a><a data-variant="B" href="?variant=B">B · Каталог</a><a data-variant="C" href="?variant=C">C · Стадии</a></nav>
  <script id="storybook-data" type="application/json">{payload}</script>
  <script>
    const data = JSON.parse(document.getElementById('storybook-data').textContent);
    const params = new URLSearchParams(location.search);
    const variant = ['A','B','C'].includes(params.get('variant')) ? params.get('variant') : 'A';
    const titles = {{A:'Город из всех семейств',B:'Полный каталог ассетов',C:'Геометрия пяти стадий'}};
    document.getElementById('variant-title').textContent = titles[variant];
    document.querySelectorAll('[data-variant]').forEach(a => a.classList.toggle('active', a.dataset.variant === variant));
    document.getElementById('stats').innerHTML = [
      [data.counts.buildings,'зданий'],[data.counts.stages,'стадий'],[data.counts.props,'props'],[data.counts.vehicles,'моделей авто'],[data.counts.areas,'типов парков'],[data.counts.terrainFamilies,'terrain families']
    ].map(([n,l]) => `<div class="stat"><b>${{n}}</b>${{l}}</div>`).join('');
    const controls = {{search:document.getElementById('search'),category:document.getElementById('category'),stage:document.getElementById('stage')}};
    const img = (src, cls, style='') => `<img decoding="async" class="${{cls}}" src="${{src}}" style="${{style}}">`;
    function selectedBuildings() {{
      const query = controls.search.value.trim().toLowerCase();
      return data.buildings.filter(b => (controls.category.value === 'ALL' || b.category === controls.category.value) && (!query || [b.key,b.label,...b.tags].join(' ').toLowerCase().includes(query)));
    }}
    function stageList(building) {{ return controls.stage.value === 'ALL' ? building.stages : building.stages.filter(s => String(s.number) === controls.stage.value); }}
    function badges(b) {{ return `<div class="badges"><span class="badge">${{b.spriteSize.join('×')}} px</span><span class="badge">${{b.footprintCells.join('×')}} cells</span><span class="badge">${{b.platform}}</span><span class="badge ${{b.review.reviewed?'ok':'queue'}}">${{b.review.reviewed?'reviewed':'очередь review'}}</span></div>`; }}
    function runtimeNote(s) {{ return s.runtimeComposed ? '<span class="runtime-note">runtime-конструктор</span>' : ''; }}
    function family(b) {{
      const stages = stageList(b).map(s => `<div class="plot" data-platform="${{b.platform}}" style="--w:${{b.spriteSize[0]}};--h:${{b.spriteSize[1]}}"><span class="stage-no">${{s.number}}</span>${{runtimeNote(s)}}${{img(s.url,'stage-img',`--w:${{b.spriteSize[0]}};--h:${{b.spriteSize[1]}}`)}}</div>`).join('');
      return `<article class="family" data-key="${{b.key}}"><div class="family-info"><h3>${{b.label}}</h3><div class="family-key">${{b.key}}</div>${{badges(b)}}</div><div class="stage-street">${{stages}}</div></article>`;
    }}
    function renderA(buildings) {{
      return ['HOUSE','COMMERCIAL','CIVIC','HIGHRISE'].map(category => {{ const items=buildings.filter(b=>b.category===category); if(!items.length)return ''; return `<section class="section"><div class="section-head"><div><div class="eyebrow">район</div><h2>${{category}}</h2></div><span class="summary">${{items.length}} семейств · по пять участков</span></div><div class="district"><div class="district-title"><b>${{category}}</b><span>стадии 1 → 5</span></div><div class="city-lines">${{items.map(family).join('')}}</div></div></section>`; }}).join('');
    }}
    function renderB(buildings) {{
      const cards=buildings.map(b=>{{const stages=stageList(b); return `<article class="asset-card"><div class="asset-card-info"><h3>${{b.label}}</h3><div class="family-key">${{b.key}}</div>${{badges(b)}}</div><div class="asset-card-stage">${{stages.map(s=>`<div class="plot" data-platform="${{b.platform}}" style="--w:${{b.spriteSize[0]}};--h:${{b.spriteSize[1]}}"><span class="stage-no">${{s.number}}</span>${{runtimeNote(s)}}${{img(s.url,'stage-img',`--w:${{b.spriteSize[0]}};--h:${{b.spriteSize[1]}}`)}}</div>`).join('')}}</div></article>`;}}).join('');
      return `<section class="section"><div class="atlas">${{cards}}</div></section>`;
    }}
    function renderC(buildings) {{
      const rows=buildings.map(b=>`<article class="compare-row"><div class="compare-meta"><h3>${{b.label}}</h3><div class="family-key">${{b.key}}</div>${{badges(b)}}</div>${{b.stages.map(s=>`<div class="compare-stage"><span class="stage-no">${{s.number}}</span>${{runtimeNote(s)}}${{img(s.url,'',`width:${{b.spriteSize[0]}}px;height:${{b.spriteSize[1]}}px`)}}</div>`).join('')}}</article>`).join('');
      return `<section class="section"><div class="compare">${{rows}}</div></section>`;
    }}
    function renderBuildings() {{ const list=selectedBuildings(); document.getElementById('content').innerHTML=list.length?(variant==='A'?renderA(list):variant==='B'?renderB(list):renderC(list)):'<div class="empty">Ничего не найдено</div>'; }}
    function tileUrl(key) {{ return data.tiles.find(t=>t.key===key)?.url || data.tiles[0].url; }}
    const propByKey = Object.fromEntries(data.props.map(p=>[p.key,p]));
    function parkProp(key,x,y) {{ const p=propByKey[key]; if(!p)return ''; return img(p.url,'park-prop',`left:calc(${{x}} * var(--cell));top:calc(${{y}} * var(--cell));`); }}
    function parkStage(area,stage) {{
      const [cols,rows]=area.size; let cells='';
      const formal=['urban-formal','urban-community','urban-central'].includes(area.key);
      const centerX=Math.floor((cols-1)/2),centerY=Math.floor((rows-1)/2);
      const centerXs=new Set([centerX,...(formal&&cols%2===0?[centerX+1]:[])]),centerYs=new Set([centerY,...(formal&&rows%2===0?[centerY+1]:[])]);
      for(let y=0;y<rows;y++) for(let x=0;x<cols;x++) {{
        const boundary=x===0||y===0||x===cols-1||y===rows-1;
        const axial=cols>=6&&rows>=5&&(centerXs.has(x)||centerYs.has(y));
        const loop=['urban-botanical','urban-amusement'].includes(area.key)&&cols>=8&&rows>=7&&(x===2||x===cols-3||y===2||y===rows-3);
        let key='dirt'; if(stage>=2&&boundary) key='pavement'; else if(stage>=2&&(axial||loop)) key=area.key==='urban-grove'?'path-brown':'path-pavers'; else if(stage>=3) key='grass';
        cells+=`<span class="park-cell" style="background-image:url('${{tileUrl(key)}}')"></span>`;
      }}
      let props='';
      if(stage>=3) {{ props+=parkProp(area.key==='urban-grove'?'tree-pine':'tree-oak',2,rows-1)+parkProp('tree-maple',cols-2,rows-1); if(formal) props+=parkProp('flower-bed-horizontal',3,3)+parkProp('flower-bed-horizontal',cols-3,3)+parkProp('shrub-flowering',3,rows-2)+parkProp('shrub-flowering',cols-3,rows-2); }}
      if(stage>=4) {{ props+=parkProp(area.key==='urban-amusement'?'playground-slide':'park-bench-double',Math.floor(cols*.3),Math.floor(rows*.65)); props+=parkProp('park-lamp',Math.floor(cols*.7),Math.floor(rows*.65)); }}
      if(stage>=5) props+=parkProp(area.focus,Math.floor(cols/2),Math.floor(rows/2)+2);
      return `<div><div class="summary">Стадия ${{stage}}</div><div class="park-canvas" style="--cols:${{cols}};--rows:${{rows}}">${{cells}}${{props}}</div></div>`;
    }}
    document.getElementById('park-grid').innerHTML=data.areas.map(a=>`<article class="park-card"><h3>${{a.label}}</h3><div class="family-key">${{a.key}} · ${{a.size.join('×')}} cells</div><div class="park-stages">${{[1,2,3,4,5].map(s=>parkStage(a,s)).join('')}}</div></article>`).join('');
    document.getElementById('transport-grid').innerHTML=data.vehicles.map(v=>`<article class="transport-card"><h3>${{v.key}}</h3><div class="view-row">${{v.views.map(view=>`<div class="view">${{img(view.url,'')}}<small>${{view.direction}}</small></div>`).join('')}}${{v.views[0]?`<div class="view">${{img(v.views[0].url,'','transform:scale(-4,4)')}}<small>west mirror</small></div>`:''}}</div></article>`).join('');
    const groups=Object.groupBy?Object.groupBy(data.props,p=>p.group):data.props.reduce((out,p)=>((out[p.group]??=[]).push(p),out),{{}});
    document.getElementById('prop-groups').innerHTML=Object.entries(groups).map(([group,items])=>`<section class="prop-group"><h3>${{group}}</h3><div class="prop-rack">${{items.map(p=>`<div class="prop">${{img(p.url,'')}}<span>${{p.key}}<br>${{p.size.join('×')}} · ${{p.visualProfile||'manifest'}}</span></div>`).join('')}}</div></section>`).join('');
    document.getElementById('terrain-rack').innerHTML=data.terrain.flatMap(t=>t.variants.map((url,index)=>`<div class="tile">${{img(url,'')}}<div class="family-key">${{t.key}}-${{index}}</div><small>${{data.pack.materialProfile}}</small></div>`)).join('');
    document.getElementById('tile-rack').innerHTML=data.tiles.map(t=>`<div class="tile">${{img(t.url,'')}}<div class="family-key">${{t.key}}</div><small>${{t.role}}</small></div>`).join('');
    controls.search.addEventListener('input',renderBuildings); controls.category.addEventListener('change',renderBuildings); controls.stage.addEventListener('change',renderBuildings);
    document.getElementById('zoom').addEventListener('change',event=>document.documentElement.style.setProperty('--zoom',event.target.value));
    document.getElementById('grid').addEventListener('click',()=>document.body.classList.toggle('grid-on'));
    addEventListener('keydown',event=>{{ if(['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName))return; if(event.key==='ArrowLeft'||event.key==='ArrowRight'){{ const order=['A','B','C']; const next=(order.indexOf(variant)+(event.key==='ArrowRight'?1:2))%3; location.search=`?variant=${{order[next]}}`; }} }});
    renderBuildings();
  </script>
</body>
</html>'''


def describe(data: dict[str, Any], errors: list[str]) -> dict[str, Any]:
    return {
        "output": str(DEFAULT_OUTPUT),
        "variants": ["A", "B", "C"],
        "counts": data["counts"],
        "assetRevision": data["pack"]["revision"],
        "errors": errors,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--describe", action="store_true", help="print the validated Storybook contract")
    parser.add_argument("--check", action="store_true", help="validate assets without writing HTML")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    data, errors = load_storybook_data()
    if args.describe:
        print(json.dumps(describe(data, errors), ensure_ascii=False))
        return
    if errors:
        raise SystemExit("\n".join(errors))
    if args.check:
        print(json.dumps(describe(data, errors), ensure_ascii=False))
        return
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(html_document(data), encoding="utf-8")
    print(json.dumps({**describe(data, errors), "output": str(args.output)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
