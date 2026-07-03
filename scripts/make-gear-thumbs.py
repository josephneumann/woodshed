# Build small-size thumbnails from the engraved gear portraits.
# The full plates have generous margins (correct for the lightbox) — at 42px the
# instrument goes tiny and fine linework muds out. This script:
#   1. auto-trims each plate to the drawn subject (diff vs. corner background color)
#   2. pads ~7%, re-expands to 3:4
#   3. resizes to 168x224 (3x a ~56x75 display size, retina-sharp)
#   4. dark plates get a gentle brightness/contrast lift + unsharp so ivory lines
#      survive downscaling
# Output: <name>-thumb.png alongside each <name>.png
# Usage: python scripts/make-gear-thumbs.py
import os, sys
from PIL import Image, ImageChops, ImageEnhance, ImageFilter

ROOT = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
DIRS = ['assets/guitars', 'assets/gear']
THUMB = (168, 224)  # 3:4

def bg_color(im):
    px = im.load()
    w, h = im.size
    corners = [px[3, 3], px[w-4, 3], px[3, h-4], px[w-4, h-4]]
    return tuple(sum(c[i] for c in corners) // 4 for i in range(3))

def trim_bbox(im, thresh=26):
    bg = Image.new('RGB', im.size, bg_color(im))
    diff = ImageChops.difference(im, bg).convert('L')
    mask = diff.point(lambda p: 255 if p > thresh else 0)
    box = mask.getbbox()
    return box or (0, 0, im.size[0], im.size[1])

def pad_to_aspect(box, size, pad_frac=0.07, aspect=3/4):
    l, t, r, b = box
    w, h = r - l, b - t
    pad = int(max(w, h) * pad_frac)
    l, t, r, b = l - pad, t - pad, r + pad, b + pad
    w, h = r - l, b - t
    # expand the short side to hit 3:4 (w:h)
    if w / h < aspect:
        need = int(h * aspect) - w; l -= need // 2; r += need - need // 2
    else:
        need = int(w / aspect) - h; t -= need // 2; b += need - need // 2
    # clamp inside the image, shifting rather than shrinking where possible
    W, H = size
    if l < 0: r -= l; l = 0
    if t < 0: b -= t; t = 0
    if r > W: l -= (r - W); r = W
    if b > H: t -= (b - H); b = H
    return (max(0, l), max(0, t), min(W, r), min(H, b))

def make_thumb(path):
    im = Image.open(path).convert('RGB')
    box = pad_to_aspect(trim_bbox(im), im.size)
    th = im.crop(box).resize(THUMB, Image.LANCZOS)
    if path.endswith('-dark.png'):
        th = ImageEnhance.Brightness(th).enhance(1.16)
        th = ImageEnhance.Contrast(th).enhance(1.12)
        th = th.filter(ImageFilter.UnsharpMask(radius=1.4, percent=70, threshold=2))
    else:
        th = th.filter(ImageFilter.UnsharpMask(radius=1.2, percent=50, threshold=2))
    out = path[:-4] + '-thumb.png'
    th.save(out, optimize=True)
    return out

count = 0
for d in DIRS:
    full = os.path.join(ROOT, d)
    for f in sorted(os.listdir(full)):
        if f.endswith('.png') and not f.endswith('-thumb.png'):
            out = make_thumb(os.path.join(full, f))
            count += 1
            print('thumb', os.path.relpath(out, ROOT), flush=True)
print(f'{count} thumbnails built')
