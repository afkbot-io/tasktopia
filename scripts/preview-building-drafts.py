"""Mechanical source contact sheet; never paints or modifies authored sprites."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
sources = sorted((root / "tmp/new-building-art").glob("*-stage5.png"))
sheet = Image.new("RGB", (1250, ((len(sources) + 4) // 5) * 280), "#294449")
draw = ImageDraw.Draw(sheet)
for index, source in enumerate(sources):
    image = Image.open(source).convert("RGBA")
    image.thumbnail((246, 246), Image.Resampling.NEAREST)
    x, y = index % 5 * 250, index // 5 * 280
    sheet.paste(image, (x, y), image)
    draw.text((x + 4, y + 249), source.stem.replace("compact-", ""), fill="white")
    print(source.name, Image.open(source).mode, Image.open(source).size)
sheet.save(root / "tmp/new-building-art/contact.png")
native = Image.new("RGB", (1250, ((len(sources) + 4) // 5) * 280), "#7e9358")
draw = ImageDraw.Draw(native)
for index, source in enumerate(sources):
    key = source.stem.removesuffix("-stage5")
    sprite = root / "assets/pixel-city-pack/reference/ai-authored" / key / "normalized/stage-5.png"
    if not sprite.exists():
        continue
    image = Image.open(sprite).convert("RGBA")
    x, y = index % 5 * 250, index // 5 * 280
    native.paste(image, (x + 100, y), image)
    enlarged = image.resize((192, 192), Image.Resampling.NEAREST)
    native.paste(enlarged, (x + 25, y + 53), enlarged)
    draw.text((x + 4, y + 249), key.replace("compact-", ""), fill="white")
native.save(root / "tmp/new-building-art/native-contact.png")
