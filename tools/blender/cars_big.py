"""
The big ones: the Jackpot Limo (a stretched American luxury saloon with a chrome grille and
an extra door and windows in the stretch).
"""
import math

from mathutils import Matrix, Vector

from carkit import C, Mesh, const, rbox, cyl, tube, rrect_pts, circle_pts, ccw, _fnormal
from carbody import aim, patch, strip, Projector, FRAMES
import carparts as P
from carcommon import Out, car, closed_car, lamp, flat, line, gaps, handle, plate, rounded, arch_pts, along, arches, wheels_into, cabin_meta


# ------------------------------------------------------------------ the limo

def limo_params():
    L, W = 7.6, 1.96
    x0, x1 = -L / 2, L / 2
    xf, xr = 2.82, -2.47
    R = 0.36
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.235, track=1.63, arch_gap=0.055, rim='multi', spokes=7, color=0xf4f4f6,
        bottom=C((x0, 0.37), (x0 + 0.12, 0.3), (x0 + 0.5, 0.245), (xr - 0.4, 0.19), (xr, 0.18), (xf, 0.18), (xf + 0.5, 0.21), (x1 - 0.12, 0.27), (x1, 0.33)),
        shoulder=C((x0, 0.86), (x0 + 0.05, 0.93), (x0 + 0.25, 0.97), (-2.6, 0.98), (0.0, 0.972), (1.9, 0.95), (2.7, 0.928), (x1 - 0.25, 0.9), (x1 - 0.05, 0.875), (x1, 0.84)),
        top=C((x0, 0.88), (x0 + 0.05, 0.955), (x0 + 0.25, 0.995), (-2.7, 1.005), (1.9, 0.99), (2.7, 0.958), (x1 - 0.25, 0.928), (x1 - 0.05, 0.9), (x1, 0.86)),
        width=C((x0, 0.955), (-2.6, 0.975), (2.6, 0.98), (x1, 0.965)),
        tuck=const(0.07), tumble=const(0.05), cfrac=C((x0, 0.74), (0.0, 0.72), (x1, 0.74)),
        rb=const(0.06), rs=C((x0, 0.03), (x0 + 0.3, 0.04), (x1 - 0.3, 0.04), (x1, 0.03)),
        front=(0.24, 3.4), rear=(0.24, 3.4),
        flares=[(xf, 0.55, 0.006, 0.6, 0.25), (xr, 0.55, 0.008, 0.62, 0.25)],
        open=[(-2.36, 1.96, 0.27)],
        bl_base=-2.74, ws_base=2.0, inset=0.035,
        roof_z=C((-2.74, 1.0), (-2.56, 1.2), (-2.36, 1.37), (-2.16, 1.44), (-1.8, 1.462), (0.6, 1.468), (1.15, 1.455), (1.42, 1.38), (1.72, 1.18), (2.0, 0.975)),
        rail_z=C((-2.74, 0.99), (-2.56, 1.17), (-2.36, 1.33), (-2.16, 1.393), (-1.8, 1.413), (0.6, 1.418), (1.15, 1.405), (1.42, 1.33), (1.72, 1.14), (2.0, 0.96)),
        rail_w=C((-2.74, 0.8), (-2.2, 0.775), (0.0, 0.768), (1.3, 0.778), (2.0, 0.84)),
        corner=C((-2.3, 0.065), (1.2, 0.06), (1.7, 0.045)),
        lines=[(-2.62, -2.2), (-1.98, -1.88), (-1.29, -1.29), (-1.19, -1.19), (-0.27, -0.27), (-0.17, -0.17),
               (0.82, 0.82), (0.92, 0.92), (1.62, 1.17)],
        driver_y=0.39, hip_f=(0.8, 0.53), seats=8,
        dash=(1.96, 1.5, 0.78, 0.6, 0.95), wheel_c=(1.27, 0.87),
        mirror=(1.8, 0.905, 0.985),
        benches=[(-1.78, 1.36, 0.53)],
    )

    def glass_region(i):
        seg, xb, xr_ = i['seg'], i['xb'], i['xr']
        if seg == 'side':
            if i['zone'] == 'front' or xb > 1.7:
                return 'black'
            # Black pillars between the windows, body colour behind the rear door.
            for (a, b) in ((0.82, 0.92), (-0.27, -0.17), (-1.29, -1.19)):
                if a < xb < b:
                    return 'gloss'
            if xb < -1.98:
                return 'paint'
            return 'glass'
        if seg == 'corner':
            return 'paint'
        if xr_ > 1.17 or xr_ < -2.2:
            return 'glass'
        return 'paint'

    p['glass_region'] = glass_region
    p['decor'] = limo_decor
    # Rear compartment: a forward-facing bench at the back, a side bench along the right.
    p['more_seats'] = [(-0.3, -0.6, 0.53), (-0.9, -0.6, 0.53), (-1.78, 0.0, 0.53), (0.2, 0.3, 0.53)]
    return p


def limo_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    # The chrome grille: an upright frame full of vertical bars, standing proud of the nose.
    gr = rounded(rrect_pts((0.0, 0.69), 0.78, 0.29, 0.03, 2), 1)
    flat(o, pr, 'front', gr, 'grille', 0.012, bezel=(0.03, 'chrome', 0.016), res=res, rings=1)
    if res:
        n = 15
        for k in range(n):
            s = -0.36 + 0.72 * k / (n - 1)
            line(o, pr, 'front', [(s, 0.56), (s, 0.82)], 0.014, 'chrome', 0.02)
        line(o, pr, 'front', [(-0.37, 0.69), (0.37, 0.69)], 0.012, 'chrome', 0.02)
    # Headlamps: wide rectangles either side, wrapping onto the wings, an amber corner lamp outboard.
    hf = aim((x1 - 0.05, 0.62, 0.72), 0.22, 0.04)
    head = rounded([(-0.21, -0.07), (0.17, -0.07), (0.25, -0.05), (0.26, 0.06), (0.17, 0.075), (-0.21, 0.075)], 1)
    lamp(o, pr, hf, head, 'head', res, 'chrome', 0.008, 0.008, bw=0.014)
    if res:
        for s in (-0.11, 0.03):
            lamp(o, pr, hf, circle_pts((s, 0.0), 0.045, 12), 'chrome', res, 'gloss', 0.006, 0.02, bw=0.008, rings=2)
        line(o, pr, hf, [(-0.2, -0.055), (0.24, -0.04)], 0.01, 'white', 0.02, both=True)
    cf = aim((x1 - 0.2, 0.9, 0.72), 0.95, 0.0)
    lamp(o, pr, cf, rounded(rrect_pts((0.0, 0.0), 0.16, 0.12, 0.02, 1), 1), 'amber', res, 'chrome', 0.004, 0.008, bw=0.008)
    # A chrome strip across the bumper, the plate, the lower intake with round fog lamps.
    line(o, pr, 'front', [(-0.86, 0.5), (0.86, 0.5)], 0.03, 'chrome', 0.008)
    plate(o, pr, 'front', (0.0, 0.42))
    low = rounded([(-0.62, 0.36), (0.62, 0.36), (0.66, 0.29), (-0.66, 0.29)], 1)
    flat(o, pr, 'front', low, 'grille', 0.004, bezel=(0.01, 'gloss', 0.003), res=res, rings=1)
    for s in (1, -1):
        lamp(o, pr, 'front', circle_pts((s * 0.72, 0.36), 0.05, 12), 'head', res, 'chrome', 0.006, 0.008, bw=0.01, both=False)
    line(o, pr, 'front', [(-0.8, 0.28), (0.8, 0.28)], 0.025, 'black', 0.003)

    # Tail lamps: tall red blocks wrapping round the corners, a chrome panel across the boot lid.
    tf = aim((x0 + 0.1, 0.76, 0.78), math.pi - 0.5, 0.0)
    tail = rounded(rrect_pts((0.0, 0.0), 0.3, 0.2, 0.025, 2), 1)
    lamp(o, pr, tf, tail, 'tail', res, 'chrome', 0.006, 0.008, bw=0.012)
    if res:
        lamp(o, pr, tf, rrect_pts((0.07, -0.05), 0.1, 0.05, 0.01, 1), 'white', res, None, 0.002, 0.016)
        for t in (-0.02, 0.04):
            line(o, pr, tf, [(-0.13, t), (0.13, t)], 0.006, 'red', 0.016, both=True)
    panel = rrect_pts((0.0, 0.83), 1.0, 0.085, 0.02, 2)
    flat(o, pr, 'rear', panel, 'chrome', 0.006, res=res)
    if res:
        line(o, pr, 'rear', [(-0.46, 0.83), (0.46, 0.83)], 0.03, 'red', 0.009)
    plate(o, pr, 'rear', (0.0, 0.66))
    line(o, pr, 'rear', [(-0.9, 0.5), (0.9, 0.5)], 0.03, 'chrome', 0.008)
    line(o, pr, 'rear', [(-0.86, 0.38), (0.86, 0.38)], 0.08, 'black', 0.003)
    if res:
        for s in (1, -1):
            o.body.extend(cyl((x0 + 0.08, s * 0.55, 0.3), (x0 - 0.04, s * 0.55, 0.3), 0.035, 'chrome', 10))
            o.body.extend(cyl((x0 - 0.035, s * 0.55, 0.3), (x0 - 0.04, s * 0.55, 0.3), 0.026, 'gap', 10))

    if res:
        # Doors: the front one, one in the stretch, the rear one round the arch; sills; bonnet, boot.
        rear_arch = arch_pts(xr, R, R + 0.1, 62, 6, 6)
        gaps(o, pr, [
            [(1.78, 0.97), (1.8, 0.75), (1.77, 0.5), (1.74, 0.33)],
            [(0.87, 0.98), (0.87, 0.33)],
            [(0.78, 0.98), (0.78, 0.33)],
            [(-0.22, 0.98), (-0.22, 0.33)],
            [(-1.24, 0.98), (-1.24, 0.33)],
            [(-2.0, 0.99), (-2.0, 0.76)] + rear_arch + [(xr + R + 0.1, 0.33)],
            [(1.74, 0.33), (xr + R + 0.1, 0.33)],
        ])
        gaps(o, pr, [[(2.0, 0.78), (2.6, 0.77), (3.3, 0.72), (3.62, 0.6)]], frame='top')
        gaps(o, pr, [[(-2.76, 0.72), (-3.6, 0.7)]], frame='top')
        gaps(o, pr, [[(-0.72, 0.95), (-0.72, 0.6), (0.72, 0.6), (0.72, 0.95)]], frame='rear', both=False)
        line(o, pr, 'side', rounded(rrect_pts((-2.95, 0.85), 0.17, 0.12, 0.03, 2), 1), 0.006, 'gap', 0.0015, closed=True)
        for x in (1.0, -0.05, -1.4):
            handle(o, pr, x, 0.88, 'chrome')
        # Chrome along the bottom and the top of the side glass, round the windows.
        line(o, prg, 'side', along(p['shoulder'], 1.7, -1.98, 24, -0.004), 0.018, 'chrome', 0.004, both=True)
        line(o, prg, 'side', along(p['rail_z'], 1.6, -1.88, 24, -0.012), 0.014, 'chrome', 0.006, both=True)
        # A chrome rocker strip and a body-side moulding.
        line(o, pr, 'side', [(xf - R - 0.12, 0.27), (xr + R + 0.12, 0.27)], 0.05, 'chrome', 0.004, both=True)
        line(o, pr, 'side', [(xf - R - 0.1, 0.6), (xr + R + 0.1, 0.6)], 0.035, 'black', 0.005, both=True)
        line(o, pr, 'side', [(xf - R - 0.1, 0.6), (xr + R + 0.1, 0.6)], 0.008, 'chrome', 0.008, both=True)
        for xx in (x1 - 0.55, x0 + 0.6):
            line(o, pr, 'side', [(xx + 0.25, 0.6), (xx - 0.25, 0.6)], 0.03, 'black', 0.005, both=True)

    # Black cowl, wipers.
    cx = p['ws_base'] - 0.035
    line(o, pr, 'top', [(cx, -0.78), (cx, 0.78)], 0.08, 'black', 0.003)
    if res:
        for (a, b) in ((0.56, -0.06), (-0.02, -0.62)):
            o.body.extend(tube([Vector((cx - 0.03, a, p['roof_z'](cx - 0.03) + 0.01)), Vector((cx - 0.08, b, p['roof_z'](cx - 0.08) + 0.012))], 0.007, 'black', 4))
        o.body.extend(rbox((-1.9, 0, p['roof_z'](-1.9) + 0.012), (0.075, 0.022, 0.028), 0.018, 'paint', 1))
        limo_cabin(o, p)


def limo_cabin(o, p):
    """The rear compartment: a partition behind the driver, a side bench, a bar, the roof console."""
    fl = 0.27
    # The partition: a low wall with a glass screen above it.
    o.body.extend(rbox((0.5, 0, 0.62), (0.04, 0.76, 0.33), 0.02, 'interior', 1))
    o.body.extend(rbox((0.5, 0, 1.12), (0.012, 0.72, 0.18), 0.01, 'glass', 1))
    # A bench along the right-hand side, facing across the car.
    sb = P.seat(0.0, 0.0, 0.0, 1.5, 0.48, 0.5, 0.25, 'seat', res=0, head=False, bolster=False)
    sb.transform(Matrix.Translation((-0.6, -0.56, 0.44)) @ Matrix.Rotation(math.pi / 2, 4, 'Z'))
    o.body.extend(sb)
    # The bar along the left with a lit strip and some glasses on it.
    o.body.extend(rbox((-0.55, 0.66, 0.5), (0.65, 0.13, 0.23), 0.02, 'gloss', 1))
    o.body.extend(rbox((-0.55, 0.66, 0.735), (0.66, 0.14, 0.012), 0.006, 'chrome', 1))
    o.body.extend(rbox((-0.55, 0.535, 0.58), (0.6, 0.004, 0.01), 0.002, 'sign', 1))
    for k in range(4):
        x = -0.95 + 0.25 * k
        o.body.extend(cyl((x, 0.66, 0.747), (x, 0.66, 0.82), 0.025, 'glass', 8, r1=0.032))
    # Floor, and the roof console with a light strip.
    o.body.extend(rbox((-0.6, 0, fl + 0.01), (1.75, 0.8, 0.01), 0.005, 'interior', 1))
    o.body.extend(rbox((-0.6, 0, 1.40), (1.2, 0.18, 0.02), 0.01, 'interior', 1))
    o.body.extend(rbox((-0.6, 0, 1.378), (1.1, 0.012, 0.004), 0.002, 'sign', 1))


@car
def limo(res):
    return closed_car(res, limo_params())


# ------------------------------------------------------------------ one-box vans

def _zone(rho, sigma, e, fracs, nc):
    """A nose or tail in plan, normalised: (u across, s back from the tip) from the centre to the side."""
    pts = [((1 - rho) * f, sigma * f ** e) for f in fracs]
    slope = e * sigma / (1 - rho)
    p0, cp, p2 = Vector((1 - rho, sigma)), Vector((1.0, min(0.97, sigma + slope * rho))), Vector((1.0, 1.0))
    for j in range(1, nc + 1):
        t = j / nc
        q = p0 * (1 - t) ** 2 + cp * 2 * t * (1 - t) + p2 * t * t
        pts.append((q.x, q.y))
    return pts


class VanBody:
    """
    A one-box body lofted upwards through horizontal slices, each a plan outline: the nose and
    the tail shaped per height (a bowed panel, a V or a wrapped windscreen, the roof's edge),
    straight sides between S1 and S0 with points at fixed x stations (window and door edges)
    so the paint, the glass and the pillars can follow them exactly. The first and the last
    slices are a line down the middle, closing the floor pan and the crowned roof.
    slices: dicts z, hw (half width), xf / xr (nose and tail tips), fs / rs ((rho, sigma, e)).
    """

    def __init__(self, S0, S1, stations, slices, region, ffr, nfc, rfr, nrc):
        self.S0, self.S1 = S0, S1
        self.st = sorted((x for x in stations if S0 < x < S1), reverse=True)
        self.sl = slices
        self.region = region
        self.ffr, self.nfc, self.rfr, self.nrc = ffr, nfc, rfr, nrc

    def half(self, s):
        """Points (x, y) from the nose tip round the left side to the tail tip, and zone labels."""
        hw = s['hw']
        df, dr = s['xf'] - self.S1, self.S0 - s['xr']
        out, lab = [], []
        for (u, q) in _zone(*s['fs'], self.ffr, self.nfc):
            out.append((self.S1 + df * (1 - q), u * hw))
            lab.append('front')
        for x in self.st:
            out.append((x, hw))
            lab.append('side')
        for (u, q) in reversed(_zone(*s['rs'], self.rfr, self.nrc)):
            out.append((self.S0 - dr * (1 - q), u * hw))
            lab.append('rear')
        return out, lab

    def build(self, floor=None, shell=0.025):
        outer = Mesh()
        rings, labs = [], []
        for s in self.sl:
            h, lab = self.half(s)
            n = len(h)
            ids = [outer.vert((x, y, s['z'])) for (x, y) in h]
            if s['hw'] > 1e-6:
                ids += [outer.vert((h[k][0], -h[k][1], s['z'])) for k in range(n - 2, 0, -1)]
            else:
                ids += [ids[k] for k in range(n - 2, 0, -1)]
            rings.append(ids)
            labs = lab
        n = len(labs)
        nF = labs.count('front')
        nS = labs.count('side')
        N = len(rings[0])
        faces = []
        for i in range(len(rings) - 1):
            for j in range(N):
                j2 = (j + 1) % N
                a = j if j < n else 2 * n - 2 - j
                b = j2 if j2 < n else 2 * n - 2 - j2
                lo_, hi_ = min(a, b), max(a, b)
                if hi_ <= nF - 1:
                    zone, k = 'front', lo_
                elif lo_ >= nF + nS:
                    zone, k = 'rear', n - 1 - hi_
                else:
                    zone, k = 'side', lo_ - (nF - 1)
                q = (rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j])
                if len(set(q)) < 3:
                    continue
                c = sum((outer.v[t] for t in q), Vector()) / 4
                info = {'zone': zone, 'k': k, 'i': i, 'z0': self.sl[i]['z'], 'z1': self.sl[i + 1]['z'], 'z': c.z,
                        'x': c.x, 'y': c.y, 'xa': max(outer.v[q[0]].x, outer.v[q[1]].x), 'xb': min(outer.v[q[0]].x, outer.v[q[1]].x)}
                reg = self.region(info)
                ref = Vector((max(self.S0, min(self.S1, c.x)), 0, 1.0))
                if _fnormal(outer, q).dot(c - ref) < 0:
                    q = tuple(reversed(q))
                outer.face(q, reg)
                faces.append((q, reg, info))
        inner = Mesh()
        if floor is not None:
            vn = [Vector() for _ in outer.v]
            for (q, reg, info) in faces:
                nn = _fnormal(outer, q)
                for t in q:
                    vn[t] += nn
            remap = {}
            for (q, reg, info) in faces:
                if reg == 'glass' or info['z0'] < floor:
                    continue
                ids = []
                for t in q:
                    if t not in remap:
                        d = vn[t].normalized() if vn[t].length > 0 else Vector()
                        remap[t] = inner.vert(outer.v[t] - d * shell)
                    ids.append(remap[t])
                inner.face(tuple(reversed(ids)), 'interior')
        return outer, inner


def aim_at(pr, frame, s, t):
    """A decal frame on the surface where the frame's ray at (s, t) lands, facing out along its normal."""
    O, U, V, D = FRAMES[frame]
    loc, nor = pr.hit(O + U * s + V * t, D)
    if nor.dot(D) > 0:
        nor = -nor
    return aim(loc, math.atan2(nor.y, nor.x), math.asin(max(-1.0, min(1.0, nor.z))))


def roof_rows(base, r, rf, rr, crown, n):
    """Slices round the roof's edge (radius r at the sides, rf / rr at the nose and tail) and over its crown."""
    out = []
    for k in range(1, n + 1):
        a = math.pi / 2 * k / n
        c = 1 - math.cos(a)
        out.append(dict(base, z=base['z'] + r * math.sin(a), hw=base['hw'] - r * c, xf=base['xf'] - rf * c, xr=base['xr'] + rr * c, edge=k))
    top = out[-1]
    out.append(dict(top, z=top['z'] + crown * 0.75, hw=top['hw'] * 0.55, xf=top['xf'] - 0.01, xr=top['xr'] + 0.01, edge=n + 1))
    out.append(dict(top, z=top['z'] + crown, hw=0.0, xf=top['xf'] - 0.03, xr=top['xr'] + 0.03, edge=n + 2))
    return out


def wrap_bumper(x, z, half_w, h, depth, region, sign=1, res=1, back=0.14):
    """A bumper bar across the car at x (sign +1 at the front), its ends angled back round the corners."""
    m = Mesh()
    r = min(h, depth) * 0.45
    seg = 2 if res else 1
    core = half_w - 0.14
    m.extend(rbox((x, 0, z), (depth / 2, core + 0.02, h / 2), r, region, seg))
    ang = math.atan2(back, 0.16)
    for s in (1, -1):
        M = Matrix.Translation((x - sign * back / 2, s * (core + 0.075), z)) @ Matrix.Rotation(sign * s * ang, 4, 'Z')
        m.extend(rbox((0, 0, 0), (depth / 2, 0.1, h / 2), r, region, seg, M))
    return m


def round_mirror(base, tip, r=0.065, res=1):
    """A small round mirror on a thin stalk (the 1960s kind), stalk from `base` to `tip` on the left."""
    m = Mesh()
    mid = Vector(((base[0] + tip[0]) / 2, (base[1] + tip[1]) / 2 + 0.03, (base[2] + tip[2]) / 2 + 0.03))
    m.extend(tube([Vector(base), mid, Vector(tip)], 0.009, 'chrome', 6 if res else 4))
    c = Vector(tip)
    m.extend(cyl(c + Vector((0.012, 0, 0)), c - Vector((0.012, 0, 0)), r, 'chrome', 16 if res else 8))
    m.extend(cyl(c - Vector((0.011, 0, 0)), c - Vector((0.014, 0, 0)), r * 0.86, 'mirror', 16 if res else 8))
    return m


def van_interior(o, p):
    """Cab floor, a flat dash with a big round dial, a nearly flat bus steering wheel, seats and benches."""
    dy = p['driver_y']
    hx, hz = p['hip']
    # The floor: full width between the wheels, narrower over them with a tub over each arch.
    xa, xb = p['floor_x']
    fl, yi, ra = p['floor'], p['track'] / 2 - p['tyre_w'] / 2 - 0.06, p['R'] + p['arch_gap'] + 0.02
    o.body.extend(rbox(((xa + xb) / 2, 0, fl), ((xa - xb) / 2, yi, 0.012), 0.0, 'interior', 1))
    cuts = sorted([(p['xf'] + ra, p['xf'] - ra), (p['xr'] + ra, p['xr'] - ra)], reverse=True)
    edges = [xa] + [v for c in cuts for v in c] + [xb]
    for k in range(0, len(edges), 2):
        a, b = edges[k], edges[k + 1]
        if a - b > 0.02:
            for s in (1, -1):
                o.body.extend(rbox(((a + b) / 2, s * (yi + p['hw_in']) / 2, fl), ((a - b) / 2, (p['hw_in'] - yi) / 2, 0.012), 0.0, 'interior', 1))
    for (a, b) in cuts:
        top = p['R'] + ra + 0.01
        for s in (1, -1):
            o.body.extend(rbox(((a + b) / 2, s * (yi + p['hw_in']) / 2, top), ((a - b) / 2, (p['hw_in'] - yi) / 2, 0.012), 0.0, 'interior', 1))
            o.body.extend(rbox(((a + b) / 2, s * yi, (fl + top) / 2), ((a - b) / 2, 0.01, (top - fl) / 2), 0.0, 'interior', 1))
    dx, dz = p['dash']
    o.body.extend(rbox((dx, 0, dz), (0.07, p['hw_in'] - 0.03, 0.06), 0.03, p.get('dash_region', 'paint'), 2))
    o.body.extend(cyl((dx - 0.06, dy, dz + 0.01), (dx - 0.08, dy, dz + 0.01), 0.075, 'chrome', 16))
    o.body.extend(cyl((dx - 0.078, dy, dz + 0.01), (dx - 0.083, dy, dz + 0.01), 0.064, 'gloss', 16))
    o.body.extend(P.steering_wheel(p['wheel_c'], p['wheel_tilt'], p['wheel_r'], region='black'))
    o.body.extend(P.seat(hx + 0.04, dy, hz - 0.09, 0.46, 0.46, 0.56, 0.22, 'seat', head=False))
    o.body.extend(P.bench(hx + 0.04, 0.8, hz - 0.09, 0.46, 0.56, 0.22, 'seat').transform(Matrix.Translation((0, -0.42, 0))))
    for (x, w, z) in p['benches']:
        o.body.extend(P.bench(x + 0.04, w, z - 0.09, 0.46, 0.55, 0.25, 'seat', res=0))


def van_build(res, p):
    """Body, arches, glass, interior and wheels of a one-box van from its parameters; p['decor'] for the rest."""
    o = Out()
    rows = [r for r in p['rows'] if res or not r.get('hi')]
    ffr = p['ffr'] if res else [0.0, 0.04, 0.5, 1.0]
    rfr = p['rfr'] if res else [0.0, 0.5, 1.0]
    vb = VanBody(p['S0'], p['S1'], p['stations'] if res else p['stations_lo'], rows, p['region'], ffr, 6 if res else 3, rfr, 6 if res else 3)
    outer, inner = vb.build(p['floor'] + 0.02 if res else None)
    xf, xr, R = p['xf'], p['xr'], p['R']
    hm = arches(outer, [(xf, R, R + p['arch_gap']), (xr, R, R + p['arch_gap'])], p['track'] / 2 - p['tyre_w'] / 2 - 0.05, p['W'] / 2, 0.0, res)
    o.body.extend(hm)
    if res:
        o.body.extend(inner)
    pr = Projector(hm)
    if res:
        van_interior(o, p)
    p['decor'](o, res, pr, p)
    seg = 20 if res else 8
    w = P.wheel(R, p['tyre_w'], p['rim'], p.get('tyre', 'road'), p.get('rim_ratio', 0.6), seg, res, p.get('spokes', 5))
    wheels_into(o, res, (xf, xr), p['track'], R, w)
    dy = p['driver_y']
    hx, hz = p['hip']
    cabin_meta(o, [(hx, dy, hz), (hx, -dy, hz)] + [(x, s * dy, z) for (x, wd, z) in p['benches'] for s in (1, -1)], (hx + 0.1, dy, hz + p.get('eye_up', 0.64)))
    o.meta['dims'] = [p['L'], p['W'], round(rows[-1]['z'], 3)]
    o.meta['color'] = p['color']
    if not res:
        o.body.recolor('gloss', only='glass')
    return o


def bus_rows(x1, x0, rows, roof):
    """Expand a table of (z, hw, nose x, tail x, nose shape, tail shape[, hi only]) into slices plus the roof."""
    out = []
    for r in rows:
        d = dict(z=r[0], hw=r[1], xf=x1 + r[2], xr=x0 + r[3], fs=r[4], rs=r[5])
        if len(r) > 6:
            d['hi'] = r[6]
        out.append(d)
    return out + roof_rows(out[-1], *roof)


# ------------------------------------------------------------------ the T1-style bus

def vwbus_params():
    L, W = 4.4, 1.76
    x0, x1 = -L / 2, L / 2
    S1, S0 = x1 - 0.4, x0 + 0.36
    PANEL, PANEL2, SCREEN, ROOF = (0.24, 0.32, 2), (0.22, 0.34, 1.6), (0.17, 0.4, 1.0), (0.26, 0.3, 2)
    TAIL = (0.26, 0.28, 2)
    zs, zwb, zwt, ze = 1.0, 1.06, 1.58, 1.76
    rows = [
        (0.30, 0.0, -0.17, 0.2, PANEL, TAIL),
        (0.302, 0.78, -0.15, 0.17, PANEL, TAIL),
        (0.33, 0.85, -0.07, 0.08, PANEL, TAIL),
        (0.38, 0.87, -0.03, 0.03, PANEL, TAIL),
        (0.48, 0.875, -0.008, 0.01, PANEL, TAIL),
        (0.62, 0.878, 0.0, 0.0, PANEL, TAIL, True),
        (0.8, 0.879, -0.005, 0.0, PANEL, TAIL),
        (0.94, 0.879, -0.02, 0.005, PANEL, TAIL, True),
        (0.985, 0.881, -0.035, 0.008, PANEL, TAIL),
        (zs, 0.892, -0.032, 0.0, PANEL, TAIL),
        (1.015, 0.881, -0.04, 0.01, PANEL2, TAIL),
        (1.045, 0.874, -0.055, 0.012, PANEL2, TAIL, True),
        (zwb, 0.872, -0.06, 0.014, SCREEN, TAIL),
        (1.15, 0.87, -0.074, 0.016, SCREEN, TAIL, True),
        (1.32, 0.866, -0.1, 0.022, SCREEN, TAIL),
        (1.5, 0.862, -0.13, 0.03, SCREEN, TAIL, True),
        (zwt, 0.86, -0.145, 0.036, SCREEN, TAIL),
        (1.61, 0.86, -0.14, 0.04, PANEL2, TAIL, True),
        (1.66, 0.861, -0.128, 0.045, ROOF, TAIL),
        (1.72, 0.858, -0.125, 0.055, ROOF, TAIL, True),
        (ze, 0.855, -0.128, 0.065, ROOF, TAIL),
    ]
    xf, xr = 1.39, -1.06
    wins = [(1.77, 1.06), (0.98, 0.30), (0.22, -0.46), (-0.54, -1.22)]
    p = dict(L=L, W=W, S0=S0, S1=S1, xf=xf, xr=xr, R=0.345, tyre_w=0.165, track=1.38, arch_gap=0.065,
             rim='dogdish', rim_ratio=0.56, tyre='wall', color=0xff9a3a,
             rows=bus_rows(x1, x0, rows, (0.17, 0.17, 0.2, 0.035, 4)),
             ffr=[0.0, 0.04, 0.22, 0.42, 0.62, 0.82, 1.0], rfr=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
             stations=[1.77, 1.56, 1.06, 0.98, 0.30, 0.22, -0.46, -0.54, -1.22, -1.30, -1.62, -1.70],
             stations_lo=[1.77, 1.06, 0.98, -1.22, -1.30, -1.62, -1.70],
             floor=0.5, floor_x=(2.0, -1.55), hw_in=0.8, dash=(1.98, 1.02), driver_y=0.4, hip=(1.42, 0.9),
             wheel_c=(1.74, 0.4, 1.16), wheel_tilt=1.12, wheel_r=0.21, eye_up=0.64,
             benches=[(0.3, 1.5, 0.88), (-0.95, 1.6, 0.88)],
             zs=zs, zwb=zwb, zwt=zwt, ze=ze, wins=wins)

    def region(i):
        z, zone, k = i['z'], i['zone'], i['k']
        if z < 0.31:
            return 'black'
        if zwb < z < zwt:
            if zone == 'front' and 1 <= k <= 6:
                return 'glass'
            if zone == 'side':
                if any(a > i['x'] > b for (a, b) in wins) or i['x'] < -1.7:
                    return 'glass'
            if zone == 'rear' and k >= 7:
                return 'glass'
            if zone == 'rear' and k <= 3 and 1.15 < z < 1.5:
                return 'glass'
        # Skylights along the roof's edge, over the side windows.
        if zone == 'side' and ze + 0.02 < z < ze + 0.15 and any(a > i['x'] > b for (a, b) in wins[1:]):
            return 'glass'
        return 'paint' if z < zs else 'white'

    p['region'] = region
    p['decor'] = vwbus_decor
    return p


def vwbus_decor(o, res, pr, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    zs, zwb, zwt, ze = p['zs'], p['zwb'], p['zwt'], p['ze']
    # The big V on the nose: the upper colour coming down to a point above the bumper.
    flat(o, pr, 'front', [(-0.72, zs + 0.03), (-0.05, 0.69), (0.0, 0.675), (0.05, 0.69), (0.72, zs + 0.03)], 'white', 0.003, res=res, rings=3)
    if res:
        line(o, pr, 'front', [(-0.7, zs + 0.0), (-0.05, 0.69), (0.0, 0.676), (0.05, 0.69), (0.7, zs + 0.0)], 0.012, 'white', 0.007)
    # Round headlamps with chrome rims, small round indicators under them.
    for s in (1, -1):
        hf = aim_at(pr, 'front', s * 0.63, 0.83)
        lamp(o, pr, hf, circle_pts((0, 0), 0.085, 20 if res else 10), 'head', res, 'chrome', 0.02, 0.01, both=False, bw=0.018)
        af = aim_at(pr, 'front', s * 0.64, 0.6)
        lamp(o, pr, af, circle_pts((0, 0), 0.042, 14 if res else 8), 'amber', res, 'chrome', 0.012, 0.008, both=False, bw=0.008)
    # Fresh-air slot under the windscreen, the plate over the bumper.
    flat(o, pr, 'front', rrect_pts((0.0, 1.035), 0.9, 0.025, 0.012, 2), 'grille', 0.003, res=res, rings=1)
    plate(o, pr, 'front', (0.0, 0.54), 0.34, 0.11)
    # Bumpers: chrome blades with overriders.
    for (x, sg) in ((x1 + 0.03, 1), (x0 - 0.03, -1)):
        o.body.extend(wrap_bumper(x, 0.42, 0.84, 0.085, 0.06, 'chrome', sg, 0, 0.12))
        for s in (1, -1):
            o.body.extend(rbox((x - sg * 0.04, s * 0.42, 0.42), (0.06, 0.012, 0.03), 0.01, 'black', 1))
            if res:
                o.body.extend(tube([Vector((x + sg * 0.02, s * 0.45, 0.33)), Vector((x + sg * 0.045, s * 0.45, 0.5)), Vector((x + sg * 0.02, s * 0.45, 0.6))], 0.016, 'chrome', 8))
    # Windscreen: rubber round the two panes, a pillar between them, wipers.
    if res:
        for s in (1, -1):
            sf = aim_at(pr, 'front', s * 0.38, (zwb + zwt) / 2)
            line(o, pr, sf, rounded(rrect_pts((0.0, -0.005), 0.7, zwt - zwb - 0.02, 0.05, 2), 1), 0.018, 'black', 0.004, closed=True)
            o.body.extend(tube([Vector((x1 - 0.06, s * 0.08, zwb + 0.03)), Vector((x1 - 0.1, s * 0.5, zwb + 0.05))], 0.007, 'black', 4))
    # Tail lamps, the engine lid with the plate and its lamp, the hatch with its window, tailpipe.
    for s in (1, -1):
        tf = aim_at(pr, 'rear', s * 0.74, 0.84)
        lamp(o, pr, tf, rounded(rrect_pts((0, 0), 0.09, 0.15, 0.04, 2), 1), 'tail', res, 'chrome', 0.012, 0.008, both=False, bw=0.01)
        if res:
            lamp(o, pr, tf, circle_pts((0, 0.045), 0.03, 10), 'amber', res, None, 0.004, 0.02, both=False)
    plate(o, pr, 'rear', (0.0, 0.62), 0.32, 0.12)
    if res:
        o.body.extend(rbox((x0 - 0.0, 0, 0.71), (0.04, 0.09, 0.025), 0.015, 'chrome', 1))
        o.body.extend(cyl((x0 + 0.3, -0.35, 0.3), (x0 - 0.08, -0.35, 0.3), 0.024, 'chrome', 8))
        gaps(o, pr, [rounded(rrect_pts((0.0, 0.62), 1.2, 0.36, 0.05, 2), 1)], frame='rear', both=False)
        gaps(o, pr, [rounded(rrect_pts((0.0, 1.32), 1.24, 0.6, 0.06, 2), 1)], frame='rear', both=False)
        line(o, pr, 'rear', rounded(rrect_pts((0.0, 1.325), 1.08, 0.37, 0.05, 2), 1), 0.016, 'black', 0.004, closed=True)
        # Cab doors, the side load doors on the right, rubber round every side window.
        dz0 = xf + R + 0.07
        gaps(o, pr, [[(1.79, ze - 0.06), (1.79, 0.82), (1.03, 0.82), (1.03, ze - 0.06)]])
        for (a, b) in [(1.0, 0.24), (0.24, -0.5)]:
            m = strip(pr, 'side', [(a, ze - 0.06), (a, 0.36), (b, 0.36), (b, ze - 0.06)], 0.0065, 'gap', 0.0015)
            o.body.extend(m.mirrored())
        for (a, b) in p['wins']:
            line(o, pr, 'side', rounded(rrect_pts(((a + b) / 2, (zwb + zwt) / 2), a - b, zwt - zwb, 0.05, 2), 1), 0.016, 'black', 0.004, both=True, closed=True)
        line(o, pr, 'side', [(1.56, zwb), (1.56, zwt)], 0.014, 'chrome', 0.005, both=True)
        handle(o, pr, 1.12, 0.96, 'chrome')
        o.body.extend(patch(pr, 'side', ccw(rrect_pts((0.18, 0.96), 0.12, 0.03, 0.013, 2)), 'chrome', 0.007, 0.004, 2).mirrored())
        # Engine air louvres behind the last side window.
        for k in range(7):
            z = 1.14 + k * 0.055
            line(o, pr, 'side', [(-1.33, z), (-1.59, z)], 0.016, 'gap', 0.002, both=True)
        # Rain gutter over the doors and windows.
        line(o, pr, 'side', [(1.8, ze - 0.04), (-1.84, ze - 0.04)], 0.012, 'gap', 0.002, both=True)
        # Canvas sunroof.
        flat(o, pr, 'top', rounded(rrect_pts((0.05, 0.0), 1.7, 1.0, 0.08, 2), 1), 'canvas', 0.005, bezel=(0.02, 'chrome', 0.004), rings=1)
        for k in range(1, 6):
            x = 0.05 - 0.85 + k * 1.7 / 6
            line(o, pr, 'top', [(x, -0.48), (x, 0.48)], 0.01, 'black', 0.007)
    # Round mirrors on stalks.
    for m in (round_mirror((1.82, 0.84, 1.1), (1.86, 1.0, 1.24), res=res),):
        o.body.extend(m.both())


@car
def vwbus(res):
    return van_build(res, vwbus_params())


# ------------------------------------------------------------------ the bay-window camper

def van_params():
    L, W = 4.5, 1.78
    x0, x1 = -L / 2, L / 2
    S1, S0 = x1 - 0.45, x0 + 0.36
    NOSE, SCREEN, ROOF, TAIL = (0.26, 0.3, 2), (0.24, 0.28, 2), (0.28, 0.3, 2), (0.26, 0.28, 2)
    zs, zwb, zwt, ze = 0.95, 1.05, 1.6, 1.74
    rows = [
        (0.28, 0.0, -0.2, 0.2, NOSE, TAIL),
        (0.282, 0.78, -0.17, 0.17, NOSE, TAIL),
        (0.31, 0.85, -0.08, 0.08, NOSE, TAIL),
        (0.36, 0.872, -0.03, 0.03, NOSE, TAIL),
        (0.46, 0.878, -0.005, 0.01, NOSE, TAIL),
        (0.62, 0.882, 0.0, 0.0, NOSE, TAIL, True),
        (0.8, 0.884, -0.02, 0.0, NOSE, TAIL),
        (0.92, 0.884, -0.05, 0.005, NOSE, TAIL, True),
        (0.94, 0.886, -0.058, 0.008, NOSE, TAIL),
        (zs, 0.895, -0.056, 0.004, NOSE, TAIL),
        (0.962, 0.886, -0.068, 0.01, NOSE, TAIL),
        (1.0, 0.882, -0.085, 0.012, SCREEN, TAIL, True),
        (zwb, 0.878, -0.105, 0.014, SCREEN, TAIL),
        (1.2, 0.874, -0.16, 0.016, SCREEN, TAIL, True),
        (1.35, 0.869, -0.21, 0.022, SCREEN, TAIL),
        (1.5, 0.864, -0.255, 0.03, SCREEN, TAIL, True),
        (zwt, 0.86, -0.28, 0.036, SCREEN, TAIL),
        (1.68, 0.858, -0.288, 0.045, ROOF, TAIL, True),
        (ze, 0.855, -0.29, 0.06, ROOF, TAIL),
    ]
    xf, xr = 1.4, -1.0
    wins = [(1.75, 1.02), (0.94, 0.12), (0.04, -1.02)]
    p = dict(L=L, W=W, S0=S0, S1=S1, xf=xf, xr=xr, R=0.34, tyre_w=0.185, track=1.42, arch_gap=0.065,
             rim='retro', rim_ratio=0.53, tyre='road', color=0x7b2ff7,
             rows=bus_rows(x1, x0, rows, (0.17, 0.12, 0.2, 0.03, 4)),
             ffr=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0], rfr=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
             stations=[1.75, 1.55, 1.02, 0.94, 0.12, 0.04, -1.02, -1.86 + 0.02],
             stations_lo=[1.75, 1.02, 0.94, 0.12, 0.04, -1.02],
             floor=0.5, floor_x=(2.0, -1.55), hw_in=0.8, dash=(1.98, 1.0), driver_y=0.4, hip=(1.45, 0.9),
             wheel_c=(1.78, 0.4, 1.15), wheel_tilt=1.12, wheel_r=0.21, eye_up=0.64,
             benches=[(-0.95, 1.6, 0.88)], dash_region='black',
             zs=zs, zwb=zwb, zwt=zwt, ze=ze, wins=wins)

    def region(i):
        z, zone, k = i['z'], i['zone'], i['k']
        if z < 0.29:
            return 'black'
        if zwb < z < zwt:
            if zone == 'front' and k <= 7:
                return 'glass'
            if zone == 'side' and any(a > i['x'] > b for (a, b) in wins):
                return 'glass'
            if zone == 'rear' and k <= 3 and 1.12 < z < 1.55:
                return 'glass'
        return 'paint' if z < zs else 'white'

    p['region'] = region
    p['decor'] = van_decor
    return p


def van_decor(o, res, pr, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    zs, zwb, zwt, ze = p['zs'], p['zwb'], p['zwt'], p['ze']
    # Round headlamps low in the nose, indicators up beside the air intake, the intake itself.
    for s in (1, -1):
        hf = aim_at(pr, 'front', s * 0.6, 0.78)
        lamp(o, pr, hf, circle_pts((0, 0), 0.085, 20 if res else 10), 'head', res, 'chrome', 0.02, 0.01, both=False, bw=0.018)
        af = aim_at(pr, 'front', s * 0.6, 1.0)
        lamp(o, pr, af, rounded(rrect_pts((0, 0), 0.13, 0.065, 0.02, 1), 1), 'amber', res, 'chrome', 0.008, 0.008, both=False, bw=0.008)
    flat(o, pr, 'front', rounded(rrect_pts((0.0, 1.0), 0.78, 0.075, 0.03, 2), 1), 'grille', 0.004, bezel=(0.012, 'chrome', 0.003), res=res, rings=1)
    if res:
        for t in (0.98, 1.0, 1.02):
            line(o, pr, 'front', [(-0.37, t), (0.37, t)], 0.008, 'gloss', 0.006)
        # The windscreen's rubber and two wipers.
        for t in (zwb + 0.01,):
            line(o, pr, 'front', [(-0.72, t), (0.72, t)], 0.018, 'black', 0.004)
        for s in (1, -1):
            o.body.extend(tube([Vector((x1 - 0.12, s * 0.1, zwb + 0.03)), Vector((x1 - 0.17, s * 0.55, zwb + 0.07))], 0.007, 'black', 4))
    plate(o, pr, 'front', (0.0, 0.5), 0.36, 0.11)
    # Step bumpers, white, with black rubber tops.
    for (x, sg) in ((x1 + 0.03, 1), (x0 - 0.03, -1)):
        o.body.extend(wrap_bumper(x, 0.38, 0.84, 0.11, 0.07, 'white', sg, res))
        o.body.extend(wrap_bumper(x + sg * 0.012, 0.38, 0.82, 0.022, 0.06, 'black', sg, 0))
    # Tail lamps: tall red blocks with amber tops; plate and its lamp on the engine lid; tailpipes.
    for s in (1, -1):
        tf = aim_at(pr, 'rear', s * 0.72, 0.84)
        lamp(o, pr, tf, rounded(rrect_pts((0, 0), 0.12, 0.22, 0.03, 2), 1), 'tail', res, 'chrome', 0.01, 0.008, both=False, bw=0.01)
        if res:
            lamp(o, pr, tf, rrect_pts((0, 0.07), 0.1, 0.05, 0.015, 1), 'amber', res, None, 0.004, 0.018, both=False)
    plate(o, pr, 'rear', (0.0, 0.62), 0.32, 0.12)
    if res:
        o.body.extend(rbox((x0 + 0.0, 0, 0.71), (0.04, 0.09, 0.025), 0.015, 'chrome', 1))
        for s in (0.3, 0.4):
            o.body.extend(cyl((x0 + 0.3, -s, 0.27), (x0 - 0.08, -s, 0.27), 0.022, 'chrome', 8))
        gaps(o, pr, [rounded(rrect_pts((0.0, 0.62), 1.2, 0.38, 0.05, 2), 1)], frame='rear', both=False)
        gaps(o, pr, [rounded(rrect_pts((0.0, 1.33), 1.34, 0.6, 0.06, 2), 1)], frame='rear', both=False)
        line(o, pr, 'rear', rounded(rrect_pts((0.0, 1.335), 1.2, 0.43, 0.05, 2), 1), 0.016, 'black', 0.004, closed=True)
        # Cab doors; the sliding door on the right with its rail running back under the window.
        gaps(o, pr, [[(1.78, ze - 0.05), (1.78, 0.8), (0.99, 0.8), (0.99, ze - 0.05)]])
        side_r = [[(0.97, ze - 0.05), (0.97, 0.33), (0.07, 0.33), (0.07, ze - 0.05)]]
        for pts in side_r:
            o.body.extend(strip(pr, 'side', pts, 0.0065, 'gap', 0.0015).mirrored())
        o.body.extend(strip(pr, 'side', [(0.07, zwb - 0.035), (-1.04, zwb - 0.035)], 0.022, 'black', 0.003).mirrored())
        o.body.extend(strip(pr, 'side', [(0.07, zwb - 0.035), (-1.04, zwb - 0.035)], 0.008, 'chrome', 0.006).mirrored())
        o.body.extend(patch(pr, 'side', ccw(rrect_pts((0.14, 0.9), 0.12, 0.03, 0.013, 2)), 'chrome', 0.007, 0.004, 2).mirrored())
        handle(o, pr, 1.08, 0.92, 'chrome')
        for (a, b) in p['wins']:
            line(o, pr, 'side', rounded(rrect_pts(((a + b) / 2, (zwb + zwt) / 2), a - b, zwt - zwb, 0.06, 2), 1), 0.016, 'black', 0.004, both=True, closed=True)
        line(o, pr, 'side', [(1.55, zwb), (1.55, zwt)], 0.014, 'chrome', 0.005, both=True)
        # The 'ears': raised air scoops behind the last side window.
        ear = rounded([(-1.2, 1.24), (-1.2, 1.46), (-1.5, 1.44), (-1.56, 1.34), (-1.5, 1.24)], 2)
        flat(o, pr, 'side', ear, 'grille', 0.02, both=True, bezel=(0.035, 'white', 0.03), rings=1)
        for t in (1.29, 1.34, 1.39):
            line(o, pr, 'side', [(-1.22, t), (-1.52, t)], 0.01, 'white', 0.026, both=True)
        line(o, pr, 'side', [(1.8, ze - 0.03), (-1.86, ze - 0.03)], 0.012, 'gap', 0.002, both=True)
        # Fuel flap on the right.
        o.body.extend(strip(pr, 'side', circle_pts((-1.5, 0.85), 0.06, 12), 0.006, 'gap', 0.0015, closed=True).mirrored())
        # Curtains drawn in the camper windows.
        for s in (1, -1):
            for (a, b) in p['wins'][1:]:
                for xx in (a - 0.08, b + 0.08):
                    o.body.extend(rbox((xx, s * 0.82, (zwb + zwt) / 2), (0.07, 0.015, (zwt - zwb) / 2 - 0.02), 0.01, 'canvas', 1))
        # A camper's unit along the left: a cupboard with a table in front of it.
        o.body.extend(rbox((0.45, 0.66, 0.75), (0.42, 0.16, 0.25), 0.02, 'seat', 1))
        o.body.extend(rbox((-0.25, 0.45, 0.98), (0.3, 0.35, 0.015), 0.01, 'white', 1))
        o.body.extend(cyl((-0.25, 0.45, 0.97), (-0.25, 0.45, 0.5), 0.02, 'chrome', 8))
    # The pop-top roof, folded down, and its hinges.
    top = p['rows'][-1]['z']
    o.body.extend(rbox((-0.15, 0, top + 0.05), (1.75, 0.76, 0.065), 0.05, 'white', 2 if res else 1))
    if res:
        for s in (1, -1):
            o.body.extend(rbox((1.55, s * 0.62, top + 0.12), (0.12, 0.025, 0.02), 0.008, 'chrome', 1))
    for m in (round_mirror((1.8, 0.84, 1.12), (1.83, 1.0, 1.24), res=res),):
        o.body.extend(m.both())


@car
def van(res):
    return van_build(res, van_params())


# ------------------------------------------------------------------ the main battle tank

def solid(points, region):
    """The convex hull of some points as a faceted solid (armour blocks, the turret)."""
    import bmesh
    bm = bmesh.new()
    for p in points:
        bm.verts.new(p)
    res = bmesh.ops.convex_hull(bm, input=list(bm.verts))
    bmesh.ops.delete(bm, geom=[g for g in res['geom_interior'] + res['geom_unused'] if isinstance(g, bmesh.types.BMVert)], context='VERTS')
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    m = Mesh()
    idx = {v: m.vert(v.co.copy()) for v in bm.verts}
    for f in bm.faces:
        m.face([idx[v] for v in f.verts], region)
    bm.free()
    return m


def slab(outline, y0, y1, region):
    """A flat side-view outline (x, z) extruded across the car from y0 to y1, sharp edged."""
    from carkit import prism
    return prism(outline, y0, y1, region)


def arc_pts(c, r, a0, a1, n):
    return [(c[0] + r * math.cos(math.radians(a0 + (a1 - a0) * k / n)), c[1] + r * math.sin(math.radians(a0 + (a1 - a0) * k / n))) for k in range(n + 1)]


def belt(loop, y0, y1, t, region, grouser=0.0, step=0.17):
    """A track: a closed side-view loop (outer surface, counter-clockwise in x, z), t thick, y0..y1 wide."""
    from carkit import poly_offset
    inner = poly_offset(loop, -t)
    m = Mesh()
    n = len(loop)
    o0 = [m.vert((x, y0, z)) for (x, z) in loop]
    o1 = [m.vert((x, y1, z)) for (x, z) in loop]
    i0 = [m.vert((x, y0, z)) for (x, z) in inner]
    i1 = [m.vert((x, y1, z)) for (x, z) in inner]
    yc = (y0 + y1) / 2

    def add(q, want):
        if _fnormal(m, q).dot(want) < 0:
            q = tuple(reversed(q))
        m.face(q, region)

    for k in range(n):
        k2 = (k + 1) % n
        dx, dz = loop[k2][0] - loop[k][0], loop[k2][1] - loop[k][1]
        out = Vector((dz, 0.0, -dx))
        add((o0[k], o0[k2], o1[k2], o1[k]), out)
        add((i0[k], i1[k], i1[k2], i0[k2]), -out)
        add((o0[k], i0[k], i0[k2], o0[k2]), Vector((0, -1, 0)))
        add((o1[k], o1[k2], i1[k2], i1[k]), Vector((0, 1, 0)))
    if grouser:
        from carbody import resample
        pts = resample(loop, step)
        for k in range(0, len(pts)):
            a, b = Vector(pts[k]), Vector(pts[(k + 1) % len(pts)])
            d = (b - a)
            if d.length < 1e-6:
                continue
            d.normalize()
            nrm = Vector((d.y, -d.x))
            c = a + nrm * grouser * 0.5
            ang = math.atan2(d.y, d.x)
            M = Matrix.Translation((c.x, yc, c.y)) @ Matrix.Rotation(-ang, 4, 'Y')
            m.extend(rbox((0, 0, 0), (0.035, (y1 - y0) / 2 + 0.01, grouser / 2), 0.0, region, 1, M))
    return m


def road_wheel(R, w, res=1, seg=16, gap=0.1):
    """A dual road wheel round its centre, axle along y: two rubber-tyred discs either side of the guide horn."""
    from carkit import lathe
    m = Mesh()
    seg = seg if res else 8
    for s in (1, -1):
        y0 = s * gap / 2
        y1 = s * (gap / 2 + w)
        a, b = min(y0, y1), max(y0, y1)
        prof = [(R * 0.8, a), (R, a + 0.012), (R, b - 0.012), (R * 0.8, b)]
        m.extend(lathe(prof, 'tyre', seg, axis=(0, 1, 0)))
        face = b if s > 0 else a
        m.extend(lathe([(R * 0.8, face), (R * 0.55, face + s * 0.02), (R * 0.2, face + s * 0.03), (0.0, face + s * 0.035)][::s], 'metal', seg, axis=(0, 1, 0)))
        if res:
            m.extend(lathe([(R * 0.12, face + s * 0.03), (R * 0.1, face + s * 0.06), (0.0, face + s * 0.065)][::s], 'rim2', 8, axis=(0, 1, 0)))
    return m


def sprocket(R, w, teeth=11, res=1):
    m = road_wheel(R * 0.82, w, res, 16)
    m.recolor('metal', only='tyre')
    if res:
        for k in range(teeth):
            a = 2 * math.pi * k / teeth
            for s in (1, -1):
                M = Matrix.Translation((math.cos(a) * R * 0.86, s * (0.05 + w / 2), math.sin(a) * R * 0.86)) @ Matrix.Rotation(-a, 4, 'Y')
                m.extend(rbox((0, 0, 0), (0.07, w / 2, 0.035), 0.0, 'metal', 1, M))
    return m


TANK = dict(L=7.6, W=3.66, deck=1.52, ring=(-0.25, 1.52), trunnion=(1.78, 0.4), R=0.31, track_y=1.42, track_w=0.62,
            wheels_x=[2.62, 1.76, 0.9, 0.04, -0.82, -1.68, -2.54], idler=(3.32, 0.62, 0.28), sprocket=(-3.36, 0.68, 0.32))


def tank_hull(res):
    T = TANK
    m = Mesh()
    d = T['deck']
    # The hull: a lower tub between the tracks and the upper hull over them, a long shallow glacis.
    m.extend(slab([(-3.6, 0.48), (3.15, 0.48), (3.8, 0.98), (3.8, 1.06), (-3.7, 1.06), (-3.7, 0.72)], -1.1, 1.1, 'paint'))
    up = [(-3.72, 1.05), (3.6, 1.05), (3.86, 1.0), (3.86, 1.06), (2.3, d - 0.02), (2.15, d), (-3.55, d + 0.02), (-3.72, d - 0.06)]
    m.extend(slab(up, -1.76, 1.76, 'paint'))
    # Side skirts over the tracks, armoured blocks at the front, a rubber flap along the bottom.
    for s in (1, -1):
        y0, y1 = (1.76, 1.84) if s > 0 else (-1.84, -1.76)
        m.extend(slab([(-3.64, 0.62), (2.0, 0.62), (2.0, 1.12), (-3.64, 1.12)], y0, y1, 'paint'))
        m.extend(slab([(2.0, 0.6), (3.0, 0.6), (3.6, 0.8), (3.78, 1.06), (3.7, 1.12), (2.0, 1.12)], y0 + s * 0.02, y1 + s * 0.02, 'paint'))
        m.extend(box_at((-0.82, s * 1.8, 0.6), (2.82, 0.035, 0.03), 'black'))
    # The track and its wheels: road wheels, the idler at the front, the sprocket at the back.
    ix, iz, ir = T['idler']
    sx, sz, sr = T['sprocket']
    t = 0.07
    loop = [(-2.9, 0.0), (2.9, 0.0)] + arc_pts((ix, iz), ir + t, -70, 95, 8 if res else 4) + arc_pts((sx, sz), sr + t, 85, 255, 8 if res else 4)
    for s in (1, -1):
        y = s * T['track_y']
        m.extend(belt(loop, y - T['track_w'] / 2, y + T['track_w'] / 2, t, 'track', 0.035 if res else 0.0))
        m.extend(place(road_wheel(ir, 0.24, res), ix, y, iz))
        m.extend(place(sprocket(sr, 0.22, 11, res), sx, y, sz))
    # Front: headlamps in guards on the glacis corners, tow hooks; back: tail lamps, exhaust grille.
    for s in (1, -1):
        m.extend(box_at((3.6, s * 1.45, 1.13), (0.07, 0.11, 0.06), 'black'))
        m.extend(box_at((3.67, s * 1.45, 1.13), (0.012, 0.08, 0.04), 'head'))
        m.extend(box_at((-3.73, s * 1.55, 1.38), (0.012, 0.07, 0.04), 'tail'))
        if res:
            m.extend(cyl((3.84, s * 0.7, 0.93), (3.92, s * 0.7, 0.93), 0.06, 'metal', 8))
            for k in (-1, 1):
                m.extend(box_at((3.62, s * 1.45 + k * 0.12, 1.16), (0.09, 0.01, 0.08), 'paint'))
    m.extend(box_at((-3.73, 0, 1.22), (0.012, 0.85, 0.18), 'grille'))
    if res:
        for k in range(6):
            m.extend(box_at((-3.735, 0, 1.08 + k * 0.055), (0.01, 0.84, 0.008), 'metal'))
        # Engine deck grilles, the driver's hatch with its periscopes, stowage boxes on the fenders.
        for (x, w) in ((-2.3, 0.55), (-3.0, 0.45)):
            m.extend(box_at((x, 0, d + 0.025), (w / 2, 0.85, 0.008), 'grille'))
            for k in range(7):
                m.extend(box_at((x, -0.72 + k * 0.24, d + 0.032), (w / 2, 0.012, 0.006), 'metal'))
        m.extend(cyl((2.05, 0, d - 0.01), (2.05, 0, d + 0.05), 0.3, 'paint', 16))
        for a in (-0.18, 0.0, 0.18):
            m.extend(box_at((2.38, a, d + 0.04), (0.03, 0.06, 0.035), 'glass'))
        for s in (1, -1):
            m.extend(box_at((-1.2, s * 1.55, d + 0.12), (0.9, 0.18, 0.12), 'paint'))
            m.extend(box_at((1.1, s * 1.58, d + 0.08), (0.45, 0.15, 0.08), 'paint'))
            m.extend(box_at((-3.2, s * 1.4, d + 0.05), (0.3, 0.25, 0.05), 'paint'))
    return m


def box_at(c, half, region):
    return rbox(c, half, 0.0, region, 1)


def place(m, x, y, z):
    return m.copy().transform(Matrix.Translation((x, y, z)))


def tank_turret(res):
    """The turret round its own pivot (the middle of the ring on the deck)."""
    m = Mesh()
    bot = [(1.9, 0.52), (1.75, 1.5), (-1.25, 1.6), (-2.2, 1.35), (-2.35, 0.9)]
    top = [(1.62, 0.45), (1.5, 1.32), (-1.25, 1.44), (-2.1, 1.25), (-2.24, 0.85)]
    pts = [(x, s * y, 0.05) for (x, y) in bot for s in (1, -1)] + [(x, s * y, 0.74) for (x, y) in top for s in (1, -1)]
    m.extend(solid(pts, 'paint'))
    # The ring under it.
    m.extend(cyl((0, 0, -0.06), (0, 0, 0.06), 1.15, 'metal', 24 if res else 12))
    # The gun's slot between the cheeks.
    m.extend(box_at((1.86, 0, 0.42), (0.12, 0.46, 0.28), 'black'))
    # The commander's cupola with its machine gun (right), the loader's hatch (left), the gunner's sight.
    cx, cy = -0.35, -0.62
    m.extend(cyl((cx, cy, 0.72), (cx, cy, 0.92), 0.36, 'paint', 16 if res else 8))
    m.extend(cyl((cx, cy, 0.92), (cx, cy, 0.97), 0.3, 'paint', 16 if res else 8))
    if res:
        for k in range(6):
            a = 2 * math.pi * k / 6
            m.extend(box_at((cx + math.cos(a) * 0.34, cy + math.sin(a) * 0.34, 0.85), (0.03, 0.05, 0.03), 'glass'))
    m.extend(box_at((cx + 0.15, cy, 1.05), (0.22, 0.06, 0.07), 'black'))
    m.extend(cyl((cx + 0.35, cy, 1.07), (cx + 1.25, cy, 1.07), 0.022, 'black', 6))
    m.extend(cyl((-0.1, 0.6, 0.72), (-0.1, 0.6, 0.79), 0.32, 'paint', 16 if res else 8))
    m.extend(box_at((0.95, -0.85, 0.86), (0.25, 0.22, 0.13), 'paint'))
    m.extend(box_at((1.205, -0.85, 0.88), (0.008, 0.16, 0.07), 'glass'))
    if res:
        # Smoke grenade launchers on the cheeks, the bustle rack, an aerial and the wind sensor.
        for s in (1, -1):
            for k in range(6):
                m.extend(cyl((1.15, s * (1.25 + 0.06 * (k % 3)), 0.78 + 0.07 * (k // 3)), (1.38, s * (1.3 + 0.06 * (k % 3)), 0.86 + 0.07 * (k // 3)), 0.03, 'black', 6))
            m.extend(cyl((-1.95, s * 0.95, 0.74), (-1.95, s * 0.95, 1.9), 0.008, 'black', 4))
        for z in (0.95, 1.12):
            m.extend(tube([Vector((-1.6, 1.42, z)), Vector((-2.45, 1.3, z)), Vector((-2.55, 0.0, z)), Vector((-2.45, -1.3, z)), Vector((-1.6, -1.42, z))], 0.02, 'metal', 4))
        for (x, y) in ((-2.45, 1.3), (-2.55, 0.0), (-2.45, -1.3), (-1.6, 1.42), (-1.6, -1.42)):
            m.extend(cyl((x, y, 0.6), (x, y, 1.12), 0.02, 'metal', 4))
        m.extend(box_at((-2.2, 0.6, 0.98), (0.2, 0.35, 0.2), 'canvas'))
        m.extend(box_at((-2.2, -0.5, 0.92), (0.18, 0.45, 0.16), 'canvas'))
        m.extend(cyl((-1.7, 0.2, 0.74), (-1.7, 0.2, 1.05), 0.012, 'metal', 4))
        m.extend(box_at((-1.7, 0.2, 1.06), (0.06, 0.06, 0.01), 'metal'))
    return m


def tank_barrel(res):
    """The gun round its trunnion: the mantlet, the long tube with its fume extractor, the muzzle."""
    m = Mesh()
    seg = 16 if res else 8
    m.extend(solid([(0.0, s * 0.42, t * 0.26) for s in (1, -1) for t in (1, -1)] + [(0.42, s * 0.34, t * 0.2) for s in (1, -1) for t in (1, -1)], 'paint'))
    m.extend(cyl((0.42, 0, 0), (0.75, 0, 0), 0.15, 'paint', seg, r1=0.12))
    m.extend(cyl((0.75, 0, 0), (5.0, 0, 0), 0.095, 'paint', seg, r1=0.085))
    m.extend(cyl((2.6, 0, 0), (3.3, 0, 0), 0.14, 'paint', seg))
    m.extend(cyl((5.0, 0, 0), (5.08, 0, 0), 0.105, 'paint', seg))
    m.extend(cyl((5.07, 0, 0), (5.081, 0, 0), 0.06, 'gap', seg))
    # The coaxial machine gun beside it.
    m.extend(cyl((0.4, 0.26, 0.05), (0.62, 0.26, 0.05), 0.02, 'black', 6))
    return m


def tank_build(res):
    T = TANK
    o = Out()
    o.body.extend(tank_hull(res))
    rx, rz = T['ring']
    tx, tz = T['trunnion']
    o.parts['turret'] = tank_turret(res) if res else Mesh()
    o.parts['barrel'] = tank_barrel(res) if res else Mesh()
    if not res:
        o.parts = {}
    R = T['R']
    wz = R + 0.07
    wl = []
    for x in T['wheels_x']:
        for s in (1, -1):
            wl.append([round(x, 4), round(wz, 4), round(-s * T['track_y'], 4), 'r'])
    o.meta['wheels'] = wl
    o.meta['wheelR'] = [R, R]
    if res:
        o.wheel['r'] = road_wheel(R, 0.24, res)
    else:
        rw = road_wheel(R, 0.24, 0, 8)
        for x in T['wheels_x']:
            for s in (1, -1):
                o.body.extend(place(rw, x, s * T['track_y'], wz))
    o.meta['turret'] = [rx, rz, 0.0]
    o.meta['barrel'] = [tx, tz, 0.0]
    cabin_meta(o, [(2.05, 0.0, 1.12), (rx - 0.35, -0.62, 1.55)], (2.1, 0.0, 1.78))
    o.meta['dims'] = [T['L'], T['W'], 2.45]
    o.meta['color'] = 0x5d6b3a
    return o


@car
def tank(res):
    return tank_build(res)


# ------------------------------------------------------------------ the minivan

def minivan_params():
    L, W = 5.16, 1.99
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.6, -1.4
    R = 0.36
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.235, track=1.7, arch_gap=0.055, rim='twin', spokes=5, color=0x9aa0ab,
        bottom=C((x0, 0.45), (x0 + 0.15, 0.36), (x0 + 0.5, 0.28), (xr, 0.21), (xf, 0.21), (xf + 0.5, 0.26), (x1 - 0.1, 0.33), (x1, 0.4)),
        shoulder=C((x0, 0.92), (x0 + 0.06, 0.96), (x0 + 0.3, 0.97), (-1.3, 0.965), (-1.05, 1.045), (0.4, 1.045), (1.6, 1.0), (2.1, 0.95), (x1 - 0.15, 0.89), (x1, 0.82)),
        top=C((x0, 0.94), (x0 + 0.06, 0.98), (x0 + 0.3, 1.0), (-1.3, 0.99), (-1.05, 1.065), (0.4, 1.065), (1.6, 1.02), (2.1, 0.975), (x1 - 0.15, 0.915), (x1, 0.84)),
        width=C((x0, 0.95), (-1.8, 0.99), (1.6, 0.995), (x1, 0.95)),
        tuck=const(0.07), tumble=const(0.06), cfrac=C((x0, 0.7), (0.0, 0.66), (x1, 0.72)),
        rb=const(0.07), rs=C((x0, 0.04), (x0 + 0.3, 0.05), (1.2, 0.05), (x1 - 0.3, 0.04), (x1, 0.03)),
        front=(0.45, 2.4), rear=(0.26, 3.0),
        flares=[(xf, 0.55, 0.012, 0.62, 0.26), (xr, 0.55, 0.012, 0.62, 0.26)],
        open=[(-2.3, 1.57, 0.32)],
        bl_base=-2.48, ws_base=1.6, inset=0.035,
        roof_z=C((-2.48, 1.0), (-2.42, 1.35), (-2.32, 1.62), (-2.1, 1.72), (-1.0, 1.74), (0.35, 1.73), (0.65, 1.66), (1.05, 1.4), (1.35, 1.18), (1.6, 1.0)),
        rail_z=C((-2.48, 0.99), (-2.42, 1.32), (-2.32, 1.58), (-2.1, 1.67), (-1.0, 1.69), (0.35, 1.68), (0.65, 1.61), (1.05, 1.36), (1.35, 1.15), (1.6, 0.985)),
        rail_w=C((-2.48, 0.78), (-2.1, 0.8), (0.0, 0.81), (1.6, 0.88)),
        corner=C((-2.2, 0.08), (0.5, 0.08), (1.0, 0.05)),
        lines=[(-2.3, -2.25), (-2.1, -2.06), (-1.2, -1.24), (-1.1, -1.14), (-0.06, -0.1), (0.04, 0.0), (1.3, 0.54)],
        driver_y=0.42, hip_f=(0.42, 0.64), seats=7,
        dash=(1.62, 1.12, 0.82, 0.66, 1.0), wheel_c=(0.9, 0.98),
        mirror=(1.42, 0.9, 1.06),
        benches=[(-0.75, 1.3, 0.64), (-1.75, 1.45, 0.65)],
        more_seats=[(-1.75, 0.0, 0.65)],
    )

    def glass_region(i):
        seg, xb, xr_ = i['seg'], i['xb'], i['xr']
        if seg == 'side':
            if i['zone'] == 'front' or xb > 1.3:
                return 'black'
            for (a, b) in ((-0.06, 0.04), (-1.2, -1.1)):
                if a < xb < b:
                    return 'gloss'
            if xb < -2.1:
                return 'gloss'
            return 'glass'
        if seg == 'corner':
            return 'paint'
        if xr_ > 0.54 or xr_ < -2.25:
            return 'glass'
        return 'paint'

    p['glass_region'] = glass_region
    p['decor'] = minivan_decor
    return p


def minivan_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    # Slim headlamps swept back into the wings, a thick chrome wing across the nose over the grille.
    hf = aim((x1 - 0.22, 0.66, 0.79), 0.75, 0.2)
    head = rounded([(-0.3, -0.035), (0.12, -0.03), (0.26, 0.0), (0.3, 0.04), (0.2, 0.05), (-0.3, 0.035)], 2)
    lamp(o, pr, hf, head, 'head', res, 'gloss', 0.008, 0.006, bw=0.012)
    if res:
        line(o, pr, hf, [(-0.28, -0.02), (0.12, -0.015), (0.27, 0.03)], 0.01, 'white', 0.018, both=True)
    flat(o, pr, 'front', rounded([(-0.5, 0.62), (0.5, 0.62), (0.56, 0.74), (-0.56, 0.74)], 1), 'grille', 0.004, bezel=(0.01, 'gloss', 0.003), res=res, rings=1)
    line(o, pr, 'front', [(-0.62, 0.765), (-0.45, 0.755), (0.45, 0.755), (0.62, 0.765)], 0.04, 'chrome', 0.008)
    low = rounded([(-0.6, 0.48), (0.6, 0.48), (0.72, 0.3), (-0.72, 0.3)], 2)
    flat(o, pr, 'front', low, 'grille', 0.004, bezel=(0.014, 'gloss', 0.003), res=res, rings=1)
    if res:
        for z in (0.44, 0.39, 0.34):
            line(o, pr, 'front', [(-0.62, z), (0.62, z)], 0.01, 'gloss', 0.007)
    plate(o, pr, 'front', (0.0, 0.4))
    fv = aim((x1 - 0.22, 0.75, 0.38), 0.6, 0.0)
    lamp(o, pr, fv, rrect_pts((0, 0), 0.14, 0.04, 0.015, 1), 'head', res, 'gloss', 0.004, 0.008, bw=0.008)
    line(o, pr, 'front', [(-0.75, 0.28), (0.75, 0.28)], 0.03, 'black', 0.003)
    # Tail lamps along the bottom of the back window, wrapping round; chrome across the tailgate.
    tf = aim((x0 + 0.1, 0.74, 1.02), math.pi - 0.75, 0.05)
    tail = rounded([(0.3, -0.07), (0.3, 0.08), (-0.25, 0.07), (-0.36, 0.03), (-0.36, -0.05)], 2)
    lamp(o, pr, tf, tail, 'tail', res, 'gloss', 0.006, 0.006, bw=0.008)
    line(o, pr, 'rear', [(-0.48, 1.0), (0.48, 1.0)], 0.03, 'chrome', 0.006)
    if res:
        line(o, pr, 'rear', [(-0.5, 1.035), (0.5, 1.035)], 0.012, 'red', 0.008)
    plate(o, pr, 'rear', (0.0, 0.78))
    line(o, pr, 'rear', [(-0.8, 0.42), (0.8, 0.42)], 0.1, 'black', 0.003)
    if res:
        # Doors: the front one, the sliding one with its rail running back under the rear quarter
        # glass, the sills; bonnet and tailgate; handles; fuel flap.
        rear_arch = arch_pts(xr, R, R + 0.1, 62, 6, 6)
        gaps(o, pr, [
            [(1.45, 1.0), (1.47, 0.75), (1.42, 0.5), (1.38, 0.36)],
            [(0.0, 1.04), (0.0, 0.36)],
            [(-1.12, 1.03), (-1.12, 0.76)] + rear_arch,
            [(1.38, 0.36), (xr + R + 0.1, 0.36)],
        ])
        line(o, pr, 'side', [(-1.1, 0.94), (-2.25, 0.93)], 0.03, 'black', 0.004, both=True)
        line(o, pr, 'side', [(-1.1, 0.94), (-2.25, 0.93)], 0.008, 'chrome', 0.007, both=True)
        gaps(o, pr, [[(1.6, 0.8), (2.1, 0.74), (2.45, 0.56)]], frame='top')
        gaps(o, pr, [[(-0.72, 1.3), (-0.72, 0.62), (0.72, 0.62), (0.72, 1.3)]], frame='rear', both=False)
        for (x, z) in ((0.2, 0.93), (-0.25, 0.93)):
            handle(o, pr, x, z, 'chrome')
        line(o, pr, 'side', rounded(rrect_pts((-1.95, 0.82), 0.17, 0.12, 0.03, 2), 1), 0.006, 'gap', 0.0015, closed=True)
        line(o, pr, 'side', [(1.1, 0.42), (xr + R + 0.12, 0.42)], 0.05, 'black', 0.004, both=True)
        # Chrome along the bottom of the glass, roof rails.
        line(o, prg, 'side', along(p['shoulder'], 1.25, -1.1, 12, -0.004), 0.014, 'chrome', 0.004, both=True)
        for s in (1, -1):
            o.body.extend(rbox((-0.9, s * 0.62, (p['roof_z'](-0.9) + p['rail_z'](-0.9)) / 2 + 0.03), (1.0, 0.025, 0.02), 0.012, 'black', 1))
    cx = p['ws_base'] - 0.03
    line(o, pr, 'top', [(cx, -0.82), (cx, 0.82)], 0.08, 'black', 0.003)
    if res:
        for (a, b) in ((0.6, -0.05), (0.0, -0.66)):
            o.body.extend(tube([Vector((cx - 0.03, a, p['roof_z'](cx - 0.03) + 0.01)), Vector((cx - 0.09, b, p['roof_z'](cx - 0.09) + 0.012))], 0.007, 'black', 4))
        o.body.extend(rbox((-2.16, 0, p['roof_z'](-2.16) + 0.0), (0.12, 0.6, 0.014), 0.008, 'paint', 1))


@car
def minivan(res):
    return closed_car(res, minivan_params())
