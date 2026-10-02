# python3 pair.py out.jpg "title" before_tag after_tag name1 name2 ...  -> rows: [before | after]
import sys
from PIL import Image, ImageDraw, ImageFont
out, title, A, B, names = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5:]
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 20)
def load(fn):
    im = Image.open(fn).convert('RGB')
    if im.width == 1366: im = im.crop((180, 69, 1170, 768)).resize((660, 466))
    else: im = im.resize((660, int(im.height * 660 / im.width)))
    return im
rows = [(n, load(f'{A}-{n}.png'), load(f'{B}-{n}.png')) for n in names]
H = sum(r[1].height for r in rows)
o = Image.new('RGB', (1320, H + 70), (14, 14, 18)); d = ImageDraw.Draw(o)
d.text((10, 8), title, font=f, fill=(232, 176, 74))
d.text((10, 40), 'BEFORE  v9.0', font=f, fill=(220, 220, 220)); d.text((670, 40), 'AFTER  v9.1', font=f, fill=(232, 176, 74))
y = 70
for n, a, b in rows:
    o.paste(a, (0, y)); o.paste(b, (660, y))
    for x in (0, 660): d.text((x + 8, y + 6), n, font=f, fill=(255, 255, 255), stroke_width=3, stroke_fill=(0, 0, 0))
    y += a.height
o.save(out, quality=86)
