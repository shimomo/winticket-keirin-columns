import struct, zlib, sys

BG = (0x2F, 0x4B, 0x8A)
WHITE = (0xFF, 0xFF, 0xFF)
AMBER = (0xF5, 0xB7, 0x3B)

def rrect(x, y, x0, y0, x1, y1, r):
    if not (x0 <= x <= x1 and y0 <= y <= y1):
        return False
    cx = min(max(x, x0 + r), x1 - r)
    cy = min(max(y, y0 + r), y1 - r)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r

def tri(x, y, a, b, c):
    def s(p, q, r):
        return (p[0] - r[0]) * (q[1] - r[1]) - (q[0] - r[0]) * (p[1] - r[1])
    p = (x, y)
    d1, d2, d3 = s(p, a, b), s(p, b, c), s(p, c, a)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)

def shapes(x, y):
    """単位座標 (0..1) の点に対する色を返す。上のものほど手前"""
    if not rrect(x, y, 0, 0, 1, 1, 0.22):
        return None
    # 左右の入れ替えを示す両矢印
    if 0.28 <= x <= 0.72 and 0.165 <= y <= 0.215:
        return WHITE
    if tri(x, y, (0.16, 0.19), (0.30, 0.10), (0.30, 0.28)):
        return WHITE
    if tri(x, y, (0.84, 0.19), (0.70, 0.10), (0.70, 0.28)):
        return WHITE
    # 3本の列。真ん中だけ強調 (入れ替わる列のイメージ)
    for x0, color in ((0.17, WHITE), (0.42, AMBER), (0.67, WHITE)):
        if rrect(x, y, x0, 0.38, x0 + 0.16, 0.86, 0.04):
            return color
    return BG

def render(size, ss=4):
    rows = []
    for py in range(size):
        row = bytearray([0])
        for px in range(size):
            r = g = b = a = 0
            for sy in range(ss):
                for sx in range(ss):
                    c = shapes((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size)
                    if c:
                        r += c[0]; g += c[1]; b += c[2]; a += 255
            n = ss * ss
            if a:
                cov = a / n
                row += bytes((round(r / (a / 255)), round(g / (a / 255)), round(b / (a / 255)), round(cov)))
            else:
                row += bytes((0, 0, 0, 0))
        rows.append(bytes(row))
    raw = b''.join(rows)
    def chunk(t, d):
        c = struct.pack('>I', len(d)) + t + d
        return c + struct.pack('>I', zlib.crc32(t + d) & 0xFFFFFFFF)
    return (b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', size, size, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9)) + chunk(b'IEND', b''))

out = sys.argv[1]
for size in (16, 48, 128):
    open(f'{out}/icon{size}.png', 'wb').write(render(size))
