"""
The fast cars: the Viper GT (a rear-engined sports coupe with a sloping fastback, lamps on
the wings, wide hips and a rear wing), the Thunder Muscle (a late-sixties fastback muscle
car with a long bonnet and scoop, chrome bumpers, quad lamps, twin stripes and a ducktail)
and the Golden Hypercar (a low mid-engined wedge with a cab-forward glasshouse, big side
intakes, engine-cover vents, a big wing and diffuser, and centre-lock wheels).
"""
import math

from mathutils import Matrix, Vector

import carkit as K
from carkit import C, const, lerp, bump, rbox, cyl, tube, prism, lathe, rrect_pts, circle_pts, ccw, chaikin, Mesh
from carbody import Hull, Glasshouse, Projector, aim, patch, strip, cut, arch_cutter
import carparts as P
from carcommon import (car, Out, wheels_into, cabin_meta, lamp, flat, line, gaps, handle, plate,
                       rounded, arch_pts, along)

# The muscle car's stripes: a fixed colour of their own (the game only repaints 'paint').
K.REGIONS.setdefault('stripe', ((1.0, 0.64, 0.047), 0.25, 0.2))


class Body(Hull):
    """
    The Hull with a shapelier top: more points across the bonnet and deck, a crown exponent
    per station (2 is the Hull's parabola; higher keeps the middle flat and drops the sides
    away, as between raised wings), and an optional `lift(x, y)` added to the top's height.
    """

    def __init__(self, *a, crown=None, ntop=7, lift=None, **kw):
        super().__init__(*a, **kw)
        self.crown = crown
        self.ntop = ntop
        self.lift = lift

    def half(self, x, f=None, res=1, closed=False):
        if f is None:
            f = self.factor(x)
        zb, zs, zt = self.bottom(x), self.shoulder(x), self.top(x)
        w = self.width(x) * f
        tuck = self.tuck(x) * f
        tum = self.tumble(x) * f
        wl, wt = w - tuck, w - tum
        rb = max(0.004, min(self.rb(x), wl * 0.45, (zs - zb) * 0.3))
        rs = max(0.004, min(self.rs(x), wt * 0.45, (zs - zb) * 0.3))
        zc = zb + (zs - zb) * self.cfrac(x)
        nt = self.ntop if res else 3
        pts, lab = [], []

        def add(p, label):
            pts.append(Vector(p))
            lab.append(label)

        add((0.0, zb), 'bot')
        for a in ((0.0, 0.5) if res else (0.0,)):
            a = -math.pi / 2 + math.pi / 2 * a
            add((wl - rb + rb * math.cos(a), zb + rb + rb * math.sin(a)), 'sill')
        h = max(1e-3, zc - zb - rb)
        sup = min(0.4, 0.012 / h)
        for s in ((0.0, 0.5, 1 - sup) if res else (0.0, 0.6)):
            add((wl + (w - wl) * math.sin(s * math.pi / 2), lerp(zb + rb, zc, s)), 'low')
        h2 = max(1e-3, zs - rs - zc)
        sup2 = min(0.4, 0.012 / h2)
        for s in ((0.0, sup2, 0.55) if res else (0.0, 0.5)):
            add((w - (w - wt) * s, lerp(zc, zs - rs, s)), 'up')
        for a in ((0.0, 0.5) if res else (0.0,)):
            a = math.pi / 2 * a
            add((wt - rs + rs * math.cos(a), zs - rs + rs * math.sin(a)), 'sh')
        ye = wt - rs
        fl = None if closed else self.floor_at(x)
        e = self.crown(x) if self.crown else 2.0
        if fl is None:
            for k in range(nt):
                u = k / nt
                y = ye * (1 - u)
                z = zs + (zt - zs) * (1 - (y / max(1e-6, ye)) ** e)
                if self.lift:
                    z += self.lift(x, y)
                add((y, z), 'top')
            add((0.0, zt + (self.lift(x, 0.0) if self.lift else 0.0)), 'top')
        else:
            li = self.lip * min(1.0, f * 1.5)
            prof = [(ye, zs, 'lip'), (ye - li, zs - 0.004, 'in'), (ye - li - 0.012, zs - 0.05, 'in'), (ye - li - 0.02, fl + 0.05, 'in')]
            rest = nt - len(prof)
            y0 = ye - li - 0.06
            for k in range(rest):
                prof.append((y0 * (1 - k / max(1, rest)), fl, 'in'))
            for (y, z, l) in prof[:nt]:
                add((y, z), l)
            add((0.0, fl), 'in')
        for (xc, hx, amt, zc2, hz) in self.flares:
            kx = bump(x, xc, hx)
            if kx <= 0:
                continue
            for i, p in enumerate(pts):
                if lab[i] in ('low', 'up', 'sh', 'sill') or (lab[i] == 'top' and p.x > ye * 0.75):
                    pts[i] = Vector((p.x + amt * kx * f * bump(p.y, zc2, hz), p.y))
        return pts, lab


# ------------------------------------------------------------------ the builder

def fast_car(res, p):
    """
    Like carcommon.closed_car, with what these cars need on top: a narrower glasshouse than
    the hips (base_w), extra boolean cutters (intakes) cut with the arches, arches sized per
    axle, sports seats and their own wheels.
    """
    L, W = p['L'], p['W']
    xf, xr = p['xf'], p['xr']
    R = p['R']
    Rr = p.get('R_rear', R)
    o = Out()
    x0, x1 = -L / 2, L / 2
    gh_x0, gh_x1 = p['bl_base'], p['ws_base']
    opens = list(p['open'])
    extra_region = p.get('hull_region')
    hull = None

    def base_w(x):
        e = hull.edge_y(x) - p['inset']
        bw = p.get('base_w')
        return min(e, bw(x)) if bw else e

    def hull_region(i):
        seg, x, c = i['seg'], i['x'], i['c']
        if extra_region:
            r = extra_region(i, hull)
            if r:
                return r
        if seg == 'bot':
            return 'black'
        if seg == 'in':
            return 'interior'
        if seg == 'top' and gh_x0 + 0.01 < x < gh_x1 - 0.01 and abs(c.y) < base_w(x) - 0.01:
            return 'interior'
        return None

    hull = Body(x0, x1, p['bottom'], p['shoulder'], p['top'], p['width'], tuck=p['tuck'], tumble=p['tumble'],
                cfrac=p['cfrac'], rb=p['rb'], rs=p['rs'], front=p['front'], rear=p['rear'],
                open=opens, flares=p.get('flares', []), keys=[xf, xr, gh_x0, gh_x1] + p.get('keys', []),
                region=hull_region, lip=p.get('lip', 0.035), fmin=p.get('fmin', 0.05),
                crown=p.get('crown'), ntop=p.get('ntop', 7), lift=p.get('lift'))
    hm = hull.build(res)
    y_in = p.get('arch_in', p['track'] / 2 - p['tyre_w'] / 2 - 0.05)
    cutters = []
    for (x, zc, ra, fl) in ((xf, R, R + p['arch_gap'], p.get('arch_flat', 0.0)),
                            (xr, Rr, Rr + p.get('arch_gap_rear', p['arch_gap']), p.get('arch_flat_rear', p.get('arch_flat', 0.0)))):
        for s in (1, -1):
            y0, y1 = (y_in, W / 2 + 0.4) if s > 0 else (-W / 2 - 0.4, -y_in)
            cutters.append(arch_cutter(x, zc, ra, y0, y1, fl, 32 if res else 14))
    if p.get('cutters'):
        cutters += p['cutters'](res, hull)
    hm = cut(hm, cutters, 'arch')
    o.body.extend(hm)
    pr = Projector(hm)
    gh = Glasshouse(hull, gh_x0, gh_x1, p['rail_w'], p['rail_z'], p['roof_z'], corner=p['corner'], inset=const(p['inset']),
                    lines=p['lines'], region=p['glass_region'], between=p.get('between', 1),
                    front=p.get('gh_front'), rear=p.get('gh_rear'), bulge=p.get('bulge', 0.012),
                    base_drop=p.get('base_drop', 0.025), base_w=base_w)
    gm = gh.build(res, shell=bool(res))
    o.body.extend(gm)
    prg = Projector(hm, gm)

    # Interior: dashboard, two bucket seats, the console and the steering wheel.
    dy = p['driver_y']
    hip_f = p['hip_f']
    if res:
        d = p['dash']
        o.body.extend(P.dashboard(d[0], d[1], d[2], d[4], d[3], dy, p.get('dash_region', 'interior')))
        sr = p.get('seat_region', 'seat')
        for s in (1, -1):
            o.body.extend(P.seat(hip_f[0] + 0.04, s * dy, hip_f[1] - 0.09, p.get('seat_w', 0.5), 0.5, p.get('seat_back', 0.62),
                                 p.get('recline', 0.36), sr, head=p.get('headrests', True)))
        for (x, w, z) in p.get('benches', []):
            o.body.extend(P.bench(x + 0.04, w, z - 0.09, 0.42, 0.5, 0.3, sr, head=False))
        o.body.extend(P.console(hip_f[0] + 0.5, hip_f[0] - 0.12, opens[0][2], hip_f[1] - 0.02))
        sw = p['wheel_c']
        o.body.extend(P.steering_wheel((sw[0], dy, sw[1]), p.get('wheel_tilt', 0.42), p.get('wheel_r', 0.18), region=p.get('wheel_region', 'black')))
    cabin_meta(o, [(hip_f[0], dy, hip_f[1]), (hip_f[0], -dy, hip_f[1])], (hip_f[0] + 0.1, dy, hip_f[1] + p.get('eye_up', 0.69)))

    if p.get('mirror'):
        o.body.extend(P.mirror(p['mirror'], region=p.get('mirror_region', 'paint'), res=res, out=p.get('mirror_out', 0.17),
                               h=p.get('mirror_h', 0.11), l=p.get('mirror_l', 0.15)).both())

    p['decor'](o, res, pr, prg, hull, p)

    wf, wr = p['wheels'](res)
    wheels_into(o, res, (xf, xr), p['track'], R, wf, wr, Rr, p.get('track_rear'))
    o.meta['dims'] = [L, W, round(p['roof_z'](p.get('roof_x', 0.0)), 3)]
    o.meta['color'] = p['color']
    if not res:
        o.body.recolor('gloss', only='glass')
    return o


# ------------------------------------------------------------------ shared helpers

def wing_section(chord, thick, n=8):
    """An aerofoil outline in (x, z) round (0, 0): leading edge at +x/2, flat-ish underside."""
    top, bot = [], []
    for k in range(n + 1):
        t = k / n
        x = chord / 2 - chord * t
        yt = thick * (1.4 * math.sqrt(t) - 1.1 * t - 0.3 * t * t)
        top.append((x, max(0.0, yt) * 1.0 + 0.0))
        bot.append((x, -max(0.0, yt) * 0.35))
    return top + list(reversed(bot[1:-1]))


def aerofoil(x, z, chord, thick, y0, y1, pitch, region):
    """A wing element across the car from y0 to y1, its trailing edge raised by `pitch` (radians)."""
    pts = wing_section(chord, thick)
    c, s = math.cos(pitch), math.sin(pitch)
    pts = [(x + px * c + pz * s, z - px * s + pz * c) for (px, pz) in pts]
    return prism(pts, y0, y1, region)


def louvres(o, pr, frame, x0, x1, y0, y1, n, region='gloss', width=0.012, lift=0.006, along_x=True):
    """Parallel slats laid on the surface (engine covers, vents)."""
    for k in range(n):
        t = (k + 0.5) / n
        if along_x:
            y = y0 + (y1 - y0) * t
            line(o, pr, frame, [(x0, y), (x1, y)], width, region, lift)
        else:
            x = x0 + (x1 - x0) * t
            line(o, pr, frame, [(x, y0), (x, y1)], width, region, lift)


# ------------------------------------------------------------------ Viper GT

def sports_params():
    L, W = 4.5, 1.9
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.24, -1.21
    R, Rr = 0.342, 0.358
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, R_rear=Rr, tyre_w=0.245, track=1.56, track_rear=1.55, arch_gap=0.04, color=0x2bd96b,
        bottom=C((x0, 0.38), (x0 + 0.08, 0.27), (x0 + 0.35, 0.18), (xr, 0.13), (xf, 0.12), (xf + 0.45, 0.15), (x1 - 0.12, 0.2), (x1, 0.28)),
        shoulder=C((x0, 0.76), (x0 + 0.04, 0.83), (x0 + 0.14, 0.87), (-1.95, 0.915), (-1.65, 0.94), (xr - 0.05, 0.945), (-0.95, 0.905), (-0.3, 0.86),
                   (0.66, 0.84), (xf, 0.8), (1.6, 0.775), (1.9, 0.74), (2.06, 0.685), (x1 - 0.08, 0.56), (x1 - 0.02, 0.46), (x1, 0.4)),
        top=C((x0, 0.8), (x0 + 0.04, 0.86), (x0 + 0.14, 0.9), (-1.95, 0.955), (-1.62, 1.04), (-1.2, 1.0), (0.66, 0.815),
              (xf, 0.7), (1.6, 0.63), (1.9, 0.57), (2.08, 0.515), (x1 - 0.06, 0.465), (x1, 0.41)),
        crown=C((x0, 2.0), (-1.7, 2.0), (0.66, 2.5), (xf, 3.5), (1.9, 4.0), (x1, 3.0)),
        width=C((x0, 0.875), (x0 + 0.3, 0.935), (xr, 0.95), (-0.7, 0.925), (-0.1, 0.9), (0.6, 0.905), (xf, 0.915), (x1 - 0.3, 0.9), (x1, 0.86)),
        tuck=const(0.06), tumble=C((x0, 0.13), (xr, 0.13), (-0.4, 0.1), (0.6, 0.1), (xf, 0.12), (x1, 0.12)),
        cfrac=const(0.55), rb=const(0.05), rs=C((x0, 0.08), (xr, 0.1), (-0.4, 0.07), (0.6, 0.07), (xf, 0.075), (x1, 0.07)),
        front=(0.55, 2.3), rear=(0.5, 2.4),
        flares=[(xf, 0.55, 0.02, 0.45, 0.32), (xr, 0.75, 0.035, 0.6, 0.34)],
        open=[(-1.0, 0.5, 0.21)],
        bl_base=-1.62, ws_base=0.66, inset=0.03,
        roof_z=C((-1.62, 1.035), (-1.35, 1.1), (-1.05, 1.175), (-0.75, 1.235), (-0.45, 1.275), (-0.2, 1.29), (0.02, 1.27), (0.22, 1.19), (0.44, 1.03), (0.66, 0.855)),
        rail_z=C((-1.62, 1.025), (-1.35, 1.08), (-1.05, 1.145), (-0.75, 1.195), (-0.45, 1.23), (-0.2, 1.245), (0.02, 1.225), (0.22, 1.15), (0.44, 1.0), (0.66, 0.845)),
        rail_w=C((-1.62, 0.48), (-1.2, 0.54), (-0.6, 0.56), (0.0, 0.58), (0.35, 0.64), (0.66, 0.71)),
        base_w=C((-1.62, 0.56), (-1.25, 0.63), (-0.7, 0.69), (0.0, 0.71), (0.66, 0.72)),
        corner=C((-1.0, 0.07), (-0.3, 0.07), (0.3, 0.05)),
        lines=[(-1.2, -0.92), (-0.5, -0.53), (-0.45, -0.48), (0.5, 0.48)], between=2,
        driver_y=0.36, hip_f=(-0.42, 0.38), benches=[(-0.98, 1.1, 0.4)],
        dash=(0.62, 0.2, 0.72, 0.5, 0.8), wheel_c=(0.06, 0.74), wheel_r=0.18,
        mirror=(0.47, 0.76, 0.85), mirror_out=0.15, mirror_h=0.085, mirror_l=0.15, roof_x=-0.3,
    )

    def glass_region(i):
        seg, xb, xr_ = i['seg'], i['xb'], i['xr']
        if seg == 'side':
            if i['zone'] == 'front' or xb > 0.5:
                return 'black'
            if -0.5 < xb < -0.45:
                return 'black'
            if xb < -1.2:
                return 'paint'
            return 'glass'
        if seg == 'corner':
            return 'paint'
        if xr_ > 0.02 or xr_ < -0.92:
            return 'glass'
        return 'paint'

    p['glass_region'] = glass_region
    p['decor'] = sports_decor

    def wheels(res):
        seg = 22 if res else 8
        wf = P.wheel(R, 0.245, 'twin', 'road', 0.74, seg, res, 5)
        wr = P.wheel(Rr, 0.305, 'twin', 'road', 0.76, seg, res, 5)
        return wf, wr

    p['wheels'] = wheels
    return p


def sports_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R, Rr = p['xf'], p['xr'], p['R'], p['R_rear']
    # Headlamps: upright ovals on the front of the wings, a ring and four light dots in each.
    hf = aim((2.0, 0.6, 0.63), 0.22, 0.42)
    head = [(0.125 * math.cos(a), 0.095 * math.sin(a)) for a in (2 * math.pi * k / 16 for k in range(16))]
    head = [(s * math.cos(0.25) - t * math.sin(0.25), s * math.sin(0.25) + t * math.cos(0.25)) for (s, t) in head]
    lamp(o, pr, hf, head, 'head', res, 'gloss', 0.012, 0.006, bw=0.014)
    if res:
        lamp(o, pr, hf, circle_pts((0.0, 0.0), 0.05, 12), 'chrome', res, 'gloss', 0.006, 0.022, bw=0.008, rings=2)
        for k in range(4):
            a = math.pi / 4 + k * math.pi / 2
            lamp(o, pr, hf, circle_pts((0.075 * math.cos(a), 0.058 * math.sin(a)), 0.011, 6), 'white', res, None, 0.0, 0.024, rings=1)
    # The bumper: a slim centre intake, big corner intakes with light strips above them.
    flat(o, pr, 'front', rounded([(-0.34, 0.235), (0.34, 0.235), (0.3, 0.32), (-0.3, 0.32)], 1), 'grille', 0.004,
         bezel=(0.012, 'gloss', 0.003), res=res)
    if res:
        for z in (0.26, 0.29):
            line(o, pr, 'front', [(-0.31, z), (0.31, z)], 0.008, 'gloss', 0.007)
    side = aim((x1 - 0.12, 0.62, 0.3), 0.45, 0.0)
    flat(o, pr, side, rounded([(-0.17, -0.1), (0.15, -0.1), (0.19, 0.05), (0.12, 0.085), (-0.16, 0.06)], 1), 'grille', 0.004,
         both=True, bezel=(0.012, 'gloss', 0.003), res=res)
    lamp(o, pr, side, [(-0.15, 0.1), (0.11, 0.115), (0.11, 0.128), (-0.15, 0.115)], 'amber', res, None, 0.002, 0.005)
    if res:
        for z in (-0.06, -0.025, 0.01, 0.045):
            line(o, pr, side, [(-0.15, z), (0.15, z + 0.01)], 0.007, 'gloss', 0.007, both=True)
    plate(o, pr, 'front', (0.0, 0.405), w=0.3, h=0.11)
    line(o, pr, 'front', [(-0.75, 0.205), (0.75, 0.205)], 0.04, 'black', 0.003)

    # Tail: the lamp bar right across, wrapping round the corners; the engine grille above it.
    tf = aim((x0 + 0.16, 0.7, 0.8), math.pi - 0.8, 0.05)
    lamp(o, pr, tf, [(0.2, -0.03), (0.2, 0.018), (-0.08, 0.03), (-0.2, 0.024), (-0.2, -0.012), (-0.08, -0.03)], 'tail', res, 'gloss', 0.004, 0.006, bw=0.008)
    lamp(o, pr, 'rear', [(-0.62, 0.79), (0.62, 0.79), (0.62, 0.806), (-0.62, 0.806)], 'tail', res, 'gloss', 0.0, 0.006, both=False, bw=0.01, rings=1)
    if res:
        line(o, pr, 'rear', [(-0.62, 0.798), (0.62, 0.798)], 0.004, 'red', 0.008)
    plate(o, pr, 'rear', (0.0, 0.57), w=0.31, h=0.13)
    # Engine-lid grille: longitudinal slats between the rear window and the tail, a brake light.
    eg = rounded([(-1.68, -0.36), (-1.68, 0.36), (-2.04, 0.32), (-2.04, -0.32)], 1)
    flat(o, pr, 'top', eg, 'grille', 0.004, bezel=(0.012, 'gloss', 0.003), res=res)
    if res:
        louvres(o, pr, 'top', -1.7, -2.02, -0.32, 0.32, 14, 'gloss', 0.012, 0.008)
        lamp(o, pr, 'top', [(-1.645, -0.2), (-1.645, 0.2), (-1.66, 0.2), (-1.66, -0.2)], 'tail', res, None, 0.0, 0.009, both=False, rings=1)
    # Rear bumper: the diffuser and twin tailpipes each side.
    flat(o, pr, 'rear', rounded([(-0.64, 0.355), (-0.6, 0.21), (0.6, 0.21), (0.64, 0.355)], 1), 'black', 0.003, res=res, rings=1)
    if res:
        for s in (1, -1):
            for y in (0.27, 0.37):
                o.body.extend(cyl((x0 + 0.1, s * y, 0.3), (x0 - 0.035, s * y, 0.3), 0.04, 'chrome', 12, caps=False))
                o.body.extend(cyl((x0 - 0.03, s * y, 0.3), (x0 - 0.02, s * y, 0.3), 0.033, 'gap', 10))
        for y in (-0.15, -0.05, 0.05, 0.15):
            line(o, pr, 'rear', [(y, 0.26), (y, 0.34)], 0.012, 'gloss', 0.006)

    # Rear wing on two swan-neck uprights from the engine lid, end plates on its tips.
    wz = 1.1
    o.body.extend(aerofoil(-2.02, wz, 0.3, 0.075, -0.7, 0.7, 0.14, 'gloss'))
    for s in (1, -1):
        o.body.extend(rbox((-2.03, s * 0.705, wz - 0.01), (0.17, 0.006, 0.06), 0.005, 'gloss', 1))
        up = hull.surface_z(-1.86, 0.3) - 0.02
        neck = [(-1.8, up), (-1.93, up), (-1.97, wz - 0.02), (-1.95, wz + 0.04), (-2.0, wz + 0.05), (-2.02, wz + 0.02), (-2.03, wz + 0.01),
                (-1.98, wz + 0.01), (-1.9, wz - 0.03)]
        o.body.extend(prism(neck, s * 0.3 - 0.012, s * 0.3 + 0.012, 'gloss'))

    if res:
        # Panel gaps: the long door, the front lid between the wings, the engine lid, the fuel flap.
        gaps(o, pr, [
            [(0.63, 0.83), (0.65, 0.62), (0.62, 0.42), (0.58, 0.27)],
            [(-0.62, 0.86), (-0.66, 0.6), (-0.7, 0.42), (-0.72, 0.27)],
            [(0.58, 0.27), (-0.72, 0.27)],
        ])
        gaps(o, pr, [[(0.62, 0.55), (1.5, 0.5), (1.93, 0.42), (2.13, 0.25), (2.17, 0.0)]], frame='top')
        gaps(o, pr, [[(-1.65, 0.4), (-2.12, 0.38), (-2.16, 0.0)]], frame='top')
        line(o, pr, 'side', rounded(rrect_pts((1.5, 0.735), 0.11, 0.07, 0.02, 2), 1), 0.005, 'gap', 0.0015, closed=True)
        handle(o, pr, -0.42, 0.75, 'paint', w=0.15, h=0.026)
        # The sills: a black skirt between the wheels.
        line(o, pr, 'side', [(xf - R - 0.06, 0.2), (xr + Rr + 0.08, 0.2)], 0.06, 'black', 0.003, both=True)
        # Trim along the bottom of the side windows.
        line(o, prg, 'side', along(p['shoulder'], 0.5, -1.18, 12, 0.012), 0.012, 'gloss', 0.004, both=True)
    # Black cowl under the windscreen, wipers on it.
    cx = p['ws_base'] - 0.03
    line(o, pr, 'top', [(cx, -0.7), (cx, 0.7)], 0.06, 'black', 0.003)
    if res:
        for (a, b) in ((0.5, -0.05), (-0.04, -0.58)):
            o.body.extend(tube([Vector((cx - 0.02, a, p['roof_z'](cx - 0.02) + 0.01)), Vector((cx - 0.06, b, p['roof_z'](cx - 0.06) + 0.012))], 0.006, 'black', 4))


@car
def sports(res):
    return fast_car(res, sports_params())
