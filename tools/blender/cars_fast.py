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

    if not p.get('wing', True):
        # The Carrera: just the extending spoiler lip across the end of the engine lid.
        zt = hull.surface_z(x0 + 0.14, 0.0)
        o.body.extend(prism([(x0 + 0.3, zt - 0.01), (x0 + 0.3, zt + 0.012), (x0 + 0.13, zt + 0.028), (x0 + 0.12, zt + 0.0), (x0 + 0.15, zt - 0.03)], -0.6, 0.6, 'paint'))
    # Rear wing on two swan-neck uprights from the engine lid, end plates on its tips.
    wz = 1.1
    if p.get('wing', True):
        o.body.extend(aerofoil(-2.02, wz, 0.3, 0.075, -0.7, 0.7, 0.14, 'gloss'))
    for s in ((1, -1) if p.get('wing', True) else ()):
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


@car
def p911(res):
    """The Carrera itself: the same rear-engined coupe without the big wing, ten-spoke wheels."""
    p = sports_params()
    p['color'] = 0xc0c4ca
    p['wing'] = False
    R, Rr = p['R'], p['R_rear']

    def wheels(res):
        seg = 22 if res else 8
        return P.wheel(R, 0.245, 'multi', 'road', 0.74, seg, res, 5), P.wheel(Rr, 0.305, 'multi', 'road', 0.76, seg, res, 5)

    p['wheels'] = wheels
    return fast_car(res, p)


# ------------------------------------------------------------------ Thunder Muscle

def muscle_params():
    L, W = 4.8, 1.88
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.42, -1.32
    R = 0.335
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.235, track=1.54, arch_gap=0.055, arch_flat=0.25, color=0x1f1f24,
        bottom=C((x0, 0.36), (x0 + 0.12, 0.27), (x0 + 0.4, 0.22), (xr, 0.17), (xf, 0.17), (xf + 0.5, 0.2), (x1 - 0.12, 0.24), (x1, 0.28)),
        shoulder=C((x0, 0.86), (x0 + 0.03, 0.925), (x0 + 0.12, 0.955), (-1.9, 0.96), (xr, 0.955), (-0.6, 0.915), (0.55, 0.89),
                   (xf, 0.865), (2.1, 0.84), (x1 - 0.05, 0.825), (x1, 0.76)),
        top=C((x0, 0.9), (x0 + 0.03, 0.975), (x0 + 0.07, 1.0), (x0 + 0.25, 0.985), (-1.75, 0.99), (-1.2, 1.0), (0.55, 0.9),
              (xf, 0.875), (2.1, 0.85), (x1 - 0.04, 0.835), (x1, 0.79)),
        width=C((x0, 0.91), (xr - 0.3, 0.93), (xr, 0.94), (-0.5, 0.925), (0.5, 0.925), (xf, 0.93), (x1 - 0.2, 0.925), (x1, 0.915)),
        tuck=const(0.09), tumble=const(0.05),
        cfrac=C((x0, 0.8), (xr, 0.78), (0.0, 0.8), (xf, 0.8), (x1, 0.82)),
        rb=const(0.07), rs=const(0.035),
        front=(0.26, 3.6), rear=(0.22, 3.6),
        flares=[(xf, 0.55, 0.012, 0.66, 0.3), (xr, 0.8, 0.03, 0.72, 0.3)],
        open=[(-1.1, 0.42, 0.25)],
        bl_base=-1.75, ws_base=0.55, inset=0.035,
        roof_z=C((-1.75, 0.985), (-1.4, 1.07), (-1.05, 1.155), (-0.7, 1.24), (-0.45, 1.285), (-0.2, 1.3), (0.0, 1.285), (0.2, 1.19), (0.38, 1.06), (0.55, 0.92)),
        rail_z=C((-1.75, 0.975), (-1.4, 1.05), (-1.05, 1.128), (-0.7, 1.205), (-0.45, 1.247), (-0.2, 1.26), (0.0, 1.245), (0.2, 1.155), (0.38, 1.04), (0.55, 0.905)),
        rail_w=C((-1.75, 0.6), (-1.2, 0.66), (-0.6, 0.67), (0.0, 0.68), (0.55, 0.79)),
        corner=C((-1.0, 0.05), (0.0, 0.045), (0.4, 0.035)),
        lines=[(-1.08, -0.86), (-0.6, -0.6), (-0.565, -0.565), (0.45, 0.43)], between=2,
        driver_y=0.37, hip_f=(-0.42, 0.44), benches=[(-1.05, 1.15, 0.46)],
        dash=(0.6, 0.22, 0.75, 0.55, 0.88), wheel_c=(0.04, 0.82), wheel_r=0.19, wheel_tilt=0.5,
        roof_x=-0.2, ntop=7,
    )

    def glass_region(i):
        seg, xb, xr_, k = i['seg'], i['xb'], i['xr'], i['k']
        if seg == 'side':
            if i['zone'] == 'front' or xb > 0.45:
                return 'black'
            if -0.6 < xb < -0.565:
                return 'chrome'
            if xb < -1.08:
                return 'paint'
            return 'glass'
        if seg == 'corner':
            return 'paint'
        if xr_ > 0.0:
            return 'glass'
        if xr_ < -0.78:
            # The back window, narrower than the roof between the sail panels.
            return 'paint' if k <= 4 else 'glass'
        return 'paint'

    p['glass_region'] = glass_region
    p['decor'] = muscle_decor

    def cutters(res, hull):
        # The grille: a recess right across the nose.
        g = rrect_pts((0.0, 0.625), 1.46, 0.25, 0.04, 2)
        out = []
        m = Mesh()
        a = [m.vert((x1 - 0.085, s, t)) for (s, t) in g]
        b = [m.vert((x1 + 0.4, s, t)) for (s, t) in g]
        n = len(g)
        for k in range(n):
            k2 = (k + 1) % n
            m.face((a[k], a[k2], b[k2], b[k]), 'grille')
        m.face(list(reversed(a)), 'grille')
        m.face(b, 'grille')
        K._orient(m, (x1, 0, 0.625))
        out.append(m)
        return out

    p['cutters'] = cutters

    def wheels(res):
        seg = 22 if res else 8
        w = P.wheel(R, 0.235, 'slot', 'road', 0.6, seg, res)
        return w, None

    p['wheels'] = wheels
    return p


def bullet_mirror(x, y, z, res):
    """A round chrome door mirror on a short stalk (left side)."""
    m = Mesh()
    m.extend(cyl((x, y - 0.01, z), (x - 0.01, y + 0.07, z + 0.05), 0.012, 'chrome', 6))
    head = lathe([(0.0, -0.05), (0.04, -0.045), (0.058, -0.02), (0.06, 0.0), (0.06, 0.012)], 'chrome', 14 if res else 6,
                 axis=(1, 0, 0), c=(x - 0.02, y + 0.075, z + 0.065))
    m.extend(head)
    g = Mesh()
    ids = [g.vert((x - 0.02 - 0.013, y + 0.075 + 0.055 * math.cos(2 * math.pi * k / 12), z + 0.065 + 0.055 * math.sin(2 * math.pi * k / 12))) for k in range(12)]
    g.face(ids, 'mirror')
    K._orient(g, (x + 0.1, y + 0.075, z + 0.065))
    m.extend(g)
    return m


def blade(x, z, half_w, h, d, wrap, region='chrome', sign=1, res=1, ends=0.16):
    """One continuous blade bumper across the car at x (sign +1 at the front), its ends wrapping back."""
    n = 14 if res else 6
    path = [Vector((x - sign * (wrap + ends), -half_w - 0.015, z))]
    for k in range(n + 1):
        y = -half_w + 2 * half_w * k / n
        path.append(Vector((x - sign * wrap * (abs(y) / half_w) ** 4, y, z)))
    path.append(Vector((x - sign * (wrap + ends), half_w + 0.015, z)))
    r = min(h, d) * 0.4
    sec = [(u, v) for (u, v) in rrect_pts((0.0, 0.0), d, h, r, 2 if res else 1)]
    m = Mesh()
    rings = []
    for i, pt in enumerate(path):
        t = path[min(len(path) - 1, i + 1)] - path[max(0, i - 1)]
        t.z = 0
        t.normalize()
        nrm = Vector((t.y, -t.x, 0))
        if nrm.dot(Vector((pt.x, pt.y, 0))) < 0:
            nrm = -nrm
        rings.append([m.vert(pt + nrm * u + Vector((0, 0, v))) for (u, v) in sec])
    ns = len(sec)
    for i in range(len(rings) - 1):
        for j in range(ns):
            j2 = (j + 1) % ns
            m.face((rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]), region)
    for ring, pt in ((rings[0], path[0]), (rings[-1], path[-1])):
        c = m.vert(pt)
        for j in range(ns):
            m.face((c, ring[j], ring[(j + 1) % ns]), region)
    for i, f in enumerate(m.f):
        cen = sum((m.v[j] for j in f), Vector()) / len(f)
        best = min(path, key=lambda q: (q - cen).length)
        if K._fnormal(m, f).dot(cen - best) < 0:
            m.f[i] = tuple(reversed(f))
    return m


def muscle_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    # The bonnet scoop: a raised intake on the middle of the bonnet, open at the front.
    zb = hull.surface_z(1.3, 0.0)
    slope = math.atan2(hull.surface_z(1.0, 0.0) - hull.surface_z(1.6, 0.0), 0.6)
    M = Matrix.Translation((1.3, 0.0, zb + 0.01)) @ Matrix.Rotation(slope, 4, 'Y')
    scoop = rbox((0, 0, 0), (0.3, 0.16, 0.055), 0.045, 'paint', 2 if res else 1, M)
    o.body.extend(scoop)
    o.body.extend(rbox((0.262, 0, 0.012), (0.04, 0.125, 0.027), 0.012, 'grille', 1, M))
    # The ducktail: a lip along the end of the deck.
    zt = hull.surface_z(x0 + 0.07, 0.0)
    duck = prism([(x0 + 0.22, zt - 0.03), (x0 + 0.22, zt - 0.01), (x0 + 0.05, zt + 0.03), (x0 + 0.015, zt + 0.028), (x0 + 0.03, zt - 0.03)], -0.7, 0.7, 'paint')
    o.body.extend(duck)
    ps = Projector(o.body)
    # Twin stripes over the bonnet (and the scoop), the roof and the deck lid (and the lip).
    for (y0, y1) in ((0.05, 0.27),):
        yc, w = (y0 + y1) / 2, y1 - y0
        for (a, b, proj) in ((x1 - 0.04, 0.6, ps), (-0.02, -0.76, prg), (-1.8, x0 + 0.02, ps)):
            n = max(2, int(abs(a - b) / 0.06))
            pts = [(a + (b - a) * k / n, yc) for k in range(n + 1)]
            line(o, proj, 'top', pts, w, 'stripe', 0.0035, both=True)

    # The grille in its recess: quad lamps in chrome rings, a chrome surround, a fine mesh.
    if res:
        for z in (0.56, 0.6, 0.65, 0.69):
            line(o, pr, 'front', [(-0.68, z), (0.68, z)], 0.006, 'gloss', 0.01)
        for y in (-0.2, -0.1, 0.0, 0.1, 0.2):
            line(o, pr, 'front', [(y, 0.52), (y, 0.73)], 0.006, 'gloss', 0.01)
    for s in (0.6, 0.4):
        lamp(o, pr, 'front', circle_pts((s, 0.625), 0.072, 14), 'head', res, 'chrome', 0.012, 0.012, bw=0.016)
        if res:
            lamp(o, pr, 'front', circle_pts((s, 0.625), 0.02, 8), 'chrome', res, None, 0.004, 0.026, rings=1)
    line(o, pr, 'front', rrect_pts((0.0, 0.625), 1.5, 0.29, 0.05, 2), 0.022, 'chrome', 0.004, closed=True)
    # Chrome blade bumpers wrapping round the corners, the front valance with turn signals and the plate.
    o.body.extend(blade(x1 + 0.02, 0.43, 0.88, 0.1, 0.08, 0.16, 'chrome', 1, res))
    o.body.extend(blade(x0 - 0.02, 0.47, 0.88, 0.11, 0.08, 0.13, 'chrome', -1, res))
    lamp(o, pr, 'front', rrect_pts((0.52, 0.335), 0.17, 0.045, 0.01, 1), 'amber', res, 'chrome', 0.004, 0.006, bw=0.008)
    plate(o, pr, 'front', (0.0, 0.315), w=0.3, h=0.12)

    # Tail: a black panel across with three tall lamps each side, the fuel cap in the middle.
    flat(o, pr, 'rear', rrect_pts((0.0, 0.73), 1.62, 0.2, 0.03, 2), 'black', 0.004, bezel=(0.014, 'chrome', 0.003), res=res, rings=1)
    for s in (1, -1):
        for k in range(3):
            y = s * (0.47 + k * 0.11)
            lamp(o, pr, 'rear', rrect_pts((y, 0.73), 0.075, 0.15, 0.012, 1), 'tail', res, 'chrome', 0.004, 0.008, both=False, bw=0.008, rings=1)
    if res:
        lamp(o, pr, 'rear', circle_pts((0.0, 0.73), 0.06, 14), 'chrome', res, 'gloss', 0.01, 0.01, both=False, bw=0.008)
    plate(o, pr, 'rear', (0.0, 0.335), w=0.3, h=0.13)
    if res:
        for s in (1, -1):
            o.body.extend(cyl((x0 + 0.12, s * 0.55, 0.25), (x0 - 0.02, s * 0.55, 0.25), 0.035, 'chrome', 10, caps=False))
            o.body.extend(cyl((x0 - 0.015, s * 0.55, 0.25), (x0 - 0.01, s * 0.55, 0.25), 0.03, 'gap', 8))
    # Sides: a scoop ahead of the rear wheel, marker lamps, chrome round the windows and on the sills.
    sc = aim((-0.72, 0.9, 0.66), math.pi / 2, 0.0)
    flat(o, pr, sc, [(0.09, -0.06), (0.09, 0.06), (-0.1, 0.03), (-0.1, -0.04)], 'grille', 0.004, both=True, bezel=(0.012, 'chrome', 0.003), res=res)
    lamp(o, pr, 'side', rrect_pts((x1 - 0.22, 0.6), 0.09, 0.035, 0.008, 1), 'amber', res, 'chrome', 0.002, 0.005, bw=0.006)
    lamp(o, pr, 'side', rrect_pts((x0 + 0.24, 0.62), 0.09, 0.035, 0.008, 1), 'tail', res, 'chrome', 0.002, 0.005, bw=0.006)
    if res:
        line(o, prg, 'side', along(p['shoulder'], 0.5, -1.06, 14, 0.008), 0.014, 'chrome', 0.004, both=True)
        line(o, pr, 'side', [(xf - R - 0.07, 0.25), (xr + R + 0.08, 0.25)], 0.025, 'chrome', 0.004, both=True)
        gaps(o, pr, [
            [(0.5, 0.88), (0.53, 0.65), (0.5, 0.4), (0.47, 0.25)],
            [(-0.62, 0.9), (-0.62, 0.6), (-0.63, 0.25)],
            [(0.47, 0.25), (-0.63, 0.25)],
        ])
        gaps(o, pr, [[(0.58, 0.78), (1.5, 0.79), (2.3, 0.77), (2.36, 0.0)]], frame='top')
        gaps(o, pr, [[(-1.78, 0.74), (-2.32, 0.72), (-2.36, 0.0)]], frame='top')
        handle(o, pr, -0.48, 0.8, 'chrome', w=0.14, h=0.03)
    # Mirrors: chrome bullets on the doors.
    o.body.extend(bullet_mirror(0.42, 0.85, 0.88, res).both())
    # A chrome strip across the cowl and the wipers.
    cx = p['ws_base'] - 0.03
    line(o, pr, 'top', [(cx, -0.74), (cx, 0.74)], 0.06, 'black', 0.003)
    if res:
        for (a, b) in ((0.52, -0.05), (-0.03, -0.6)):
            o.body.extend(tube([Vector((cx - 0.02, a, p['roof_z'](cx - 0.02) + 0.01)), Vector((cx - 0.06, b, p['roof_z'](cx - 0.06) + 0.012))], 0.006, 'chrome', 4))


@car
def muscle(res):
    return fast_car(res, muscle_params())


# ------------------------------------------------------------------ mid-engined cars

def centre_lock(R, w, kind, ratio, res, spokes=5, nut='chrome'):
    """A wheel with a big centre-lock nut in the middle of the spokes."""
    seg = 22 if res else 8
    m = P.wheel(R, w, kind, 'road', ratio, seg, res, spokes)
    if res:
        fz = w / 2 * 0.62
        m.extend(cyl((0, -fz + 0.01, 0), (0, -fz - 0.012, 0), 0.06, 'rim2', 12))
        m.extend(cyl((0, -fz - 0.012, 0), (0, -fz - 0.04, 0), 0.042, nut, 6))
        for k in range(3):
            a = 2 * math.pi * k / 3
            m.extend(rbox((0.05 * math.cos(a), -fz - 0.024, 0.05 * math.sin(a)), (0.022, 0.01, 0.022), 0.006, nut, 1,
                          Matrix.Rotation(-a, 4, 'Y')))
    return m


def mid_params(k):
    """
    A mid-engined car from a handful of heights and stations: the nose, the cowl under the
    windscreen, the belt at the doors, the hips over the rear wheels and the deck at the tail,
    the roof profile from the back of the cabin to the windscreen base, widths front, waist and
    rear. Each car adds its own lamps, intakes and bodywork in k['decor'].
    """
    L, W = k['L'], k['W']
    x0, x1 = -L / 2, L / 2
    xf, xr = k['xf'], k['xr']
    R, Rr = k['R'], k['Rr']
    ws, bl = k['ws'], k['bl']
    nose, cowl, belt, hip, deck, wingf = k['nose'], k['cowl'], k['belt'], k['hip'], k['deck'], k['wingf']
    dip = k.get('dip', 0.05)
    clr = k.get('clr', 0.11)
    roof = C(*k['roof'])
    zbl = roof(bl)
    Wf, Wd, Wr = k['wf'], k['wd'], k['wr']
    rp = sorted(k['roof'])
    rail = [(x, z - (0.012 if i in (0, len(rp) - 1) else k.get('rail_drop', 0.03))) for i, (x, z) in enumerate(rp)]
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, R_rear=Rr, tyre_w=k.get('tw', 0.255), track=k['track'], track_rear=k.get('track_r', k['track']),
        arch_gap=k.get('gap', 0.04), color=k['color'],
        bottom=C((x0, k.get('tail_bot', 0.32)), (x0 + 0.1, 0.22), (x0 + 0.4, clr + 0.03), (xr, clr), (xf, clr), (xf + 0.45, clr + 0.02),
                 (x1 - 0.12, clr + 0.05), (x1, clr + k.get('nose_bot', 0.1))),
        shoulder=C((x0, deck - 0.09), (x0 + 0.04, deck - 0.025), (x0 + 0.16, deck), (xr - 0.25, hip), (xr + 0.4, hip - 0.02),
                   (k.get('xdoor', -0.3), belt), (ws, cowl + 0.02), (xf, wingf), (xf + 0.45, (wingf + nose) / 2 + 0.04),
                   (x1 - 0.08, nose + 0.025), (x1, nose - 0.05)),
        top=C((x0, deck - 0.07), (x0 + 0.04, deck), (x0 + 0.16, deck + 0.015), (bl, zbl), (bl + 0.25, zbl), (ws, cowl),
              (xf, wingf - dip), (xf + 0.45, (wingf + nose) / 2 - dip * 0.5), (x1 - 0.08, nose - 0.01), (x1, nose - 0.07)),
        crown=k.get('crown', C((x0, 2.0), (ws, 2.0), (xf, 3.0), (x1, 2.5))),
        width=C((x0, Wr - 0.05), (x0 + 0.3, Wr - 0.01), (xr, Wr), (xr + 0.6, Wd + 0.02), (-0.1, Wd), (xf - 0.5, Wf - 0.01), (xf, Wf),
                (x1 - 0.25, Wf - 0.02), (x1, Wf - 0.06)),
        tuck=const(k.get('tuck', 0.05)), tumble=k.get('tumble', const(0.1)),
        cfrac=k.get('cfrac', const(0.5)), rb=const(0.04), rs=k.get('rs', const(0.05)),
        front=k.get('front', (0.45, 2.4)), rear=k.get('rear', (0.3, 3.0)),
        flares=k.get('flares', [(xf, 0.55, 0.015, 0.45, 0.3), (xr, 0.75, 0.03, 0.55, 0.32)]),
        open=[(k.get('open0', bl + 0.35), ws - 0.08, clr + 0.1)],
        bl_base=bl, ws_base=ws, inset=0.03,
        roof_z=roof, rail_z=C(*rail),
        rail_w=C((bl, k['rw'][0]), ((bl + ws) / 2 - 0.2, k['rw'][1]), (ws, k['rw'][2])),
        base_w=C((bl, k['bw'][0]), ((bl + ws) / 2, k['bw'][1]), (ws, k['bw'][2])),
        corner=const(k.get('corner', 0.05)),
        lines=[(k['qx'], k['qxr']), (ws - 0.12, ws - 0.14)], between=2,
        driver_y=0.37, hip_f=(k['hip_x'], clr + k.get('hip_up', 0.2)), eye_up=k.get('eye_up', 0.66),
        dash=(ws + 0.02, ws - 0.38, 0.72, clr + 0.32, cowl - 0.03), wheel_c=(ws - 0.6, cowl - 0.07), wheel_r=0.175, wheel_tilt=0.55,
        mirror=(ws - 0.18, k['bw'][2] + 0.02, belt + 0.06), mirror_out=0.16, mirror_h=0.075, mirror_l=0.15,
        mirror_region=k.get('mirror_region', 'paint'), roof_x=k.get('peak', 0.0), recline=0.45, seat_back=0.6,
        hull_region=k.get('hull_region'), cutters=k.get('cutters'), keys=k.get('keys', []),
    )
    hdr, rwin, sail = k['hdr'], k.get('rwin', -9.0), k.get('sail', 'paint')

    def glass_region(i):
        seg, xb, xr_ = i['seg'], i['xb'], i['xr']
        if seg == 'side':
            if i['zone'] == 'front' or xb > ws - 0.12:
                return 'black'
            if xb < k['qx']:
                return sail
            return 'glass'
        if seg == 'corner':
            return k.get('pillar', 'paint')
        if xr_ > hdr or xr_ < rwin:
            return 'glass'
        return k.get('roof_region', 'paint')

    p['glass_region'] = glass_region

    def decor(o, res, pr, prg, hull, p):
        mid_common(o, res, pr, prg, hull, p, k)
        k['decor'](o, res, pr, prg, hull, p, k)

    p['decor'] = decor
    rim = k.get('rim', 'multi')
    p['wheels'] = lambda res: (centre_lock(R, k.get('tw', 0.255), rim, k.get('ratio', 0.74), res, k.get('spokes', 5), k.get('nut', 'chrome'))
                               if k.get('lock') else P.wheel(R, k.get('tw', 0.255), rim, 'road', k.get('ratio', 0.74), 22 if res else 8, res, k.get('spokes', 5)),
                               centre_lock(Rr, k.get('twr', 0.32), rim, k.get('ratio', 0.74), res, k.get('spokes', 5), k.get('nut', 'chrome'))
                               if k.get('lock') else P.wheel(Rr, k.get('twr', 0.32), rim, 'road', k.get('ratio', 0.74), 22 if res else 8, res, k.get('spokes', 5)))
    return p


def mid_common(o, res, pr, prg, hull, p, k):
    """What every mid-engined car has: the cowl and a wiper, the sills, the plates, door shut lines."""
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R, Rr = p['xf'], p['xr'], p['R'], p['R_rear']
    ws = p['ws_base']
    cx = ws - 0.03
    line(o, pr, 'top', [(cx, -0.66), (cx, 0.66)], 0.05, 'black', 0.003)
    if res:
        o.body.extend(tube([Vector((cx - 0.02, 0.5, p['roof_z'](cx - 0.02) + 0.01)), Vector((cx - 0.07, -0.25, p['roof_z'](cx - 0.07) + 0.012))], 0.006, 'black', 4))
        line(o, pr, 'side', [(xf - R - 0.05, k.get('sill_z', 0.19)), (xr + Rr + 0.05, k.get('sill_z', 0.19))], 0.07, 'black', 0.003, both=True)
        d0, d1 = k.get('door', (ws - 0.05, k['qx'] + 0.05))
        top = k['belt']
        gaps(o, pr, [[(d0, top), (d0 + 0.02, 0.5), (d0 - 0.06, 0.24)], [(d1, top + 0.03), (d1 - 0.03, 0.5), (d1 - 0.02, 0.24)], [(d0 - 0.06, 0.24), (d1 - 0.02, 0.24)]])
    plate(o, pr, 'front', (0.0, k.get('plate_f', 0.26)), w=0.3, h=0.1)
    plate(o, pr, 'rear', (0.0, k.get('plate_r', 0.45)), w=0.3, h=0.12)


def side_intake(x_front, x_back, z0, z1, y_in, top_back=None, region='grille'):
    """A boolean cutter for a scoop in the side: a quadrilateral in side view, cut in from y_in."""
    tb = top_back if top_back is not None else z1
    pts = [(x_front, z0 + 0.05), (x_front + 0.0, z1), (x_back, tb), (x_back, z0)]
    m = prism(pts, y_in, 1.6, region)
    return [m, m.mirrored()]


def big_wing(o, x, z, chord, span, deck_y, deck_z, region='gloss', plate_h=0.14, pitch=0.16, thick=0.07):
    """A rear wing on two uprights with big end plates."""
    o.body.extend(aerofoil(x, z, chord, thick, -span, span, pitch, region))
    for s in (1, -1):
        o.body.extend(rbox((x - 0.01, s * (span + 0.006), z - plate_h * 0.3), (chord * 0.6, 0.006, plate_h / 2), 0.006, region, 1))
        o.body.extend(prism([(x + 0.05, deck_z - 0.02), (x - 0.09, deck_z - 0.02), (x - 0.06, z), (x + 0.03, z)], s * deck_y - 0.014, s * deck_y + 0.014, region))


def super_decor(o, res, pr, prg, hull, p, k):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    # Headlamps: slim angular slits at the corners of the nose with a light blade inside.
    hf = aim((x1 - 0.3, 0.66, 0.5), 0.5, 0.5)
    lamp(o, pr, hf, [(-0.2, 0.015), (0.08, -0.035), (0.2, -0.03), (0.17, 0.0), (-0.18, 0.035)], 'head', res, 'gloss', 0.004, 0.006, bw=0.012)
    if res:
        line(o, pr, hf, [(-0.17, 0.018), (0.17, -0.016)], 0.008, 'white', 0.012, both=True)
    # Big intakes in the nose: two at the corners, one in the middle, a splitter under them.
    fi = aim((x1 - 0.2, 0.55, 0.26), 0.35, 0.0)
    flat(o, pr, fi, [(-0.2, -0.1), (0.25, -0.08), (0.22, 0.08), (0.0, 0.07), (-0.18, -0.01)], 'grille', 0.004, both=True, bezel=(0.012, 'gloss', 0.003), res=res, rings=2)
    flat(o, pr, 'front', rounded([(-0.26, 0.15), (0.26, 0.15), (0.2, 0.22), (-0.2, 0.22)], 1), 'grille', 0.004, res=res, rings=2)
    o.body.extend(rbox((x1 - 0.2, 0, 0.12), (0.14, 0.6, 0.012), 0.006, 'gloss', 1))
    if res:
        gaps(o, pr, [[(0.9, 0.62), (1.8, 0.5), (2.12, 0.36), (2.2, 0.0)]], frame='top')
        for z in (-0.05, 0.0, 0.05):
            line(o, pr, fi, [(-0.15, z), (0.2, z + 0.01)], 0.008, 'gloss', 0.008, both=True)
    # A roof scoop feeding the engine.
    zr = p['roof_z'](-0.55)
    o.body.extend(rbox((-0.62, 0, zr + 0.005), (0.32, 0.11, 0.04), 0.035, 'paint', 2 if res else 1))
    o.body.extend(rbox((-0.31, 0, zr + 0.017), (0.02, 0.085, 0.022), 0.01, 'grille', 1))
    # Engine cover: vents across it.
    if res:
        flat(o, pr, 'top', rounded([(-1.0, -0.42), (-1.0, 0.42), (-1.85, 0.36), (-1.85, -0.36)], 1), 'grille', 0.004, bezel=(0.014, 'gloss', 0.003), res=res, rings=1)
        louvres(o, pr, 'top', -1.0, -1.85, -0.36, 0.36, 9, 'paint', 0.03, 0.01, along_x=False)
    # Tail: thin lamp blades at the corners, a mesh panel between, the diffuser and the exhausts.
    tf = aim((x0 + 0.12, 0.7, k['deck'] - 0.06), math.pi - 0.6, 0.0)
    lamp(o, pr, tf, [(0.22, -0.012), (0.22, 0.012), (-0.2, 0.03), (-0.22, 0.01)], 'tail', res, 'gloss', 0.003, 0.006, bw=0.01)
    lamp(o, pr, tf, [(0.18, -0.05), (0.2, -0.035), (-0.16, -0.02), (-0.18, -0.035)], 'tail', res, None, 0.002, 0.006)
    flat(o, pr, 'rear', rounded([(-0.42, 0.58), (0.42, 0.58), (0.46, 0.66), (0.42, 0.76), (-0.42, 0.76), (-0.46, 0.66)], 1), 'grille', 0.004, bezel=(0.012, 'gloss', 0.003), res=res, rings=2)
    flat(o, pr, 'rear', [(-0.66, 0.36), (0.66, 0.36), (0.6, 0.18), (-0.6, 0.18)], 'black', 0.004, res=res, rings=2)
    if res:
        for y in (-0.6, -0.42, -0.24, 0.24, 0.42, 0.6):
            o.body.extend(rbox((x0 + 0.2, y, 0.2), (0.22, 0.005, 0.05), 0.003, 'gloss', 1))
        for y in (-0.09, 0.09):
            o.body.extend(cyl((x0 + 0.2, y, 0.3), (x0 - 0.02, y, 0.3), 0.055, 'chrome', 14, caps=False))
            o.body.extend(cyl((x0 - 0.015, y, 0.3), (x0 - 0.008, y, 0.3), 0.05, 'gap', 12))
    big_wing(o, x0 + 0.24, k['deck'] + 0.27, 0.32, 0.86, 0.32, hull.surface_z(x0 + 0.24, 0.32))


def super_car(res):
    k = dict(
        L=4.6, W=2.02, xf=1.38, xr=-1.27, R=0.335, Rr=0.355, track=1.7, track_r=1.66, color=0xf2c230,
        ws=0.82, bl=-0.95, nose=0.42, cowl=0.74, belt=0.8, hip=0.92, deck=0.96, wingf=0.79, dip=0.08,
        roof=[(-0.95, 1.0), (-0.7, 1.08), (-0.45, 1.12), (-0.2, 1.125), (0.02, 1.1), (0.3, 1.0), (0.55, 0.88), (0.82, 0.76)],
        hdr=0.02, rwin=-0.78, qx=-0.6, qxr=-0.45, sail='black',
        wf=0.99, wd=0.95, wr=1.01, rw=(0.5, 0.56, 0.72), bw=(0.62, 0.74, 0.78),
        hip_x=-0.18, hip_up=0.18, eye_up=0.64, tumble=C((-2.3, 0.14), (-1.2, 0.14), (0.0, 0.16), (1.4, 0.09), (2.3, 0.1)), rs=const(0.035),
        rim='multi', spokes=5, lock=True, ratio=0.75, tw=0.255, twr=0.335,
        cutters=lambda res, hull: side_intake(-0.42, -0.86, 0.3, 0.74, 0.78, 0.66),
        decor=super_decor, plate_f=0.25, plate_r=0.45, door=(0.76, -0.5),
    )
    return fast_car(res, mid_params(k))


super_car.__name__ = 'super'
car(super_car)


def hexagon(c, r, rot=0.0):
    return [(c[0] + r * math.cos(rot + math.pi / 3 * k), c[1] + r * math.sin(rot + math.pi / 3 * k)) for k in range(6)]


def diffuser(o, pr, x0, res, w=0.66, z0=0.17, z1=0.35, fins=(-0.5, -0.32, 0.32, 0.5)):
    flat(o, pr, 'rear', [(-w, z1), (w, z1), (w - 0.06, z0), (-w + 0.06, z0)], 'black', 0.004, res=res, rings=2)
    if res:
        for y in fins:
            o.body.extend(rbox((x0 + 0.18, y, z0 + 0.04), (0.2, 0.005, 0.045), 0.003, 'gloss', 1))


# ------------------------------------------------------------------ Toro Furioso (the V12 wedge)

def lambo_decor(o, res, pr, prg, hull, p, k):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    # Y-shaped headlamps: a narrow angular lamp at each corner, a Y of light inside.
    hf = aim((x1 - 0.32, 0.68, 0.5), 0.55, 0.55)
    lamp(o, pr, hf, [(-0.22, 0.02), (0.06, -0.04), (0.22, -0.05), (0.2, -0.01), (0.04, 0.03), (-0.2, 0.045)], 'head', res, 'gloss', 0.004, 0.006, bw=0.012)
    if res:
        for seg in ([(-0.18, 0.03), (0.0, 0.0)], [(0.0, 0.0), (0.18, -0.02)], [(0.0, 0.0), (0.12, -0.04)]):
            line(o, pr, hf, seg, 0.008, 'white', 0.012, both=True)
    # Huge angular intakes at the corners of the nose and a lower lip.
    fi = aim((x1 - 0.18, 0.55, 0.27), 0.32, 0.0)
    flat(o, pr, fi, [(-0.24, -0.12), (0.26, -0.12), (0.26, 0.04), (0.1, 0.1), (-0.2, 0.05)], 'grille', 0.004, both=True, bezel=(0.014, 'gloss', 0.003), res=res, rings=2)
    if res:
        line(o, pr, fi, [(-0.2, -0.02), (0.24, -0.02)], 0.02, 'paint', 0.008, both=True)
        gaps(o, pr, [[(0.92, 0.58), (1.8, 0.48), (2.2, 0.32), (2.3, 0.0)]], frame='top')
    o.body.extend(rbox((x1 - 0.16, 0, 0.115), (0.12, 0.55, 0.012), 0.006, 'gloss', 1))
    # Shoulder intakes behind the side windows (black when open).
    flat(o, pr, 'top', [(-0.72, 0.78), (-1.2, 0.84), (-1.25, 0.66), (-0.8, 0.64)], 'grille', 0.004, both=True, res=res, rings=2)
    # Engine cover: hexagonal panes in two rows.
    if res:
        for i in range(3):
            for j in (-1, 0, 1):
                c = (-1.15 - i * 0.26 - (0.13 if j == 0 else 0.0), j * 0.2)
                flat(o, pr, 'top', hexagon(c, 0.11), 'gloss', 0.005, bezel=(0.01, 'black', 0.003), res=res, rings=1)
    # The tail: Y lamps at the corners, a mesh panel, a slim spoiler, one big hexagonal exhaust.
    for s in (1, -1):
        for seg in ([(0.58, 0.82), (0.72, 0.76)], [(0.72, 0.76), (0.86, 0.82)], [(0.72, 0.76), (0.72, 0.62)]):
            line(o, pr, 'rear', [(s * a, b) for (a, b) in seg], 0.045, 'tail', 0.006)
        flat(o, pr, 'rear', [(s * 0.54, 0.59), (s * 0.87, 0.59), (s * 0.87, 0.85), (s * 0.54, 0.85)], 'black', 0.003, res=res, rings=2)
    flat(o, pr, 'rear', [(-0.46, 0.4), (0.46, 0.4), (0.46, 0.62), (-0.46, 0.62)], 'grille', 0.004, bezel=(0.012, 'gloss', 0.003), res=res, rings=2)
    diffuser(o, pr, x0, res)
    if res:
        o.body.extend(cyl((x0 + 0.2, 0, 0.3), (x0 - 0.02, 0, 0.3), 0.085, 'chrome', 6, caps=False))
        o.body.extend(cyl((x0 - 0.015, 0, 0.3), (x0 - 0.008, 0, 0.3), 0.075, 'gap', 6))
    zt = hull.surface_z(x0 + 0.15, 0.0)
    o.body.extend(aerofoil(x0 + 0.16, zt + 0.05, 0.22, 0.04, -0.72, 0.72, 0.06, 'gloss'))
    for s in (1, -1):
        o.body.extend(rbox((x0 + 0.17, s * 0.3, zt + 0.02), (0.05, 0.01, 0.03), 0.005, 'gloss', 1))


def lambo_car(res):
    k = dict(
        L=4.8, W=2.03, xf=1.44, xr=-1.26, R=0.34, Rr=0.36, track=1.72, track_r=1.68, color=0x9ad01e,
        ws=0.86, bl=-0.95, nose=0.4, cowl=0.74, belt=0.79, hip=0.95, deck=0.98, wingf=0.8, dip=0.09,
        roof=[(-0.95, 1.0), (-0.7, 1.08), (-0.45, 1.13), (-0.2, 1.14), (0.02, 1.12), (0.3, 1.02), (0.58, 0.89), (0.86, 0.76)],
        hdr=0.02, rwin=-0.78, qx=-0.55, qxr=-0.42, sail='black',
        wf=1.0, wd=0.96, wr=1.015, rw=(0.5, 0.55, 0.72), bw=(0.62, 0.74, 0.78),
        hip_x=-0.2, hip_up=0.18, eye_up=0.64, tumble=C((-2.4, 0.16), (-1.2, 0.17), (0.0, 0.19), (1.44, 0.1), (2.4, 0.12)), rs=const(0.022),
        rim='twin', spokes=5, ratio=0.75, tw=0.255, twr=0.335, gap=0.05,
        cutters=lambda res, hull: side_intake(-0.4, -0.88, 0.28, 0.8, 0.8, 0.62),
        decor=lambo_decor, plate_f=0.24, plate_r=0.33, door=(0.8, -0.45),
        front=(0.42, 3.2), rear=(0.25, 3.6),
    )
    return fast_car(res, mid_params(k))


lambo_car.__name__ = 'lambo'
car(lambo_car)


# ------------------------------------------------------------------ Cavallo Rosso F8 (the mid-engined V8)

def ferrari_decor(o, res, pr, prg, hull, p, k):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    # Slim headlamps swept back and up the wings.
    hf = aim((x1 - 0.32, 0.66, 0.56), 0.6, 0.45)
    lamp(o, pr, hf, rounded([(-0.24, 0.03), (0.0, -0.01), (0.2, -0.04), (0.24, -0.02), (0.02, 0.025), (-0.22, 0.05)], 1), 'head', res, 'gloss', 0.006, 0.006, bw=0.012)
    if res:
        line(o, pr, hf, [(-0.2, 0.035), (0.2, -0.025)], 0.008, 'white', 0.012, both=True)
    # A wide mouth in the nose with intakes at its ends, the S-duct across the bonnet.
    flat(o, pr, 'front', rounded([(-0.62, 0.17), (0.62, 0.17), (0.7, 0.3), (0.5, 0.33), (-0.5, 0.33), (-0.7, 0.3)], 2), 'grille', 0.004,
         bezel=(0.014, 'gloss', 0.003), res=res, rings=2)
    if res:
        for z in (0.22, 0.27):
            line(o, pr, 'front', [(-0.6, z), (0.6, z)], 0.008, 'gloss', 0.008)
    flat(o, pr, 'top', rounded([(2.0, -0.3), (2.0, 0.3), (1.88, 0.26), (1.88, -0.26)], 1), 'grille', 0.004, res=res, rings=2)
    o.body.extend(rbox((x1 - 0.16, 0, 0.13), (0.12, 0.6, 0.01), 0.005, 'gloss', 1))
    if res:
        gaps(o, pr, [[(0.95, 0.56), (1.85, 0.46), (2.2, 0.3), (2.28, 0.0)]], frame='top')
    # Engine cover: louvres across it, behind the back window.
    flat(o, pr, 'top', rounded([(-1.1, -0.42), (-1.1, 0.42), (-1.75, 0.38), (-1.75, -0.38)], 1), 'grille', 0.004, bezel=(0.012, 'gloss', 0.003), res=res, rings=1)
    if res:
        louvres(o, pr, 'top', -1.1, -1.75, -0.38, 0.38, 6, 'paint', 0.05, 0.01, along_x=False)
    # Twin round lamps each side, a small spoiler lip, the diffuser and four round tailpipes.
    for s in (1, -1):
        for y in (0.56, 0.76):
            lamp(o, pr, 'rear', circle_pts((s * y, 0.78), 0.065, 14), 'tail', res, 'gloss', 0.01, 0.006, both=False, bw=0.012)
            if res:
                lamp(o, pr, 'rear', circle_pts((s * y, 0.78), 0.03, 10), 'red', res, None, 0.004, 0.02, both=False, rings=1)
    flat(o, pr, 'rear', rounded([(-0.36, 0.6), (0.36, 0.6), (0.36, 0.72), (-0.36, 0.72)], 1), 'grille', 0.004, res=res, rings=2)
    diffuser(o, pr, x0, res, 0.62, 0.17, 0.36)
    if res:
        for s in (1, -1):
            for y in (0.12, 0.24):
                o.body.extend(cyl((x0 + 0.2, s * y, 0.4), (x0 - 0.02, s * y, 0.4), 0.045, 'chrome', 12, caps=False))
                o.body.extend(cyl((x0 - 0.015, s * y, 0.4), (x0 - 0.008, s * y, 0.4), 0.04, 'gap', 10))
    zt = hull.surface_z(x0 + 0.08, 0.0)
    o.body.extend(prism([(x0 + 0.28, zt - 0.01), (x0 + 0.28, zt + 0.01), (x0 + 0.1, zt + 0.03), (x0 + 0.09, zt + 0.0), (x0 + 0.12, zt - 0.03)], -0.66, 0.66, 'paint'))


def ferrari_car(res):
    k = dict(
        L=4.61, W=1.98, xf=1.38, xr=-1.27, R=0.335, Rr=0.35, track=1.66, track_r=1.64, color=0xd01818,
        ws=0.72, bl=-1.05, nose=0.46, cowl=0.76, belt=0.82, hip=0.98, deck=0.95, wingf=0.8, dip=0.1,
        roof=[(-1.05, 1.0), (-0.8, 1.1), (-0.5, 1.18), (-0.25, 1.2), (0.0, 1.18), (0.25, 1.08), (0.5, 0.92), (0.72, 0.78)],
        hdr=0.0, rwin=-0.7, qx=-0.62, qxr=-0.5, sail='paint',
        wf=0.98, wd=0.94, wr=0.99, rw=(0.48, 0.56, 0.7), bw=(0.62, 0.72, 0.76),
        hip_x=-0.3, hip_up=0.2, eye_up=0.66, tumble=C((-2.3, 0.14), (-1.2, 0.15), (0.0, 0.13), (1.4, 0.1), (2.3, 0.1)),
        rs=C((-2.3, 0.06), (-1.2, 0.1), (0.0, 0.07), (1.4, 0.08), (2.3, 0.06)),
        rim='twin', spokes=5, ratio=0.74, tw=0.245, twr=0.305,
        cutters=lambda res, hull: side_intake(-0.66, -0.88, 0.42, 0.76, 0.84, 0.82),
        decor=ferrari_decor, plate_f=0.39, plate_r=0.47, door=(0.68, -0.62),
        front=(0.6, 2.2), rear=(0.3, 2.8),
    )
    return fast_car(res, mid_params(k))


ferrari_car.__name__ = 'ferrari'
car(ferrari_car)


# ------------------------------------------------------------------ Woking 720 (the British supercar)

def mclaren_decor(o, res, pr, prg, hull, p, k):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    # Eye-socket lamps: a dark teardrop at each corner of the nose, the lamp in its top.
    hf = aim((x1 - 0.24, 0.62, 0.36), 0.5, 0.25)
    sock = rounded([(-0.13, 0.07), (0.1, 0.1), (0.15, 0.03), (0.07, -0.13), (-0.04, -0.15), (-0.13, -0.03)], 2)
    lamp(o, pr, hf, sock, 'gloss', res, 'black', 0.0, 0.004, bw=0.012)
    lamp(o, pr, hf, rounded([(-0.09, 0.04), (0.09, 0.07), (0.11, 0.03), (-0.08, 0.0)], 1), 'head', res, None, 0.004, 0.01)
    if res:
        flat(o, pr, hf, rounded([(-0.04, -0.04), (0.06, -0.02), (0.03, -0.1), (-0.02, -0.11)], 1), 'grille', 0.012, both=True, rings=1)
    flat(o, pr, 'front', rounded([(-0.42, 0.14), (0.42, 0.14), (0.36, 0.22), (-0.36, 0.22)], 1), 'grille', 0.004, res=res, rings=2)
    o.body.extend(rbox((x1 - 0.16, 0, 0.11), (0.12, 0.62, 0.01), 0.005, 'gloss', 1))
    if res:
        gaps(o, pr, [[(0.92, 0.5), (1.8, 0.42), (2.16, 0.28), (2.24, 0.0)]], frame='top')
    # The channel along the door leading into the scoop.
    flat(o, pr, 'side', rounded([(0.4, 0.52), (0.1, 0.46), (-0.3, 0.38), (-0.3, 0.64), (0.1, 0.6)], 2), 'gloss', 0.003, both=True, res=res, rings=2)
    # The tail: slim C-shaped lamps, mesh right across, the airbrake, a high centre exhaust pair.
    for s in (1, -1):
        line(o, pr, 'rear', [(s * 0.6, 0.84), (s * 0.82, 0.84), (s * 0.86, 0.78), (s * 0.82, 0.7), (s * 0.66, 0.7)], 0.025, 'tail', 0.007)
    flat(o, pr, 'rear', [(-0.7, 0.36), (0.7, 0.36), (0.7, 0.64), (0.48, 0.76), (-0.48, 0.76), (-0.7, 0.64)], 'grille', 0.004, res=res, rings=2)
    if res:
        for z in (0.42, 0.5, 0.58, 0.66):
            line(o, pr, 'rear', [(-0.66, z), (0.66, z)], 0.006, 'metal', 0.007)
        for y in (-0.08, 0.08):
            o.body.extend(cyl((x0 + 0.2, y, 0.62), (x0 - 0.02, y, 0.62), 0.05, 'chrome', 12, caps=False))
            o.body.extend(cyl((x0 - 0.015, y, 0.62), (x0 - 0.008, y, 0.62), 0.045, 'gap', 10))
    diffuser(o, pr, x0, res, 0.6, 0.15, 0.34)
    zt = hull.surface_z(x0 + 0.15, 0.0)
    o.body.extend(prism([(x0 + 0.4, zt), (x0 + 0.4, zt + 0.02), (x0 + 0.12, zt + 0.04), (x0 + 0.11, zt + 0.015), (x0 + 0.16, zt - 0.02)], -0.74, 0.74, 'paint'))


def mclaren_car(res):
    k = dict(
        L=4.54, W=1.93, xf=1.36, xr=-1.31, R=0.335, Rr=0.35, track=1.64, track_r=1.6, color=0xff7a1a,
        ws=0.82, bl=-1.15, nose=0.36, cowl=0.72, belt=0.8, hip=0.95, deck=0.93, wingf=0.75, dip=0.08,
        roof=[(-1.15, 0.97), (-0.85, 1.08), (-0.5, 1.17), (-0.2, 1.2), (0.05, 1.18), (0.3, 1.08), (0.55, 0.93), (0.82, 0.76)],
        hdr=0.05, rwin=-0.7, qx=-0.62, qxr=-0.45, sail='glass', pillar='gloss',
        wf=0.96, wd=0.9, wr=0.965, rw=(0.34, 0.56, 0.7), bw=(0.5, 0.71, 0.76),
        hip_x=-0.25, hip_up=0.18, eye_up=0.64, tumble=C((-2.3, 0.12), (-1.2, 0.13), (0.0, 0.15), (1.4, 0.1), (2.3, 0.1)),
        rs=const(0.06), rim='multi', spokes=5, ratio=0.75, tw=0.245, twr=0.305,
        cutters=lambda res, hull: side_intake(-0.3, -0.86, 0.36, 0.66, 0.8, 0.6),
        decor=mclaren_decor, plate_f=0.27, plate_r=0.28, door=(0.76, -0.3), front=(0.55, 2.2),
    )
    p = mid_params(k)
    p['gh_rear'] = (0.35, 2.0)
    return fast_car(res, p)


mclaren_car.__name__ = 'mclaren'
car(mclaren_car)


# ------------------------------------------------------------------ Molsheim Chimera (the W16 hypercar)

def chiron_c(z):
    """The side's big C: how far forward of the door's middle it is at each height."""
    return -0.5 + 0.55 * ((z - 0.55) / 0.33) ** 2


def prism_any(outline, y0, y1, region):
    """Like carkit.prism but wound consistently for concave outlines too (a cutter must be closed and outward)."""
    m = Mesh()
    a = [m.vert((x, y0, z)) for x, z in outline]
    b = [m.vert((x, y1, z)) for x, z in outline]
    n = len(outline)
    for k2 in range(n):
        k3 = (k2 + 1) % n
        m.face((a[k2], a[k3], b[k3], b[k2]), region)
    m.face(list(reversed(a)), region)
    m.face(b, region)
    if K._fnormal(m, m.f[-1]).y * (1 if y1 > y0 else -1) < 0:
        m.f = [tuple(reversed(f)) for f in m.f]
    return m


def bugatti_decor(o, res, pr, prg, hull, p, k):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    # The horseshoe grille in a chrome surround, big black intakes either side of it.
    shoe = rounded([(-0.17, 0.6), (0.17, 0.6), (0.16, 0.42), (0.11, 0.3), (0.0, 0.27), (-0.11, 0.3), (-0.16, 0.42)], 2)
    flat(o, pr, 'front', shoe, 'grille', 0.006, bezel=(0.03, 'chrome', 0.008), res=res, rings=2)
    if res:
        for z in (0.36, 0.44, 0.52):
            line(o, pr, 'front', [(-0.15, z), (0.15, z)], 0.006, 'metal', 0.01)
    fi = aim((x1 - 0.2, 0.55, 0.28), 0.35, 0.0)
    flat(o, pr, fi, [(-0.22, -0.12), (0.24, -0.12), (0.26, 0.06), (0.1, 0.1), (-0.18, 0.06)], 'grille', 0.004, both=True, bezel=(0.014, 'gloss', 0.003), res=res, rings=2)
    # Four-lens lamps: a slim housing on each corner with four small lenses in it.
    hf = aim((x1 - 0.3, 0.64, 0.62), 0.55, 0.4)
    lamp(o, pr, hf, rounded([(-0.17, 0.0), (0.12, -0.05), (0.19, -0.02), (0.17, 0.03), (-0.15, 0.05)], 1), 'gloss', res, 'chrome', 0.004, 0.006, bw=0.01)
    for j in range(4):
        lamp(o, pr, hf, circle_pts((-0.11 + j * 0.08, 0.02 - j * 0.017), 0.025, 10), 'head', res, None, 0.008, 0.012, rings=1)
    o.body.extend(rbox((x1 - 0.16, 0, 0.12), (0.12, 0.6, 0.01), 0.005, 'gloss', 1))
    # The C round the side intake, in chrome.
    zs = [0.24 + k2 * 0.06 for k2 in range(12)]
    line(o, pr, 'side', [(chiron_c(z) + 0.02, z) for z in zs], 0.04, 'chrome', 0.006, both=True)
    # The spine down the middle of the roof and the engine cover.
    path = [Vector((x, 0, p['roof_z'](x) + 0.008)) for x in (0.1, -0.2, -0.5, -0.8)] + \
           [Vector((x, 0, hull.surface_z(x, 0.0) + 0.01)) for x in (-1.1, -1.5, -1.9)]
    o.body.extend(tube(path, 0.018, 'paint2', 6 if res else 4))
    # The tail: one light bar right across, a mesh panel, four square exhausts, the fixed spoiler.
    line(o, pr, 'rear', [(-0.9, k['deck'] - 0.1), (0.9, k['deck'] - 0.1)], 0.025, 'tail', 0.007)
    flat(o, pr, 'rear', [(-0.75, 0.34), (0.75, 0.34), (0.75, 0.78), (-0.75, 0.78)], 'grille', 0.004, res=res, rings=2)
    if res:
        for y in (-0.15, -0.05, 0.05, 0.15):
            o.body.extend(rbox((x0 + 0.1, y, 0.32), (0.12, 0.04, 0.035), 0.008, 'chrome', 1))
            o.body.extend(rbox((x0 - 0.02, y, 0.32), (0.006, 0.032, 0.027), 0.004, 'gap', 1))
    diffuser(o, pr, x0, res, 0.66, 0.16, 0.3)
    zt = hull.surface_z(x0 + 0.25, 0.3)
    o.body.extend(aerofoil(x0 + 0.24, zt + 0.07, 0.34, 0.06, -0.86, 0.86, 0.06, 'paint2'))
    for s in (1, -1):
        o.body.extend(rbox((x0 + 0.25, s * 0.45, zt + 0.03), (0.08, 0.012, 0.04), 0.006, 'paint2', 1))


def bugatti_car(res):
    k = dict(
        L=4.54, W=2.04, xf=1.36, xr=-1.35, R=0.345, Rr=0.36, track=1.72, track_r=1.68, color=0x1a2a6a,
        ws=0.7, bl=-0.95, nose=0.6, cowl=0.8, belt=0.85, hip=1.0, deck=1.0, wingf=0.84, dip=0.05,
        roof=[(-0.95, 1.03), (-0.7, 1.12), (-0.4, 1.2), (-0.15, 1.21), (0.1, 1.18), (0.35, 1.06), (0.55, 0.93), (0.7, 0.83)],
        hdr=0.1, rwin=-0.72, qx=-0.5, qxr=-0.42, sail='paint',
        wf=1.0, wd=0.97, wr=1.02, rw=(0.5, 0.58, 0.72), bw=(0.62, 0.74, 0.78),
        hip_x=-0.22, hip_up=0.2, eye_up=0.66, tumble=C((-2.3, 0.14), (-1.2, 0.14), (0.0, 0.14), (1.4, 0.11), (2.3, 0.1)),
        rs=const(0.1), rim='alloy', spokes=6, ratio=0.74, tw=0.285, twr=0.355, nose_bot=0.12,
        cutters=lambda res, hull: [prism_any([(chiron_c(z) - 0.02, z) for z in (0.3, 0.42, 0.55, 0.68, 0.8)] +
                                         [(chiron_c(z) - 0.2, z) for z in (0.76, 0.66, 0.55, 0.44, 0.34)], 0.88, 1.6, 'grille')] * 1,
        decor=bugatti_decor, plate_f=0.2, plate_r=0.44, door=(0.66, -0.4), front=(0.55, 2.0),
        hull_region=lambda i, hull: ('paint2' if i['seg'] not in ('bot', 'in') and (
            (i['seg'] in ('low', 'up', 'sill', 'sh') and i['c'].x > chiron_c(i['c'].z)) or (i['seg'] in ('top', 'cap') and i['c'].x > 0.68))
            else None),
    )
    k['cutters'] = lambda res, hull, c=k['cutters']: [m for m in c(res, hull)] + [m.mirrored() for m in c(res, hull)]
    return fast_car(res, mid_params(k))


bugatti_car.__name__ = 'bugatti'
car(bugatti_car)


# ------------------------------------------------------------------ Toro Countdown (the '80s poster wedge)

def countach_decor(o, res, pr, prg, hull, p, k):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    # Pop-up lamps, shown closed: two panels outlined on the bonnet; driving lamps in the nose.
    if res:
        for s in (1, -1):
            line(o, pr, 'top', rrect_pts((1.62, s * 0.58), 0.34, 0.22, 0.01, 1), 0.006, 'gap', 0.0015, closed=True)
        gaps(o, pr, [[(0.7, 0.4), (1.9, 0.35), (2.0, 0.0)]], frame='top')
    for s in (1, -1):
        lamp(o, pr, 'front', rrect_pts((s * 0.5, 0.42), 0.26, 0.05, 0.008, 1), 'head', res, 'gloss', 0.003, 0.006, both=False, bw=0.01)
        lamp(o, pr, 'front', rrect_pts((s * 0.78, 0.42), 0.12, 0.05, 0.008, 1), 'amber', res, 'gloss', 0.003, 0.006, both=False, bw=0.01)
    line(o, pr, 'front', [(-0.9, 0.3), (0.9, 0.3)], 0.08, 'black', 0.004)
    # NACA ducts in the doors and the boxy air boxes on the shoulders behind the cabin.
    flat(o, pr, 'side', [(0.25, 0.7), (-0.35, 0.76), (-0.37, 0.64)], 'grille', 0.004, both=True, bezel=(0.008, 'gloss', 0.003), res=res, rings=2)
    for s in (1, -1):
        zb = hull.surface_z(-0.95, 0.66)
        o.body.extend(rbox((-1.0, s * 0.66, zb + 0.06), (0.32, 0.2, 0.09), 0.02, 'paint', 2 if res else 1))
        o.body.extend(rbox((-0.69, s * 0.66, zb + 0.08), (0.012, 0.17, 0.055), 0.006, 'grille', 1))
    # Tail: rectangular lamp clusters in a black panel, quad pipes, the big V-legged wing.
    flat(o, pr, 'rear', [(-0.86, 0.5), (0.86, 0.5), (0.86, 0.72), (-0.86, 0.72)], 'black', 0.003, res=res, rings=2)
    for s in (1, -1):
        for (y, w, reg) in ((0.74, 0.18, 'tail'), (0.57, 0.13, 'amber'), (0.42, 0.15, 'tail')):
            lamp(o, pr, 'rear', rrect_pts((s * y, 0.61), w, 0.13, 0.008, 1), reg, res, None, 0.003, 0.008, both=False, rings=1)
    line(o, pr, 'rear', [(-0.9, 0.36), (0.9, 0.36)], 0.08, 'black', 0.004)
    if res:
        for s in (1, -1):
            for y in (0.22, 0.34):
                o.body.extend(cyl((x0 + 0.2, s * y, 0.27), (x0 - 0.03, s * y, 0.27), 0.04, 'chrome', 12, caps=False))
                o.body.extend(cyl((x0 - 0.025, s * y, 0.27), (x0 - 0.018, s * y, 0.27), 0.035, 'gap', 10))
    wz = k['deck'] + 0.3
    o.body.extend(aerofoil(x0 + 0.22, wz, 0.4, 0.07, -0.88, 0.88, 0.1, 'paint'))
    for s in (1, -1):
        o.body.extend(rbox((x0 + 0.21, s * 0.885, wz - 0.02), (0.2, 0.007, 0.06), 0.006, 'paint', 1))
        zd = hull.surface_z(x0 + 0.3, 0.6)
        o.body.extend(tube([Vector((x0 + 0.3, s * 0.6, zd - 0.02)), Vector((x0 + 0.24, s * 0.1, wz - 0.02))], 0.025, 'paint', 6 if res else 4))


def countach_car(res):
    k = dict(
        L=4.14, W=2.0, xf=1.24, xr=-1.21, R=0.31, Rr=0.335, track=1.56, track_r=1.6, color=0xf4f4f6,
        ws=0.58, bl=-0.75, nose=0.5, cowl=0.8, belt=0.82, hip=0.98, deck=0.95, wingf=0.73, dip=0.03,
        roof=[(-0.75, 0.99), (-0.6, 1.05), (-0.4, 1.07), (-0.15, 1.07), (0.05, 1.02), (0.3, 0.93), (0.58, 0.82)],
        hdr=0.05, rwin=-0.62, qx=-0.42, qxr=-0.35, sail='black', corner=0.025,
        wf=0.96, wd=0.9, wr=0.98, rw=(0.5, 0.56, 0.68), bw=(0.6, 0.66, 0.72),
        hip_x=-0.15, hip_up=0.17, eye_up=0.62, tumble=C((-2.1, 0.15), (-1.2, 0.17), (0.0, 0.2), (1.2, 0.14), (2.1, 0.14)),
        rs=const(0.018), cfrac=const(0.42), rim='steel', spokes=5, ratio=0.6, tw=0.225, twr=0.345, gap=0.05,
        flares=[(1.24, 0.42, 0.05, 0.45, 0.3), (-1.21, 0.5, 0.07, 0.5, 0.34)],
        decor=countach_decor, plate_f=0.2, plate_r=0.42, door=(0.5, -0.4), front=(0.25, 4.0), rear=(0.15, 4.0), xdoor=-0.1,
    )
    p = mid_params(k)
    p['arch_flat'] = 0.7
    return fast_car(res, p)


countach_car.__name__ = 'countach'
car(countach_car)
