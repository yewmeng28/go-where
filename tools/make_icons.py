"""Generate the GoWhere app icons.

The mark is a location-pin outline with a dot in the middle of its head. The left edge is
the normal solid pin curve; a white question mark with a dark outline sits in front of it, its hook
running from the upper left over the top and round the right edge:
the hook is the pin's right curve, the stem drops down the middle and its dot sits at the
pin's tip. Keep it in sync with the #logo symbol in index.html.

Run from the repo root:  python3 tools/make_icons.py   (needs Pillow)
"""
import math
from PIL import Image, ImageDraw

BG = (15, 23, 32, 255)
TEAL = (46, 196, 182, 255)
WHITE = (255, 255, 255, 255)  # the question mark itself
N = 1024          # design grid
SS = 2            # supersampling factor

CX, CY, R = 512, 370, 240   # pin head
TIP = 870                   # pin tip / question-mark dot
W = 60                      # stroke width (left edge and question mark core)
OUT = 20                    # thickness of the dark outline that separates the question mark from the pin
DOT_R = 60                  # centre dot radius
HOOK_START = math.radians(-70)   # the hook starts on the upper left, over the pin's own edge
HOOK_ANGLE = math.radians(150)   # ...runs over the top and round the right before curling in
STEM_TOP, STEM_END = 690, 725


def left_edge():
    """Top of the head, counter-clockwise round the left, then straight to the tip."""
    th = math.acos(R / (TIP - CY))                   # angle of the tangent point from straight down
    tx, ty = CX - R * math.sin(th), CY + R * math.cos(th)
    # arc from the top (angle 0) to the tangent point, going left
    end = math.pi - th
    steps = 240
    pts = [(CX - R * math.sin(end * i / steps), CY - R * math.cos(end * i / steps)) for i in range(steps + 1)]
    pts += [(tx + (CX - tx) * i / 60, ty + (TIP - ty) * i / 60) for i in range(1, 61)]
    return pts


def hook():
    """Question mark: the hook runs over the head from the upper left, then curls in to the stem."""
    steps = 300
    angles = [HOOK_START + (HOOK_ANGLE - HOOK_START) * i / steps for i in range(steps + 1)]
    pts = [(CX + R * math.sin(a), CY - R * math.cos(a)) for a in angles]
    ex, ey = pts[-1]
    tdx, tdy = math.cos(HOOK_ANGLE), math.sin(HOOK_ANGLE)           # direction of travel at the end of the arc
    k = (CX - ex) / tdx
    cx_, cy_ = CX, ey + k * tdy                                      # control point: carry on, then bend straight down
    for i in range(1, 61):                                           # quadratic curve into the stem
        u = i / 60
        pts.append(((1 - u) ** 2 * ex + 2 * (1 - u) * u * cx_ + u * u * CX,
                    (1 - u) ** 2 * ey + 2 * (1 - u) * u * cy_ + u * u * STEM_TOP))
    pts += [(CX, STEM_TOP + (STEM_END - STEM_TOP) * i / 30) for i in range(1, 31)]
    return pts


def stroke(d, pts, s, color, w=W):
    r = w * s / 2
    for x, y in pts:
        d.ellipse([x * s - r, y * s - r, x * s + r, y * s + r], fill=color)


def disc(d, s, x, y, r, color):
    d.ellipse([(x - r) * s, (y - r) * s, (x + r) * s, (y + r) * s], fill=color)


def draw(size):
    s = SS * size / N
    img = Image.new('RGBA', (size * SS, size * SS), BG)
    d = ImageDraw.Draw(img)
    q = hook()
    stroke(d, left_edge(), s, TEAL)            # normal pin edge, underneath
    stroke(d, q, s, BG, W + 2 * OUT)           # question mark: dark outline, in front of the pin edge
    disc(d, s, CX, TIP, 48 + OUT, BG)
    stroke(d, q, s, WHITE)                     # question mark itself, in white
    disc(d, s, CX, TIP, 48, WHITE)             # its dot, at the pin's tip
    disc(d, s, CX, CY, DOT_R, TEAL)            # the pin's centre dot
    return img.resize((size, size), Image.LANCZOS).convert('RGB')


for name, size in (('icon-512.png', 512), ('icon-192.png', 192), ('apple-touch-icon.png', 180)):
    draw(size).save(name)
    print('wrote', name)
