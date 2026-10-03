from PIL import Image, ImageDraw, ImageFont
OUT='/home/user/Sangoku-Dorokei/docs/review-meshy/'
F=lambda n: ImageFont.truetype('/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf', n)
BG=(18,18,24); FG=(235,235,240); DIM=(150,150,165)
def sheet(rows, cols, cell, title, rl, path, left=120, top=70, pad=8):
    W=left+len(cols)*(cell[0]+pad); H=top+len(rows)*(cell[1]+pad)
    o=Image.new('RGB',(W,H),BG); d=ImageDraw.Draw(o); d.text((16,14),title,font=F(26),fill=FG)
    for c,t in enumerate(cols): d.text((left+c*(cell[0]+pad)+4,top-30),t,font=F(20),fill=DIM)
    for r,row in enumerate(rows):
        d.multiline_text((12,top+r*(cell[1]+pad)+cell[1]//2-20),rl[r],font=F(21),fill=FG)
        for c,im in enumerate(row): o.paste(im.resize(cell),(left+c*(cell[0]+pad),top+r*(cell[1]+pad)))
    o.save(path,quality=88)
crop=lambda p: Image.open(p).convert('RGB').crop((675-150,640-380,675+150,640))
v=lambda p: Image.open(p).convert('RGB').crop((180,69,1170,768))
names=['back','front','run','sprint','turn','spin','stop']
old=[crop(f'g3/old-{n}.png') for n in names]+[crop('g3/old-trace.png')]
new=[crop(f'm3/meshy-{n}.png') for n in names]+[Image.open('m3/k-Trace-1-3.1.png').convert('RGB').resize((300,380))]
sheet([old,new],['背面(待機)','正面','RUN','SPRINT','急旋回(走行中)','その場で旋回','停止','TRACE'],(240,304),
      '1. 通常カメラ：従来 / Meshy 60k（同じ地点・時間・操作。等倍で切り出し。TRACE の Meshy は正面寄りの静止ポーズ）',['従来','Meshy\n60k'],OUT+'1-normal-camera-closeup.jpg')
sheet([[v(f'g3/old-{n}.png') for n in ['shibuya-day','shibuya-night']],[v(f'm3/meshy-{n}.png') for n in ['shibuya-day','shibuya-night']]],
      ['渋谷の道路をダッシュ（昼・後方カメラ）','同じ場所（夜）'],(792,560),'2. 昼・夜の後方カメラ（画面そのまま）',['従来','Meshy\n60k'],OUT+'2-back-camera-day-night.jpg')
def k(clip,n,angles,title,path,labels):
    rows=[[Image.open(f'm3/k-{clip}-{i}-{a:.1f}.png').convert('RGB') for i in range(n)] for a in angles]
    sheet(rows,[f'位相 {i}/{n}' for i in range(n)],(345,450),title,labels,path)
k('Sprint',4,[0,1.5708,3.1416],'3. 関節チェック SPRINT（ゲーム内で姿勢を止めて2倍解像度で撮影）',OUT+'3-joints-sprint.jpg',['後ろ','横','前'])
k('Run',4,[0,1.5708,3.1416],'4. 関節チェック RUN',OUT+'4-joints-run.jpg',['後ろ','横','前'])
k('Trace',3,[3.1416,1.5708,0],'5. 関節チェック TRACE',OUT+'5-joints-trace.jpg',['前','横','後ろ'])
