"""Mechanical contact sheets from real browser captures, never sprite authoring."""
from pathlib import Path
from PIL import Image, ImageDraw

root = Path(__file__).resolve().parents[1]
captures = root / "screenshots/compact-rc-final"
output = root / "tmp/compact-runtime-review"
output.mkdir(parents=True, exist_ok=True)
families = sorted({path.name.rsplit("-stage-", 1)[0] for path in captures.glob("*-stage-5.png")})
for family in families:
    sheet = Image.new("RGB", (1440, 510), "#12262a")
    draw = ImageDraw.Draw(sheet)
    for index, stage in enumerate([3, 4, 5]):
        image = Image.open(captures / f"{family}-stage-{stage}.png").convert("RGB")
        x, y = image.width // 2, (image.height + 52) // 2
        crop = image.crop((x - 240, y - 240, x + 240, y + 240))
        sheet.paste(crop, (index * 480, 30))
        draw.text((index * 480 + 10, 8), f"{family} / stage {stage} / real CITY", fill="#e5dcc3")
    sheet.save(output / f"{family}.png")
print(f"{len(families)} unscaled runtime contact sheets: {output}")
