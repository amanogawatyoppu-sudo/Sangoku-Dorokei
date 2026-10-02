# python3 sheet.py out.jpg cols "title" file1 file2 ...  (crops the 3D view: drops the side panels)
import sys
from PIL import Image, ImageDraw, ImageFont
out, cols, title, files = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4:]
f = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 20)
W, H = 660, 466
rows = (len(files) + cols - 1) // cols
o = Image.new('RGB', (W * cols, H * rows + 40), (14, 14, 18)); d = ImageDraw.Draw(o)
d.text((10, 8), title, font=f, fill=(232, 176, 74))
for i, fn in enumerate(files):
    im = Image.open(fn).convert('RGB')
    if im.width == 1366: im = im.crop((180, 69, 1170, 768))
    im = im.resize((W, H))
    o.paste(im, ((i % cols) * W, 40 + (i // cols) * H))
    d.text(((i % cols) * W + 8, 40 + (i // cols) * H + 6), fn.split('/')[-1].replace('.png', ''), font=f, fill=(255, 255, 255), stroke_width=3, stroke_fill=(0, 0, 0))
o.save(out, quality=85)
