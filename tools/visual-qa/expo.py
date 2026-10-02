import sys
from PIL import Image
import numpy as np
for fn in sys.argv[1:]:
    a=np.asarray(Image.open(fn).convert('RGB')).astype(float)
    if a.shape[1]==1366: a=a[69:768,180:1170]
    a=a[:int(a.shape[0]*0.82)]  # drop the bottom touch controls
    L=0.2126*a[...,0]+0.7152*a[...,1]+0.0722*a[...,2]
    clip=(a.max(axis=2)>=250).mean()*100
    hi=(L>=235).mean()*100
    sat=(a.max(axis=2)-a.min(axis=2)).mean()
    print(f"{fn:28s} meanL={L.mean():6.1f}  p95L={np.percentile(L,95):6.1f}  L>=235:{hi:5.1f}%  clipped:{clip:5.1f}%  sat={sat:5.1f}  B-R={ (a[...,2]-a[...,0]).mean():6.1f}")
