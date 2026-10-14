"""
Shared pieces for the car definitions (cars_*.py): the registry, what a builder returns,
wheels and seats metadata in the game's car space, and the generic closed car (a lower
body with arches, a glasshouse, mirrors, an interior and wheels) that most cars start from,
with a `decor` hook for each car's lamps, grille, trim and bolt-ons.
"""
import math

from mathutils import Matrix, Vector

from carkit import Mesh, const, rbox, rrect_pts, circle_pts, tube, chaikin, ccw
from carbody import Hull, Glasshouse, Projector, arch_cutter, cut, patch, strip, aim
import carparts as P

CARS = {}


def car(fn):
    """Register a car builder: fn(res) -> Out, res 1 for the high detail, 0 for the low."""
    CARS[fn.__name__] = fn
    return fn


def G(p):
    """Blender car space to the game's car space (+x forward, y up, +z right)."""
    return [round(p[0], 4), round(p[2], 4), round(-p[1], 4)]


class Out:
    """What a car builder returns for one level of detail."""

    def __init__(self):
        self.body = Mesh()
        self.parts = {}  # extra rigid pieces: name -> Mesh (the tank's turret and barrel)
        self.wheel = {}  # 'f' / 'r' -> wheel Mesh round its centre (high detail only)
        self.meta = {}


def wheels_into(o, res, xs, track, R, wf, wr=None, Rr=None, track_r=None):
    """Wheel meshes and positions (front pair at xs[0], rear at xs[1]); the low detail bakes them in."""
    wr = wr or wf
    Rr = Rr or R
    tr = track_r or track
    o.meta['wheels'] = [G((xs[1], tr / 2, Rr)) + ['r'], G((xs[1], -tr / 2, Rr)) + ['r'],
                        G((xs[0], track / 2, R)) + ['f'], G((xs[0], -track / 2, R)) + ['f']]
    o.meta['wheelR'] = [R, Rr]
    if res:
        o.wheel['f'] = wf
        o.wheel['r'] = wr
    else:
        o.body.extend(P.wheel_pair(wf, xs[0], track / 2, R))
        o.body.extend(P.wheel_pair(wr, xs[1], tr / 2, Rr))


def cabin_meta(o, hips, eye):
    """Seats (hip points) and the driver's eye; Blender coordinates in, the game's out."""
    o.meta['seats'] = [G(h) for h in hips]
    o.meta['eye'] = G(eye)


def arches(hull_mesh, wheels, y_in, half_w, flat=0.0, res=1):
    """Cut the wheel arches: wheels = [(x, centre height, arch radius)]."""
    cutters = []
    for (x, zc, ra) in wheels:
        for s in (1, -1):
            y0, y1 = (y_in, half_w + 0.4) if s > 0 else (-half_w - 0.4, -y_in)
            cutters.append(arch_cutter(x, zc, ra, y0, y1, flat, 32 if res else 14))
    return cut(hull_mesh, cutters, 'arch')


# ------------------------------------------------------------------ decal helpers

def lamp(o, pr, frame, outline, region, res, bezel='gloss', dome=0.008, lift=0.006, both=True, bw=0.01, rings=3):
    m = patch(pr, frame, ccw(outline), region, lift, dome if res else 0.0, rings if res else 1,
              bezel=(bw, bezel, lift * 0.6) if (res and bezel) else None)
    o.body.extend(m.both() if both else m)


def flat(o, pr, frame, outline, region, lift=0.004, both=False, bezel=None, res=1, rings=2):
    m = patch(pr, frame, ccw(outline), region, lift, 0.0, rings if res else 1, bezel=bezel if res else None)
    o.body.extend(m.both() if both else m)


def line(o, pr, frame, pts, width, region, lift=0.002, both=False, closed=False):
    m = strip(pr, frame, pts, width, region, lift, closed)
    o.body.extend(m.both() if both else m)


def gaps(o, pr, lines, frame='side', width=0.0065, lift=0.0015, both=True):
    """Panel gaps: polylines in the frame's plane (the left side for 'side'; mirrored)."""
    for pts in lines:
        line(o, pr, frame, pts, width, 'gap', lift, both)


def handle(o, pr, x, z, region='chrome', w=0.13, h=0.032):
    o.body.extend(patch(pr, 'side', ccw(rrect_pts((x, z), w, h, h * 0.45, 2)), region, 0.007, 0.004, 2,
                        bezel=(0.008, 'gap', 0.002)).both())


def plate(o, pr, frame, c, w=0.31, h=0.155, lift=0.008):
    """A blank number plate in a black surround."""
    o.body.extend(patch(pr, frame, ccw(rrect_pts(c, w, h, 0.012, 2)), 'plate', lift, 0.0, 2, bezel=(0.014, 'black', lift * 0.6)))


def rounded(pts, n=2):
    return chaikin(pts, n)


def arch_pts(xc, zc, r, a0, a1, n=8):
    """Points round a wheel arch (angles in degrees, 0 = towards the front)."""
    return [(xc + r * math.cos(math.radians(a0 + (a1 - a0) * k / n)), zc + r * math.sin(math.radians(a0 + (a1 - a0) * k / n))) for k in range(n + 1)]


def along(fn, x0, x1, n=10, dz=0.0):
    """A polyline following a curve fn(x) from x0 to x1 (for trim along the beltline)."""
    return [(x0 + (x1 - x0) * k / n, fn(x0 + (x1 - x0) * k / n) + dz) for k in range(n + 1)]


# ------------------------------------------------------------------ the generic closed car

def closed_car(res, p):
    """
    A car from a parameter dict: the lower body (Hull), arches, the glasshouse, mirrors, the
    interior, the wheels, and p['decor'](o, res, pr, prg, hull, p) for everything particular.
    """
    L, W = p['L'], p['W']
    xf, xr = p['xf'], p['xr']
    R = p['R']
    Rr = p.get('R_rear', R)
    o = Out()
    x0, x1 = -L / 2, L / 2
    gh_x0, gh_x1 = p['bl_base'], p['ws_base']
    opens = [(a, b, z) for (a, b, z) in p['open']]
    hull_region_extra = p.get('hull_region')

    def hull_region(i):
        seg, x, c = i['seg'], i['x'], i['c']
        if hull_region_extra:
            r = hull_region_extra(i, hull)
            if r:
                return r
        if seg == 'bot':
            return 'black'
        if seg == 'in':
            return 'interior'
        if p.get('glass', True) and seg == 'top' and gh_x0 + 0.01 < x < gh_x1 - 0.01 and abs(c.y) < hull.edge_y(x) - p['inset'] - 0.01:
            return 'interior'
        return None

    hull = Hull(x0, x1, p['bottom'], p['shoulder'], p['top'], p['width'], tuck=p['tuck'], tumble=p['tumble'],
                cfrac=p['cfrac'], rb=p['rb'], rs=p['rs'], front=p['front'], rear=p['rear'],
                open=opens, flares=p.get('flares', []), keys=[xf, xr, gh_x0, gh_x1] + p.get('keys', []),
                region=hull_region, lip=p.get('lip', 0.035))
    hm = hull.build(res)
    y_in = p.get('arch_in', p['track'] / 2 - p['tyre_w'] / 2 - 0.05)
    hm = arches(hm, [(xf, R, R + p['arch_gap']), (xr, Rr, Rr + p['arch_gap'])], y_in, W / 2, p.get('arch_flat', 0.0), res)
    o.body.extend(hm)
    pr = Projector(hm)
    gm = None
    if p.get('glass', True):
        gh = Glasshouse(hull, gh_x0, gh_x1, p['rail_w'], p['rail_z'], p['roof_z'], corner=p['corner'], inset=const(p['inset']),
                        lines=p['lines'], region=p['glass_region'], between=p.get('between', 1),
                        front=p.get('gh_front'), rear=p.get('gh_rear'), bulge=p.get('bulge', 0.012),
                        base_drop=p.get('base_drop', 0.025))
        gm = gh.build(res, shell=bool(res))
        o.body.extend(gm)
    prg = Projector(hm, gm) if gm else pr

    # Interior: dashboard, seats, console, steering wheel.
    dy = p['driver_y']
    hip_f = p['hip_f']
    if res and p.get('interior', True):
        d = p['dash']
        o.body.extend(P.dashboard(d[0], d[1], d[2], d[4], d[3], dy, p.get('dash_region', 'interior')))
        sr = p.get('seat_region', 'seat')
        for s in (1, -1):
            o.body.extend(P.seat(hip_f[0] + 0.04, s * dy, hip_f[1] - 0.09, p.get('seat_w', 0.5), 0.5, p.get('seat_back', 0.64), 0.3, sr,
                                 head=p.get('headrests', True)))
        for (x, w, z) in p.get('benches', []):
            o.body.extend(P.bench(x + 0.04, w, z - 0.09, 0.48, 0.55, 0.36, sr, head=False))
        if p.get('console', True):
            o.body.extend(P.console(hip_f[0] + 0.45, hip_f[0] - 0.15, opens[0][2] if opens else 0.3, hip_f[1] - 0.04))
        sw = p['wheel_c']
        o.body.extend(P.steering_wheel((sw[0], dy, sw[1]), p.get('wheel_tilt', 0.42), p.get('wheel_r', 0.185), region=p.get('wheel_region', 'black')))
    seats = [(hip_f[0], dy, hip_f[1]), (hip_f[0], -dy, hip_f[1])]
    for (x, w, z) in p.get('benches', []):
        seats += [(x, dy, z), (x, -dy, z)]
    seats += p.get('more_seats', [])
    cabin_meta(o, seats[:max(1, p.get('seats', len(seats)))], (hip_f[0] + 0.1, dy, hip_f[1] + 0.69))

    # Mirrors.
    if p.get('mirror'):
        o.body.extend(P.mirror(p['mirror'], region=p.get('mirror_region', 'paint'), res=res, out=p.get('mirror_out', 0.17)).both())

    # Everything particular to this car.
    if p.get('decor'):
        p['decor'](o, res, pr, prg, hull, p)

    # Wheels.
    seg = 20 if res else 8
    wf = P.wheel(R, p['tyre_w'], p['rim'], p.get('tyre', 'road'), p.get('rim_ratio', 0.68), seg, res, p.get('spokes', 5))
    wr = None
    if p.get('R_rear') or p.get('tyre_w_rear'):
        wr = P.wheel(Rr, p.get('tyre_w_rear', p['tyre_w']), p['rim'], p.get('tyre', 'road'), p.get('rim_ratio_rear', p.get('rim_ratio', 0.68)), seg, res, p.get('spokes', 5))
    wheels_into(o, res, (xf, xr), p['track'], R, wf, wr, Rr, p.get('track_rear'))
    o.meta['dims'] = [L, W, round(p.get('height', p['roof_z'](0.0) if p.get('glass', True) else 1.2), 3)]
    o.meta['color'] = p['color']
    if not res:
        # Low detail: the glass is opaque (nothing inside to see).
        o.body.recolor('gloss', only='glass')
    return o
