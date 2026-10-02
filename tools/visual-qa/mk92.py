from PIL import Image, ImageDraw, ImageFont
OUT='/home/user/Sangoku-Dorokei/docs/review-v9.2/'
F=lambda n: ImageFont.truetype('/usr/share/fonts/opentype/ipafont-gothic/ipag.ttf', n)
BG=(18,18,24); FG=(235,235,240); DIM=(150,150,165)
def label(d,xy,t,n=22,c=FG): d.text(xy,t,font=F(n),fill=c)
def sheet(rows, cols_titles, cell, title, rowlabels, path, pad=8, top=70, left=150):
    W=left+len(cols_titles)*(cell[0]+pad); H=top+len(rows)*(cell[1]+pad)+10
    o=Image.new('RGB',(W,H),BG); d=ImageDraw.Draw(o)
    label(d,(16,14),title,26)
    for c,t in enumerate(cols_titles): label(d,(left+c*(cell[0]+pad)+6,top-30),t,20,DIM)
    for r,row in enumerate(rows):
        label(d,(14,top+r*(cell[1]+pad)+cell[1]//2-12),rowlabels[r],22)
        for c,im in enumerate(row): o.paste(im.resize(cell),(left+c*(cell[0]+pad),top+r*(cell[1]+pad)))
    o.save(path,quality=86)
A='a2/'
# 1. character turnaround: old vs new (front, side, back) + face
def thirds(p):
    im=Image.open(p); w=im.size[0]
    return [im.crop((x-170,60,x+170,620)) for x in (348,600,852)]
o1=thirds(A+'c1-0.png'); n1=thirds(A+'c3-0.png')
face=Image.open(A+'c3-1.png').crop((250,0,950,700))
sheet([o1,n1],['正面 FRONT','側面 SIDE','背面 BACK'],(300,494),'1. キャラクター比較（同じ id・SOL RUNNER）　上: v9.1　下: v9.2 試作 SOL RUNNER',['v9.1','v9.2'],OUT+'1-character-turnaround.jpg')
face.resize((560,560)).save(OUT+'1b-character-face.jpg',quality=88)
# 2. motion in the real game: idle / run / sprint / sharp turn / stop
names=['idle','run','sprint','turn','stop']
crop=lambda p: Image.open(p).crop((675-140,560-330,675+140,600))
sheet([[crop(A+f'g91-{n}.png') for n in names],[crop(A+f'g92-{n}.png') for n in names]],['待機 IDLE','走り RUN','ダッシュ SPRINT','急旋回 TURN','停止 STOP'],(280,370),'2. 実ゲーム中の動き（同じ操作・同じ地点、プレイヤー付近を等倍で切り出し）',['v9.1','v9.2'],OUT+'2-motion-ingame.jpg')
# 3. normal game camera (full screen)
for src,dst in [('g92-run.png','3a-game-camera-run.jpg'),('new-B-day.png','3b-game-camera-shibuya.jpg'),('g91-run.png','3c-game-camera-v91-run.jpg')]:
    Image.open(A+src).convert('RGB').save(OUT+dst,quality=86)
# 4. Shibuya before/after, same spot and angle
v=lambda p: Image.open(p).crop((180,69,1170,768))
spots=['A','B','C','D']
sheet([[v(A+f'old-{s}-day.png') for s in spots],[v(A+f'same-{s}-day.png') for s in spots],[v(A+f'new-{s}-day.png') for s in spots]],
      ['A 大通りから交差点','B 西の通りから交差点','C 東の歩道（店先）','D 西向き（高架の壁）'],(495,350),'4. 渋谷 NEON MAZE ブロック（昼・同じ地点と向き）',['v9.1','v9.2\n同じカメラ','v9.2\n新カメラ'],OUT+'4-shibuya-before-after.jpg',left=170)
# 5. improved block day / sunset / night
sheet([[v(A+f'new-{s}-{t}.png') for t in ['day','sunset','night']] for s in spots],['昼','夕方','夜'],(495,350),'5. v9.2 渋谷ブロック 昼／夕方／夜（新カメラ）',spots,OUT+'5-shibuya-day-sunset-night.jpg',left=60)
sheet([[v(A+f'old-{s}-{t}.png') for t in ['day','sunset','night']] for s in spots],['昼','夕方','夜'],(495,350),'5（参考）v9.1 の同じ地点 昼／夕方／夜',spots,OUT+'5b-shibuya-v91-day-sunset-night.jpg',left=60)
# 6. faction colours vs city light
sheet([[v(A+f'fac91-{s}-{t}.png') for s,t in [('B','night'),('B','sunset'),('C','night')]],[v(A+f'fac92-{s}-{t}.png') for s,t in [('B','night'),('B','sunset'),('C','night')]]],
      ['B 夜','B 夕方','C 夜（店先）'],(495,350),'6. SOL(橙)・LUNA(青)・STAR(黄) と看板・街灯の色（左から STAR / LUNA / SOL の順に並べた）',['v9.1','v9.2\n全員v2'],OUT+'6-faction-colours.jpg',left=150)
# viewports
o=Image.new('RGB',(1640,1150),BG); d=ImageDraw.Draw(o); label(d,(16,14),'画面サイズ確認（v9.2 ?art=v2、渋谷ブロック B 夕方、本番ビルド）',24)
o.paste(Image.open(A+'vp-1920x1080-B-sunset.png').resize((960,540)),(10,50)); label(d,(14,594),'1920×1080',20,DIM)
o.paste(Image.open(A+'vp-1366x768-B-sunset.png').resize((960,540)),(10,620)); label(d,(980,1120),'',20)
label(d,(14,1124),'1366×768',20,DIM)
o.paste(Image.open(A+'vp-390x844-B-sunset.png').resize((262,566)),(990,50)); label(d,(990,620),'390×844',20,DIM)
o.paste(Image.open(A+'vp-844x390-B-sunset.png').resize((620,286)),(990,660)); label(d,(990,952),'844×390',20,DIM)
o.convert('RGB').save(OUT+'7-viewports.jpg',quality=86)
