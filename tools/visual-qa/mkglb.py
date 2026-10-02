from PIL import Image, ImageDraw, ImageFont
OUT='/home/user/Sangoku-Dorokei/docs/review-glb/'
F=lambda n: ImageFont.truetype('/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf', n)
BG=(18,18,24); FG=(235,235,240); DIM=(150,150,165)
def sheet(rows, cols, cell, title, rl, path, left=110, top=70, pad=8):
    W=left+len(cols)*(cell[0]+pad); H=top+len(rows)*(cell[1]+pad)
    o=Image.new('RGB',(W,H),BG); d=ImageDraw.Draw(o); d.text((16,14),title,font=F(26),fill=FG)
    for c,t in enumerate(cols): d.text((left+c*(cell[0]+pad)+4,top-30),t,font=F(20),fill=DIM)
    for r,row in enumerate(rows):
        d.text((14,top+r*(cell[1]+pad)+cell[1]//2-12),rl[r],font=F(22),fill=FG)
        for c,im in enumerate(row): o.paste(im.resize(cell),(left+c*(cell[0]+pad),top+r*(cell[1]+pad)))
    o.save(path,quality=88)
G='g3/'
crop=lambda p: Image.open(p).crop((675-150,640-380,675+150,640))
names=['back','front','run','sprint','turn','spin','stop','trace']
sheet([[crop(G+f'old-{n}.png') for n in names],[crop(G+f'new-{n}.png') for n in names]],
      ['背面','正面','走り','ダッシュ','急旋回(走行中)','その場で旋回','停止','TRACE'],(240,304),
      '1. 従来モデル / 新GLB（同じ地点・同じ時間・同じ操作、通常カメラから等倍で切り出し）',['従来','GLB'],OUT+'1-old-vs-glb-closeup.jpg')
# normal camera, full 3D view
v=lambda p: Image.open(p).crop((180,69,1170,768))
for n,t in [('run','走り'),('sprint','ダッシュ'),('back','待機')]:
    pass
sheet([[v(G+f'old-{n}.png') for n in ['back','run','sprint']],[v(G+f'new-{n}.png') for n in ['back','run','sprint']]],
      ['待機（背面）','走り','ダッシュ'],(594,420),'2. 通常の三人称カメラ（画面そのまま）',['従来','GLB'],OUT+'2-normal-camera.jpg')
sheet([[v(G+f'old-{n}.png') for n in ['shibuya-day','shibuya-night']],[v(G+f'new-{n}.png') for n in ['shibuya-day','shibuya-night']]],
      ['渋谷の道路をダッシュ（昼）','同じ場所（夜）'],(792,560),'3. 渋谷の道路・夜間の走行',['従来','GLB'],OUT+'3-shibuya-day-night.jpg')
sheet([[v(G+f'old-run-side.png'), v(G+f'new-run-side.png')]],['従来','GLB'],(792,560),'4. 走行中を横から（足の接地・身体の浮き）',[''],OUT+'4-run-side.jpg',left=20)
clips=['Idle','Walk','Sprint','Turn','Trace']
sheet([[crop(G+f'clip-{c}.png') for c in clips]],clips,(240,304),'5. 実プレイ中に再生されたクリップ（Run は 1〜4 の画像）',[''],OUT+'5-clips-live.jpg',left=20)
