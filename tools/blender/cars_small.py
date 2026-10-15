"""
The small and the open cars: the Bubble Hatch (a small, tall, round retro city car), the
Riviera Convertible (a long, low 1960s American cruiser with the top down) and the Dune
Buggy (a fibreglass buggy on balloon tyres with a roll cage and its engine out at the back).
"""
import math

from mathutils import Matrix, Vector

from carkit import Mesh, C, const, rbox, cyl, tube, torus, lathe, rrect_pts, circle_pts, ccw, _fnormal
from carbody import aim, patch, Projector
import carparts as P
from carcommon import car, closed_car, lamp, flat, line, gaps, handle, plate, rounded, arch_pts, along


# ------------------------------------------------------------------ the Bubble Hatch

def hatch_params():
    L, W = 3.58, 1.66
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.07, -1.25
    R = 0.3
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.185, track=1.42, arch_gap=0.045, rim='retro', spokes=5, color=0x4fc3f7,
        bottom=C((x0, 0.44), (x0 + 0.08, 0.34), (x0 + 0.32, 0.24), (xr - 0.25, 0.185), (xr, 0.175), (xf, 0.175), (xf + 0.3, 0.2), (x1 - 0.25, 0.25), (x1 - 0.06, 0.33), (x1, 0.4)),
        shoulder=C((x0, 0.87), (x0 + 0.06, 0.935), (x0 + 0.25, 0.97), (-1.0, 0.965), (-0.2, 0.93), (0.7, 0.905), (1.1, 0.865), (1.45, 0.815), (1.65, 0.75), (x1 - 0.03, 0.69), (x1, 0.665)),
        top=C((x0, 0.89), (x0 + 0.06, 0.955), (x0 + 0.25, 0.995), (-1.0, 0.99), (0.7, 0.95), (1.1, 0.915), (1.45, 0.865), (1.65, 0.795), (x1 - 0.03, 0.715), (x1, 0.69)),
        width=C((x0, 0.79), (x0 + 0.45, 0.825), (0.0, 0.83), (x1 - 0.45, 0.82), (x1, 0.79)),
        tuck=const(0.06), tumble=const(0.05), cfrac=const(0.72),
        rb=const(0.08), rs=const(0.07),
        front=(0.55, 2.25), rear=(0.34, 2.8),
        flares=[(xf, 0.5, 0.012, 0.6, 0.25), (xr, 0.5, 0.014, 0.62, 0.25)],
        open=[(-1.15, 0.68, 0.26)],
        bl_base=-1.6, ws_base=0.7, inset=0.03, between=2,
        roof_z=C((-1.6, 0.97), (-1.55, 1.07), (-1.45, 1.23), (-1.32, 1.35), (-1.1, 1.43), (-0.75, 1.47), (-0.35, 1.48), (-0.05, 1.45), (0.2, 1.34), (0.45, 1.16), (0.7, 0.94)),
        rail_z=C((-1.6, 0.96), (-1.55, 1.05), (-1.45, 1.19), (-1.32, 1.3), (-1.1, 1.38), (-0.75, 1.42), (-0.35, 1.43), (-0.05, 1.405), (0.2, 1.3), (0.45, 1.13), (0.7, 0.925)),
        rail_w=C((-1.6, 0.62), (-1.2, 0.58), (-0.5, 0.57), (0.1, 0.58), (0.7, 0.66)),
        corner=C((-1.0, 0.12), (0.0, 0.11), (0.45, 0.06)),
        lines=[(-1.55, -1.55), (-1.48, -1.48), (-1.4, -1.36), (-1.24, -1.1), (-0.56, -0.52), (-0.49, -0.46), (0.06, 0.03), (0.58, 0.42)],
        driver_y=0.33, hip_f=(-0.1, 0.5), benches=[(-0.8, 1.08, 0.53)], seats=4,
        dash=(0.7, 0.45, 0.64, 0.6, 0.91), wheel_c=(0.3, 0.84),
        mirror=(0.6, 0.66, 0.935), mirror_out=0.15,
        seat_w=0.46,
    )

    def glass_region(i):
        seg, xb, xr_ = i['seg'], i['xb'], i['xr']
        if seg == 'side':
            if i['zone'] == 'front' or xb > 0.58:
                return 'black'
            if -0.56 < xb < -0.49:
                return 'gloss'
            if xb < -1.24:
                return 'paint'
            return 'glass'
        if seg == 'corner':
            return 'paint'
        if xr_ > 0.03 or xr_ < -1.36:
            return 'glass'
        return 'paint'

    p['glass_region'] = glass_region
    p['decor'] = hatch_decor
    return p


def hatch_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    # Big round headlamps on the front corners in chrome rings, a small lamp above each.
    hf = aim((x1 - 0.2, 0.54, 0.6), 0.5, 0.04)
    lamp(o, pr, hf, circle_pts((0, 0), 0.108, 20 if res else 10), 'head', res, 'chrome', 0.018, 0.006, bw=0.02)
    if res:
        lamp(o, pr, hf, circle_pts((0, 0), 0.066, 16), 'chrome', res, None, 0.004, 0.02, rings=2)
        lamp(o, pr, hf, circle_pts((0, 0), 0.03, 10), 'head', res, None, 0.004, 0.026, rings=2)
    sf = aim((x1 - 0.12, 0.47, 0.745), 0.35, 0.2)
    lamp(o, pr, sf, rounded(rrect_pts((0, 0), 0.11, 0.05, 0.024, 2), 1), 'head', res, 'chrome', 0.006, 0.006, bw=0.008)
    # The chrome whiskers across the nose, swept up to the lamps.
    whisk = [(-0.36, 0.665), (-0.24, 0.69), (-0.1, 0.7), (0.1, 0.7), (0.24, 0.69), (0.36, 0.665)]
    line(o, pr, 'front', whisk, 0.022 if res else 0.03, 'chrome', 0.006)
    # The lower intake under the plate, with bars, round fog lamps in the corners.
    low = rounded([(-0.34, 0.39), (0.34, 0.39), (0.4, 0.27), (-0.4, 0.27)], 2)
    flat(o, pr, 'front', low, 'grille', 0.004, bezel=(0.012, 'gloss', 0.003), res=res)
    if res:
        for z, w in ((0.355, 0.36), (0.315, 0.38)):
            line(o, pr, 'front', [(-w, z), (w, z)], 0.012, 'gloss', 0.007)
    plate(o, pr, 'front', (0.0, 0.47), 0.3, 0.12)
    ff = aim((x1 - 0.25, 0.6, 0.33), 0.55, 0.0)
    flat(o, pr, ff, rounded(rrect_pts((0, 0), 0.13, 0.08, 0.035, 2), 1), 'grille', 0.004, both=True, bezel=(0.01, 'gloss', 0.003), res=res)
    if res:
        lamp(o, pr, ff, circle_pts((0.0, 0.0), 0.03, 10), 'head', res, 'chrome', 0.004, 0.009, bw=0.006, rings=2)
    line(o, pr, 'front', [(-0.66, 0.255), (0.66, 0.255)], 0.03, 'black', 0.003)
    # Indicators low on the front wings.
    if res:
        lamp(o, pr, 'side', rounded(rrect_pts((1.36, 0.6), 0.05, 0.022, 0.01, 2), 1), 'amber', res, 'gloss', 0.003, 0.004, bw=0.004, rings=2)

    # Tail lamps: tall rounded rings on the back corners with a body-coloured centre.
    tf = aim((x0 + 0.12, 0.66, 0.79), math.pi - 0.62, 0.02)
    tail = rounded(rrect_pts((0, 0), 0.13, 0.27, 0.06, 3), 1)
    lamp(o, pr, tf, tail, 'tail', res, 'chrome', 0.006, 0.006, bw=0.01)
    if res:
        lamp(o, pr, tf, circle_pts((0.0, 0.035), 0.04, 14), 'paint', res, 'chrome', 0.003, 0.014, bw=0.008, rings=2)
        lamp(o, pr, tf, rounded(rrect_pts((0.0, -0.085), 0.07, 0.035, 0.015, 2), 1), 'white', res, None, 0.002, 0.012, rings=2)
    # The tailgate: plate in the middle, a chrome handle bar over it, the bumper and its reflectors.
    plate(o, pr, 'rear', (0.0, 0.69), 0.3, 0.13)
    if res:
        line(o, pr, 'rear', [(-0.22, 0.79), (0.22, 0.79)], 0.035, 'chrome', 0.007)
        gaps(o, pr, [[(-0.52, 0.95), (-0.56, 0.62), (-0.5, 0.55), (0.5, 0.55), (0.56, 0.62), (0.52, 0.95)]], frame='rear', both=False)
    line(o, pr, 'rear', [(-0.68, 0.33), (0.68, 0.33)], 0.13, 'black', 0.003)
    if res:
        for s in (1, -1):
            flat(o, pr, 'rear', rrect_pts((s * 0.48, 0.33), 0.1, 0.025, 0.01, 2), 'tail', 0.006, rings=1)
        o.body.extend(cyl((x0 + 0.12, -0.42, 0.25), (x0 - 0.02, -0.42, 0.25), 0.026, 'chrome', 10, caps=False))
        o.body.extend(cyl((x0 + 0.0, -0.42, 0.25), (x0 - 0.019, -0.42, 0.25), 0.02, 'gap', 10))

    if res:
        # Panel gaps: the long door, the sill; the clamshell bonnet; the fuel flap.
        rear_arch = arch_pts(xr, R, R + 0.09, 70, 8, 6)
        gaps(o, pr, [
            [(0.66, 0.9), (0.68, 0.7), (0.65, 0.5), (0.6, 0.29)],
            [(-0.52, 0.91), (-0.54, 0.6), (-0.52, 0.29)],
            [(0.6, 0.29), (-0.52, 0.29)],
        ])
        gaps(o, pr, [[(0.72, 0.68), (1.1, 0.67), (1.38, 0.62), (1.5, 0.58)]], frame='top')
        line(o, pr, 'side', circle_pts((-1.36, 0.8), 0.055, 14), 0.006, 'gap', 0.0015, closed=True)
        handle(o, pr, -0.38, 0.82, 'chrome', 0.12, 0.028)
        # Chrome along the bottom of the side windows, a rubbing strip low on the doors.
        line(o, prg, 'side', along(p['shoulder'], 0.56, -1.2, 12, -0.004), 0.014, 'chrome', 0.004, both=True)
        line(o, pr, 'side', [(0.58, 0.42), (-0.48, 0.42)], 0.03, 'black', 0.004, both=True)
        # Wheel-arch lips.
        for (xc, a0, a1) in ((xf, 8, 172), (xr, 8, 172)):
            line(o, pr, 'side', arch_pts(xc, R, R + 0.06, a0, a1, 14), 0.018, 'black', 0.003, both=True)
    # Cowl and wipers under the windscreen, a rear wiper, an aerial on the roof.
    cx = p['ws_base'] - 0.03
    line(o, pr, 'top', [(cx, -0.6), (cx, 0.6)], 0.06, 'black', 0.003)
    if res:
        for (a, b) in ((0.45, -0.05), (-0.05, -0.55)):
            o.body.extend(tube([Vector((cx - 0.02, a, p['roof_z'](cx - 0.02) + 0.01)), Vector((cx - 0.12, b, p['roof_z'](cx - 0.12) + 0.012))], 0.007, 'black', 4))
        o.body.extend(tube([Vector((-1.555, 0.0, 1.02)), Vector((-1.47, 0.22, 1.27))], 0.007, 'black', 4))
        o.body.extend(cyl((-0.15, 0.0, p['roof_z'](-0.15) - 0.005), (-0.3, 0.0, p['roof_z'](-0.15) + 0.3), 0.004, 'black', 4))
        o.body.extend(cyl((-0.15, 0.0, p['roof_z'](-0.15) - 0.01), (-0.15, 0.0, p['roof_z'](-0.15) + 0.02), 0.018, 'black', 8))
        # A body-coloured band across the dashboard.
        d = p['dash']
        o.body.extend(rbox((d[1] - 0.008, 0.0, (d[3] + d[4]) / 2 + 0.06), (0.012, d[2] - 0.04, 0.07), 0.01, 'paint', 1))


@car
def hatch(res):
    return closed_car(res, hatch_params())


# ------------------------------------------------------------------ helpers for the open cars

def sweep(path, profile, region, caps=True):
    """
    A bar swept along a path (bumpers, nerf bars): `path` is a list of 3D points, `profile` a
    closed loop of (out, up) offsets, `out` horizontal and square to the path (away from the
    car's middle), `up` straight up.
    """
    path = [Vector(p) for p in path]
    n = len(path)
    m = Mesh()
    rows = []
    for i, p in enumerate(path):
        t = path[min(n - 1, i + 1)] - path[max(0, i - 1)]
        t.z = 0
        t.normalize()
        nrm = Vector((t.y, -t.x, 0.0))
        if nrm.dot(Vector((p.x, p.y, 0.0))) < 0:
            nrm = -nrm
        rows.append([p + nrm * a + Vector((0, 0, b)) for (a, b) in profile])
    m.grid(rows, region, wrap_v=True)
    if caps:
        for row in (rows[0], rows[-1]):
            c = sum(row, Vector()) / len(row)
            ci = m.vert(c)
            ids = [m.vert(q) for q in row]
            for k in range(len(ids)):
                m.face((ci, ids[k], ids[(k + 1) % len(ids)]), region)
    # Wind every face away from the path.
    for i, f in enumerate(m.f):
        cen = sum((m.v[j] for j in f), Vector()) / len(f)
        best = min(path, key=lambda q: (q - cen).length)
        if _fnormal(m, f).dot(cen - best) < 0:
            m.f[i] = tuple(reversed(f))
    return m


def plan_bar(x_mid, half_w, wrap, z, sign=1, n=14, p=4.0):
    """A path across one end of the car: straight in the middle, swept back round the corners."""
    pts = []
    for k in range(n + 1):
        u = math.sin((-1 + 2 * k / n) * math.pi / 2)
        pts.append((x_mid - sign * wrap * abs(u) ** p, half_w * u, z))
    return pts


def rr_profile(d, h, r, n=3):
    """A rounded-rectangle cross-section (out, up), d deep and h tall."""
    return list(reversed(rrect_pts((0.0, 0.0), d, h, r, n)))


def wrap_screen(o, res, hull, xc, hw, wrap, zt, rake, hw_t, wrap_t, droop=0.04, post_r=0.017, region_frame='chrome'):
    """
    A wraparound windscreen: glass from the cowl (centre at xc, half width hw, swept back by
    `wrap` at the corners) up to the top rail (zt, raked back by `rake`), with a chrome frame
    and posts, seen from both sides. Returns the points along its top.
    """
    nu = 18 if res else 8
    nv = 3 if res else 1
    m = Mesh()
    rows = []
    tops, bases = [], []
    for k in range(nu + 1):
        u = math.sin((-1 + 2 * k / nu) * math.pi / 2)
        bx = xc - wrap * abs(u) ** 4
        by = hw * u
        bz = hull.surface_z(bx, min(abs(by), hull.edge_y(bx))) + 0.004
        tx = xc - rake - wrap_t * abs(u) ** 4
        B = Vector((bx, by, bz))
        T = Vector((tx, hw_t * u, zt - droop * u * u))
        bases.append(B)
        tops.append(T)
        col = []
        for j in range(nv + 1):
            s = j / nv
            q = B.lerp(T, s)
            q.x += 0.02 * math.sin(math.pi * s)  # a slight bow forward
            col.append(q)
        rows.append(col)
    g = Mesh()
    g.grid(rows, 'glass')
    centre = Vector((xc - 1.2, 0.0, 0.9))
    for i, f in enumerate(g.f):
        cen = sum((g.v[j] for j in f), Vector()) / len(f)
        if _fnormal(g, f).dot(cen - centre) < 0:
            g.f[i] = tuple(reversed(f))
    m.extend(g)
    if res:
        back = g.copy()
        back.f = [tuple(reversed(f)) for f in back.f]
        m.extend(back)
    seg = 8 if res else 4
    m.extend(tube(tops, 0.013 if res else 0.02, region_frame, seg))
    for s in (0, -1):
        m.extend(tube([bases[s] + Vector((0, 0, -0.03)), bases[s], tops[s]], post_r, region_frame, seg))
    if res:
        m.extend(tube(bases, 0.008, 'black', 4))
    o.body.extend(m)
    return tops


def bullet_mirror(x, y, z, res=1):
    """A chrome bullet mirror on a stalk, on top of the driver's door."""
    m = Mesh()
    m.extend(cyl((x, y, z), (x - 0.01, y + 0.01, z + 0.07), 0.009, 'chrome', 6))
    c = Vector((x - 0.01, y + 0.012, z + 0.1))
    m.extend(lathe([(0.0, -0.07), (0.03, -0.06), (0.045, -0.02), (0.046, 0.0), (0.0, 0.0)], 'chrome', 12 if res else 6, axis=(1, 0, 0), c=c))
    if res:
        m.extend(cyl(c + Vector((-0.002, 0, 0)), c + Vector((-0.004, 0, 0)), 0.04, 'mirror', 12))
    return m


# ------------------------------------------------------------------ the Riviera Convertible

def convertible_params():
    L, W = 5.2, 1.98
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.62, -1.38
    R = 0.345
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.21, track=1.58, arch_gap=0.05, rim='fullcap', tyre='wall', rim_ratio=0.56, color=0xff6fae,
        bottom=C((x0, 0.44), (x0 + 0.15, 0.32), (x0 + 0.5, 0.26), (xr, 0.21), (xf, 0.21), (x1 - 0.5, 0.26), (x1 - 0.12, 0.31), (x1, 0.37)),
        shoulder=C((x0, 0.87), (x0 + 0.04, 0.95), (x0 + 0.12, 0.985), (x0 + 0.35, 0.995), (-1.9, 0.965), (-1.3, 0.92), (0.0, 0.9), (0.8, 0.895), (1.6, 0.885), (x1 - 0.2, 0.87), (x1, 0.835)),
        top=C((x0, 0.85), (x0 + 0.05, 0.86), (x0 + 0.25, 0.872), (-1.9, 0.89), (-1.3, 0.905), (0.0, 0.905), (0.8, 0.905), (1.6, 0.88), (x1 - 0.2, 0.86), (x1, 0.825)),
        width=C((x0, 0.955), (x0 + 0.6, 0.985), (0.0, 0.99), (x1 - 0.6, 0.985), (x1, 0.97)),
        tuck=const(0.075), tumble=const(0.02), cfrac=const(0.66),
        rb=const(0.06), rs=C((x0, 0.02), (-1.6, 0.025), (0.0, 0.035), (x1, 0.03)),
        front=(0.36, 4.0), rear=(0.18, 3.6),
        flares=[],
        open=[(-1.34, 0.74, 0.27)], lip=0.06,
        glass=False, height=1.34,
        bl_base=-1.34, ws_base=0.74, inset=0.03,
        driver_y=0.4, hip_f=(-0.1, 0.5), benches=[(-0.95, 1.26, 0.51)], seats=4,
        seat_w=0.68, seat_back=0.56, headrests=False, seat_region='white', console=False,
        dash=(0.86, 0.66, 0.82, 0.54, 0.81), dash_region='paint', wheel_c=(0.3, 0.8), wheel_r=0.2, wheel_tilt=0.55, wheel_region='white',
        mirror=None,
    )

    def hull_region(i, hull):
        seg, c = i['seg'], i['c']
        if seg == 'lip':
            return 'chrome'
        if seg == 'in':
            # White door cards and seat backs to the tub, carpet on the floor.
            return 'white' if c.z > 0.36 and abs(c.y) > 0.5 else 'interior'
        return None

    p['hull_region'] = hull_region
    p['decor'] = convertible_decor
    return p


def convertible_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    # The full-width grille with quad headlamps at its ends, chrome over it.
    gr = rounded(rrect_pts((0.0, 0.645), 1.72, 0.27, 0.05, 2), 1)
    flat(o, pr, 'front', gr, 'grille', 0.004, bezel=(0.022, 'chrome', 0.006), res=res)
    if res:
        for z in (0.56, 0.6, 0.64, 0.68, 0.72):
            line(o, pr, 'front', [(-0.42, z), (0.42, z)], 0.008, 'chrome', 0.008)
        for k in range(-6, 7):
            line(o, pr, 'front', [(k * 0.065, 0.54), (k * 0.065, 0.75)], 0.006, 'chrome', 0.009)
    for yc in (0.74, 0.56):
        lamp(o, pr, 'front', circle_pts((yc, 0.645), 0.072, 18 if res else 8), 'head', res, 'chrome', 0.014, 0.012, bw=0.016)
        if res:
            lamp(o, pr, 'front', circle_pts((yc, 0.645), 0.022, 8), 'chrome', res, None, 0.003, 0.03, rings=1)
    line(o, pr, 'front', [(-0.94, 0.805), (0.94, 0.805)], 0.018, 'chrome', 0.006)
    # Big wraparound chrome bumpers with guards; the plate in the front one.
    fb = sweep(plan_bar(x1 + 0.02, 0.985, 0.2, 0.4, 1, 16 if res else 8), rr_profile(0.11, 0.15, 0.05, 3 if res else 1), 'chrome')
    o.body.extend(fb)
    for s in (1, -1):
        o.body.extend(rbox((x1 + 0.06, s * 0.42, 0.43), (0.06, 0.05, 0.11), 0.045, 'chrome', 2 if res else 1))
    pfb = Projector(fb)
    plate(o, pfb, 'front', (0.0, 0.4), 0.3, 0.13, 0.01)
    if res:
        for s in (1, -1):
            flat(o, pfb, 'front', rrect_pts((s * 0.72, 0.4), 0.16, 0.05, 0.02, 2), 'amber', 0.006, rings=1)
    # Tail: round lamps two a side in a chrome-edged panel, the plate between, a bumper below.
    tp = rounded(rrect_pts((0.0, 0.705), 1.8, 0.2, 0.04, 2), 1)
    flat(o, pr, 'rear', tp, 'paint', 0.003, bezel=(0.016, 'chrome', 0.005), res=res)
    for yc in (0.76, 0.54):
        lamp(o, pr, 'rear', circle_pts((yc, 0.705), 0.07, 18 if res else 8), 'tail', res, 'chrome', 0.012, 0.012, bw=0.016)
        if res:
            lamp(o, pr, 'rear', circle_pts((yc, 0.705), 0.022, 8), 'chrome', res, None, 0.003, 0.028, rings=1)
    plate(o, pr, 'rear', (0.0, 0.7), 0.3, 0.13)
    rbm = sweep(plan_bar(x0 - 0.02, 0.985, 0.22, 0.42, -1, 16 if res else 8), rr_profile(0.11, 0.16, 0.05, 3 if res else 1), 'chrome')
    o.body.extend(rbm)
    if res:
        prb = Projector(rbm)
        for s in (1, -1):
            flat(o, prb, 'rear', rrect_pts((s * 0.32, 0.42), 0.18, 0.05, 0.02, 2), 'white', 0.006, rings=1)
            o.body.extend(cyl((x0 + 0.25, s * 0.5, 0.26), (x0 - 0.0, s * 0.5, 0.26), 0.03, 'chrome', 10, caps=False))
            o.body.extend(cyl((x0 + 0.02, s * 0.5, 0.26), (x0 + 0.001, s * 0.5, 0.26), 0.024, 'gap', 10))
        # The fins: chrome along their tops, all the way from the headlamps.
        line(o, pr, 'side', along(p['shoulder'], 2.45, x0 + 0.04, 30, -0.008), 0.016, 'chrome', 0.005, both=True)

    # The wraparound windscreen with its chrome frame, a mirror on it (the low detail's goes
    # on after its glass has been made opaque: it stays see-through).
    p['screen'] = lambda o, res: wrap_screen(o, res, hull, 0.76, 0.905, 0.42, 1.33, 0.3, 0.87, 0.2)
    if res:
        tops = p['screen'](o, res)
        tc = tops[len(tops) // 2]
        o.body.extend(cyl(tc + Vector((-0.02, 0, -0.01)), tc + Vector((-0.07, 0, -0.06)), 0.008, 'chrome', 6))
        o.body.extend(rbox(tc + Vector((-0.08, 0, -0.09)), (0.015, 0.11, 0.03), 0.012, 'black', 1))
        o.body.extend(bullet_mirror(0.5, 0.95, hull.surface_z(0.5, 0.95) - 0.005, res))
    # The folded top under a padded cover behind the rear seat.
    o.body.extend(rbox((-1.52, 0.0, 0.93), (0.2, 0.84, 0.075), 0.07, 'white', 3 if res else 1))
    if res:
        # Side chrome: a spear along the flanks, a rocker strip, chrome round the arches.
        line(o, pr, 'side', [(2.42, 0.655), (1.0, 0.66), (-1.0, 0.665), (-2.45, 0.67)], 0.022, 'chrome', 0.005, both=True)
        line(o, pr, 'side', [(xf - R - 0.06, 0.28), (xr + R + 0.06, 0.28)], 0.035, 'chrome', 0.004, both=True)
        for xc in (xf, xr):
            line(o, pr, 'side', arch_pts(xc, R, R + 0.065, 6, 174, 16), 0.016, 'chrome', 0.004, both=True)
        # Panel gaps: the long door, the bonnet and boot lids.
        gaps(o, pr, [
            [(0.36, 0.88), (0.39, 0.6), (0.36, 0.3)],
            [(-0.8, 0.89), (-0.82, 0.6), (-0.8, 0.3)],
        ])
        gaps(o, pr, [[(0.8, 0.86), (2.45, 0.86)]], frame='top')
        gaps(o, pr, [[(0.8, -0.86), (0.8, 0.86)]], frame='top', both=False)
        gaps(o, pr, [[(-1.7, 0.84), (-2.5, 0.84)]], frame='top')
        gaps(o, pr, [[(-1.7, -0.84), (-1.7, 0.84)]], frame='top', both=False)
        handle(o, pr, -0.64, 0.8, 'chrome', 0.13, 0.026)
        # Chrome vents on the front wings.
        for k in range(3):
            line(o, pr, 'side', [(1.05 - k * 0.07, 0.72), (0.95 - k * 0.07, 0.72)], 0.012, 'chrome', 0.005, both=True)
        # A slim chrome spear down the bonnet.
        line(o, pr, 'top', [(1.0, 0.0), (2.4, 0.0)], 0.018, 'chrome', 0.006)
        # Dashboard: a chrome strip, round gauges in front of the driver, a radio in the middle.
        d = p['dash']
        o.body.extend(rbox((d[1] - 0.006, 0.0, d[4] - 0.07), (0.008, d[2] - 0.05, 0.012), 0.006, 'chrome', 1))
        for dy in (-0.09, 0.09):
            c = (d[1] - 0.004, p['driver_y'] + dy, d[4] - 0.15)
            o.body.extend(cyl(c, (c[0] - 0.012, c[1], c[2]), 0.05, 'chrome', 14))
            o.body.extend(cyl((c[0] - 0.012, c[1], c[2]), (c[0] - 0.014, c[1], c[2]), 0.042, 'white', 14))
        o.body.extend(rbox((d[1] - 0.006, 0.0, d[4] - 0.17), (0.01, 0.13, 0.04), 0.01, 'chrome', 1))
        # The horn ring on the steering wheel.
        sw = p['wheel_c']
        ax = Vector((-math.cos(p['wheel_tilt']), 0, math.sin(p['wheel_tilt'])))
        o.body.extend(torus(Vector((sw[0], p['driver_y'], sw[1])) + ax * 0.03, ax, 0.12, 0.007, 'chrome', 16, 4))
    else:
        # Low detail: the seats as plain blocks.
        hip = p['hip_f']
        for (x, z, w) in ((hip[0], hip[1], 1.4), (p['benches'][0][0], p['benches'][0][2], 1.26)):
            o.body.extend(rbox((x + 0.04, 0, z - 0.15), (0.25, w / 2, 0.06), 0.03, 'white', 1))
            o.body.extend(rbox((x - 0.22, 0, z + 0.1), (0.05, w / 2, 0.24), 0.03, 'white', 1))


@car
def convertible(res):
    p = convertible_params()
    o = closed_car(res, p)
    if not res:
        p['screen'](o, res)
    return o


# ------------------------------------------------------------------ the Dune Buggy

def rounded_path(pts, r=0.08, n=3):
    """A polyline with its inner corners rounded off (for bent tubes)."""
    pts = [Vector(p) for p in pts]
    out = [pts[0]]
    for a, b, c in zip(pts, pts[1:], pts[2:]):
        d0 = (a - b)
        d1 = (c - b)
        rr = min(r, d0.length * 0.45, d1.length * 0.45)
        p0 = b + d0.normalized() * rr
        p1 = b + d1.normalized() * rr
        for k in range(n + 1):
            t = k / n
            out.append(p0 * (1 - t) ** 2 + b * 2 * t * (1 - t) + p1 * t * t)
    out.append(pts[-1])
    return out


def vw_engine(x, z, res):
    """An air-cooled flat four seen from behind: crankcase, finned barrels, fan shroud, carbs, exhaust."""
    m = Mesh()
    s2 = 2 if res else 1
    m.extend(rbox((x + 0.4, 0, z - 0.12), (0.26, 0.22, 0.13), 0.05, 'metal', s2))  # gearbox
    m.extend(rbox((x, 0, z - 0.04), (0.2, 0.2, 0.14), 0.05, 'metal', s2))  # crankcase
    for s in (1, -1):
        m.extend(rbox((x, s * 0.31, z), (0.17, 0.11, 0.1), 0.04, 'black', s2))  # barrels and heads
        if res:
            for k in range(4):
                m.extend(cyl((x - 0.12 + k * 0.08, s * 0.2, z), (x - 0.12 + k * 0.08, s * 0.42, z), 0.07, 'metal', 10, caps=False))
            m.extend(rbox((x, s * 0.43, z), (0.15, 0.015, 0.075), 0.01, 'metal', 1))
    # The fan shroud on top, the generator on it, the pulley at the back.
    m.extend(rbox((x - 0.02, 0, z + 0.17), (0.17, 0.33, 0.08), 0.07, 'chrome', s2))
    m.extend(cyl((x - 0.2, 0, z + 0.22), (x + 0.12, 0, z + 0.22), 0.1, 'chrome', 14 if res else 8))
    m.extend(cyl((x - 0.24, 0, z - 0.02), (x - 0.2, 0, z - 0.02), 0.085, 'chrome', 14 if res else 8))
    if res:
        m.extend(torus((x - 0.22, 0, z + 0.1), (1, 0, 0), 0.075, 0.012, 'black', 16, 4))
        m.extend(cyl((x - 0.24, 0, z + 0.22), (x - 0.205, 0, z + 0.22), 0.05, 'metal', 12))
        # Twin carbs with round chrome air cleaners.
        for s in (1, -1):
            m.extend(cyl((x + 0.02, s * 0.2, z + 0.12), (x + 0.02, s * 0.2, z + 0.3), 0.025, 'metal', 8))
            m.extend(cyl((x + 0.02, s * 0.2, z + 0.3), (x + 0.02, s * 0.2, z + 0.37), 0.095, 'chrome', 16))
        # Headers sweeping under to two chrome tailpipes.
        for s in (1, -1):
            m.extend(tube(rounded_path([(x + 0.05, s * 0.36, z - 0.08), (x + 0.0, s * 0.3, z - 0.2), (x - 0.15, s * 0.18, z - 0.22), (x - 0.3, s * 0.16, z - 0.12)], 0.06), 0.022, 'metal', 6))
            m.extend(cyl((x - 0.28, s * 0.16, z - 0.13), (x - 0.42, s * 0.16, z - 0.07), 0.035, 'chrome', 12, caps=False))
            m.extend(cyl((x - 0.41, s * 0.16, z - 0.075), (x - 0.405, s * 0.16, z - 0.077), 0.03, 'gap', 12))
    return m


def buggy_build(res):
    from carcommon import Out, wheels_into, cabin_meta, arches
    from carbody import Hull
    x0, x1 = -1.42, 1.66
    xf, xr = 1.05, -0.98
    R, Rr = 0.33, 0.36
    trf, trr = 1.38, 1.42
    twf, twr = 0.2, 0.3
    o = Out()
    open_ = [(-0.74, 0.5, 0.33)]

    def region(i):
        seg, c = i['seg'], i['c']
        if seg == 'bot':
            return 'black'
        if seg == 'in':
            return 'paint' if c.z > 0.42 else 'interior'
        return None

    hull = Hull(x0, x1,
                bottom=C((x0, 0.5), (x0 + 0.12, 0.4), (xr, 0.33), (xf, 0.33), (x1 - 0.2, 0.36), (x1, 0.46)),
                shoulder=C((x0, 0.62), (x0 + 0.1, 0.72), (xr - 0.2, 0.84), (xr, 0.86), (xr + 0.35, 0.8), (-0.3, 0.68), (0.25, 0.7), (xf - 0.3, 0.8), (xf, 0.82), (x1 - 0.25, 0.72), (x1 - 0.05, 0.6), (x1, 0.55)),
                top=C((x0, 0.63), (x0 + 0.1, 0.7), (xr, 0.74), (-0.3, 0.72), (0.4, 0.72), (xf, 0.7), (x1 - 0.2, 0.64), (x1 - 0.05, 0.585), (x1, 0.56)),
                width=C((x0, 0.68), (xr, 0.74), (-0.3, 0.7), (xf, 0.72), (x1 - 0.2, 0.68), (x1, 0.62)),
                tuck=const(0.07), tumble=const(0.05), cfrac=const(0.6), rb=const(0.06), rs=const(0.08),
                front=(0.45, 2.2), rear=(0.26, 2.6), open=open_, lip=0.04, region=region,
                flares=[(xf, 0.5, 0.075, 0.68, 0.3), (xr, 0.55, 0.09, 0.72, 0.3)], keys=[xf, xr])
    hm = hull.build(res)
    hm = arches(hm, [(xf, R, R + 0.07), (xr, Rr, Rr + 0.07)], 0.5, 0.95, 0.0, res)
    o.body.extend(hm)
    pr = Projector(hm)
    seg = 8 if res else 4
    tr = 0.024

    # The roll cage: a main hoop behind the seats, front posts, roof rails, a diagonal, back stays.
    zt = 1.42
    cage = Mesh()
    cage.extend(tube(rounded_path([(-0.68, 0.62, 0.42), (-0.68, 0.62, zt), (-0.68, -0.62, zt), (-0.68, -0.62, 0.42)], 0.14), tr, 'gloss', seg))
    for s in (1, -1):
        cage.extend(tube(rounded_path([(0.5, s * 0.6, 0.6), (0.12, s * 0.57, zt - 0.02), (-0.66, s * 0.6, zt)], 0.12), tr * 0.9, 'gloss', seg))
        cage.extend(tube([(-0.7, s * 0.55, zt - 0.03), (-1.3, s * 0.42, 0.72)], tr * 0.9, 'gloss', seg))
    cage.extend(tube([(0.14, 0.57, zt - 0.02), (0.14, -0.57, zt - 0.02)], tr * 0.9, 'gloss', seg))
    cage.extend(tube([(-0.68, 0.62, 0.62), (-0.68, -0.5, zt - 0.06)], tr * 0.8, 'gloss', seg))
    o.body.extend(cage)
    # Two spot lamps on the front of the roof.
    for s in (1, -1):
        c = Vector((0.2, s * 0.27, zt + 0.07))
        o.body.extend(cyl((0.14, s * 0.27, zt), c, 0.012, 'gloss', 6))
        o.body.extend(lathe([(0.0, -0.12), (0.05, -0.1), (0.075, -0.03), (0.08, 0.0)], 'chrome', 14 if res else 6, axis=(1, 0, 0), c=c + Vector((0.07, 0, 0))))
        o.body.extend(cyl(c + Vector((0.068, 0, 0)), c + Vector((0.072, 0, 0)), 0.074, 'head', 14 if res else 6))

    # Headlamps: chrome buckets standing on the bonnet.
    for s in (1, -1):
        y = s * 0.4
        zb = hull.surface_z(1.3, abs(y))
        c = Vector((1.38, y, zb + 0.09))
        o.body.extend(cyl((1.3, y, zb - 0.01), (1.33, y, zb + 0.05), 0.02, 'chrome', 6))
        o.body.extend(lathe([(0.0, -0.13), (0.06, -0.11), (0.085, -0.04), (0.09, 0.0)], 'chrome', 16 if res else 6, axis=(1, 0, 0), c=c))
        o.body.extend(cyl(c + Vector((-0.004, 0, 0)), c + Vector((0.006, 0, 0)), 0.083, 'head', 16 if res else 6))
    # A tubular bumper in front of the nose with the plate on it.
    fb = rounded_path([(1.3, 0.5, 0.36), (1.8, 0.5, 0.4), (1.86, 0.3, 0.42), (1.86, -0.3, 0.42), (1.8, -0.5, 0.4), (1.3, -0.5, 0.36)], 0.12)
    o.body.extend(tube(fb, 0.028, 'chrome', seg))
    o.body.extend(rbox((1.9, 0, 0.42), (0.008, 0.16, 0.065), 0.006, 'plate', 1))
    o.body.extend(rbox((1.886, 0, 0.42), (0.01, 0.17, 0.075), 0.006, 'black', 1))
    # The engine out at the back, a hoop round it, the plate and tail lamps.
    o.body.extend(vw_engine(-1.5, 0.6, res))
    rb_ = rounded_path([(-1.25, 0.6, 0.5), (-1.78, 0.58, 0.48), (-1.84, 0.4, 0.46), (-1.84, -0.4, 0.46), (-1.78, -0.58, 0.48), (-1.25, -0.6, 0.5)], 0.12)
    o.body.extend(tube(rb_, 0.026, 'gloss', seg))
    o.body.extend(rbox((-1.86, -0.46, 0.6), (0.008, 0.15, 0.06), 0.006, 'plate', 1))
    o.body.extend(rbox((-1.848, -0.46, 0.6), (0.01, 0.16, 0.07), 0.006, 'black', 1))
    o.body.extend(cyl((-1.84, -0.46, 0.47), (-1.85, -0.46, 0.54), 0.012, 'gloss', 6))
    tf = aim((x0 + 0.1, 0.5, 0.64), math.pi - 0.3, 0.0)
    lamp(o, pr, tf, circle_pts((0, 0), 0.045, 14 if res else 6), 'tail', res, 'chrome', 0.008, 0.006, bw=0.01)
    if res:
        lamp(o, pr, 'front', circle_pts((0.5, 0.5), 0.03, 10), 'amber', res, 'chrome', 0.005, 0.006, bw=0.006, rings=2)
        # The bonnet lid's outline, filler cap.
        line(o, pr, 'top', rounded([(0.62, 0.28), (1.45, 0.24), (1.45, -0.24), (0.62, -0.28)], 2), 0.007, 'gap', 0.002, closed=True)
        o.body.extend(cyl((0.75, 0.0, hull.surface_z(0.75, 0.0) - 0.01), (0.75, 0.0, hull.surface_z(0.75, 0.0) + 0.02), 0.045, 'chrome', 12))

    # The cockpit: two low buckets, a dash panel with gauges, the wheel, a gear stick; a mirror.
    dy = 0.33
    hip = (-0.2, 0.5)
    if res:
        for s in (1, -1):
            o.body.extend(P.seat(hip[0] + 0.04, s * dy, hip[1] - 0.09, 0.44, 0.46, 0.6, 0.32, 'black'))
        o.body.extend(rbox((0.55, 0, 0.66), (0.06, 0.55, 0.08), 0.03, 'paint', 1))
        o.body.extend(rbox((0.49, dy, 0.66), (0.012, 0.16, 0.06), 0.02, 'black', 1))
        for dd in (-0.07, 0.07):
            o.body.extend(cyl((0.48, dy + dd, 0.665), (0.475, dy + dd, 0.665), 0.04, 'white', 12))
        o.body.extend(P.steering_wheel((0.26, dy, 0.86), 0.62, 0.165, region='black'))
        o.body.extend(cyl((0.05, 0, 0.36), (-0.02, 0, 0.62), 0.01, 'chrome', 6))
        o.body.extend(cyl((-0.02, 0, 0.62), (-0.025, 0, 0.66), 0.025, 'black', 8))
        o.body.extend(rbox((0.1, 0, 0.38), (0.25, 0.08, 0.06), 0.03, 'interior', 1))
        mc = Vector((0.36, 0.66, 1.1))
        o.body.extend(cyl((0.33, 0.585, 1.02), mc, 0.008, 'gloss', 6))
        o.body.extend(cyl(mc, mc + Vector((0.025, 0.005, 0.0)), 0.06, 'chrome', 12))
        o.body.extend(cyl(mc + Vector((-0.002, 0, 0)), mc + Vector((-0.004, 0, 0)), 0.052, 'mirror', 12))
    else:
        o.body.extend(rbox((hip[0] - 0.22, 0, hip[1] + 0.12), (0.05, 0.5, 0.26), 0.03, 'black', 1))
        o.body.extend(rbox((hip[0] + 0.04, 0, hip[1] - 0.14), (0.24, 0.5, 0.06), 0.03, 'black', 1))
    cabin_meta(o, [(hip[0], dy, hip[1]), (hip[0], -dy, hip[1])], (hip[0] + 0.1, dy, hip[1] + 0.69))

    # Balloon tyres on chrome slotted wheels, the rear ones fat with a blocky tread.
    wseg = 20 if res else 8
    wf = P.wheel(R, twf, 'slot', 'road', 0.5, wseg, res)
    wr = P.wheel(Rr, twr, 'slot', 'knobby', 0.47, wseg, res)
    wheels_into(o, res, (xf, xr), trf, R, wf, wr, Rr, trr)
    o.meta['dims'] = [3.72, 1.74, zt + 0.1]
    o.meta['color'] = 0xff7a1a
    return o


@car
def buggy(res):
    return buggy_build(res)


# ------------------------------------------------------------------ the Bulldog Mini

def mini_params():
    L, W = 3.82, 1.73
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.2, -1.3
    R = 0.31
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.195, track=1.5, arch_gap=0.04, rim='twin', spokes=5, color=0x1f5a3a,
        bottom=C((x0, 0.42), (x0 + 0.1, 0.32), (x0 + 0.35, 0.24), (xr, 0.17), (xf, 0.17), (x1 - 0.35, 0.24), (x1 - 0.08, 0.33), (x1, 0.42)),
        shoulder=C((x0, 0.86), (x0 + 0.08, 0.92), (x0 + 0.3, 0.96), (-0.8, 0.955), (0.6, 0.915), (0.9, 0.895), (1.4, 0.86), (x1 - 0.15, 0.82), (x1 - 0.03, 0.76), (x1, 0.72)),
        top=C((x0, 0.88), (x0 + 0.08, 0.95), (x0 + 0.3, 0.985), (-0.8, 0.98), (0.6, 0.935), (1.4, 0.9), (x1 - 0.15, 0.85), (x1 - 0.03, 0.78), (x1, 0.74)),
        width=C((x0, 0.8), (x0 + 0.4, 0.83), (0.0, 0.835), (x1 - 0.4, 0.83), (x1, 0.8)),
        tuck=const(0.06), tumble=const(0.05), cfrac=const(0.7), rb=const(0.07), rs=const(0.06),
        front=(0.45, 2.6), rear=(0.3, 3.0),
        flares=[(xf, 0.5, 0.015, 0.55, 0.25), (xr, 0.5, 0.015, 0.55, 0.25)],
        open=[(-1.15, 0.7, 0.26)],
        bl_base=-1.68, ws_base=0.72, inset=0.03, between=2,
        roof_z=C((-1.68, 0.97), (-1.62, 1.12), (-1.55, 1.3), (-1.45, 1.38), (-1.2, 1.405), (-0.4, 1.41), (0.0, 1.4), (0.15, 1.37), (0.35, 1.22), (0.55, 1.07), (0.72, 0.93)),
        rail_z=C((-1.68, 0.96), (-1.62, 1.09), (-1.55, 1.25), (-1.45, 1.32), (-1.2, 1.345), (-0.4, 1.35), (0.0, 1.34), (0.15, 1.315), (0.35, 1.18), (0.55, 1.04), (0.72, 0.915)),
        rail_w=C((-1.68, 0.68), (-1.3, 0.66), (-0.4, 0.655), (0.2, 0.66), (0.72, 0.7)),
        corner=const(0.05),
        lines=[(-1.6, -1.6), (-1.5, -1.47), (-1.25, -1.15), (-0.56, -0.53), (-0.48, -0.46), (0.2, 0.17), (0.6, 0.45)],
        driver_y=0.36, hip_f=(-0.15, 0.48), benches=[(-0.95, 1.1, 0.5)], seats=4,
        dash=(0.72, 0.45, 0.68, 0.58, 0.9), wheel_c=(0.25, 0.83),
        mirror=(0.62, 0.7, 0.93), mirror_region='white', mirror_out=0.16,
    )

    def glass_region(i):
        seg, xb, xr_ = i['seg'], i['xb'], i['xr']
        if seg == 'side':
            if i['zone'] == 'front' or xb > 0.6 or -0.56 < xb < -0.48 or xb < -1.25:
                return 'gloss'
            return 'glass'
        if seg == 'corner':
            return 'gloss' if (xr_ > 0.17 or xr_ < -1.47) else 'white'
        if xr_ > 0.17 or xr_ < -1.47:
            return 'glass'
        return 'white'

    p['glass_region'] = glass_region
    p['decor'] = mini_decor
    return p


def mini_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    # Big round headlamps in the bonnet with LED rings, the hexagonal grille between them.
    hf = aim((x1 - 0.2, 0.56, 0.68), 0.42, 0.12)
    lamp(o, pr, hf, circle_pts((0, 0), 0.11, 20 if res else 10), 'head', res, 'chrome', 0.014, 0.006, bw=0.016)
    if res:
        line(o, pr, hf, circle_pts((0, 0), 0.085, 20), 0.012, 'white', 0.022, closed=True, both=True)
        lamp(o, pr, hf, circle_pts((0, 0), 0.04, 12), 'chrome', res, None, 0.004, 0.024, rings=2)
    hexg = [(-0.3, 0.62), (0.3, 0.62), (0.38, 0.49), (0.3, 0.35), (-0.3, 0.35), (-0.38, 0.49)]
    flat(o, pr, 'front', hexg, 'grille', 0.004, bezel=(0.02, 'chrome', 0.006), res=res)
    if res:
        line(o, pr, 'front', [(-0.37, 0.53), (0.37, 0.53)], 0.016, 'chrome', 0.008)
    plate(o, pr, 'front', (0.0, 0.43), 0.3, 0.11)
    line(o, pr, 'front', [(-0.6, 0.27), (0.6, 0.27)], 0.05, 'black', 0.003)
    ff = aim((x1 - 0.25, 0.62, 0.33), 0.55, 0.0)
    flat(o, pr, ff, circle_pts((0, 0), 0.05, 12), 'grille', 0.004, both=True, bezel=(0.01, 'gloss', 0.003), res=res)
    if res:
        lamp(o, pr, ff, circle_pts((0.0, 0.0), 0.032, 10), 'head', res, 'chrome', 0.004, 0.009, bw=0.006, rings=2)
        # A bonnet scoop, the side scuttles with indicators.
        zb = hull.surface_z(1.3, 0.0)
        o.body.extend(rbox((1.32, 0.0, zb + 0.015), (0.14, 0.17, 0.035), 0.03, 'gloss', 2))
        o.body.extend(rbox((1.42, 0.0, zb + 0.02), (0.012, 0.14, 0.02), 0.008, 'grille', 1))
        flat(o, pr, 'side', rounded(rrect_pts((1.38, 0.66), 0.16, 0.07, 0.02, 2), 1), 'chrome', 0.004, both=True, rings=1)
        lamp(o, pr, 'side', rrect_pts((1.38, 0.66), 0.06, 0.03, 0.01, 2), 'amber', res, None, 0.002, 0.008, rings=1)
    # Upright tail lamps on the back corners, a chrome handle over the plate, the black bumper.
    tf = aim((x0 + 0.1, 0.66, 0.8), math.pi - 0.5, 0.0)
    lamp(o, pr, tf, rounded(rrect_pts((0, 0), 0.16, 0.24, 0.04, 2), 1), 'tail', res, 'chrome', 0.006, 0.006, bw=0.01)
    if res:
        lamp(o, pr, tf, rrect_pts((-0.04, -0.06), 0.05, 0.05, 0.01, 2), 'white', res, None, 0.002, 0.016, rings=1)
        line(o, pr, 'rear', [(-0.24, 0.8), (0.24, 0.8)], 0.035, 'chrome', 0.007)
        gaps(o, pr, [[(-0.55, 0.96), (-0.58, 0.6), (-0.52, 0.53), (0.52, 0.53), (0.58, 0.6), (0.55, 0.96)]], frame='rear', both=False)
    plate(o, pr, 'rear', (0.0, 0.68), 0.3, 0.12)
    line(o, pr, 'rear', [(-0.7, 0.36), (0.7, 0.36)], 0.14, 'black', 0.003)
    if res:
        for s in (1, -1):
            o.body.extend(cyl((x0 + 0.12, s * 0.07, 0.27), (x0 - 0.03, s * 0.07, 0.27), 0.035, 'chrome', 12, caps=False))
            o.body.extend(cyl((x0 - 0.01, s * 0.07, 0.27), (x0 - 0.029, s * 0.07, 0.27), 0.029, 'gap', 12))
        # A roof spoiler over the hatch glass.
        o.body.extend(rbox((-1.47, 0.0, p['roof_z'](-1.42) + 0.005), (0.07, 0.6, 0.02), 0.018, 'white', 2))
        gaps(o, pr, [
            [(0.66, 0.9), (0.69, 0.7), (0.65, 0.5), (0.6, 0.3)],
            [(-0.52, 0.93), (-0.54, 0.6), (-0.52, 0.3)],
        ])
        gaps(o, pr, [[(0.74, 0.7), (1.2, 0.7), (1.6, 0.62), (1.8, 0.48)]], frame='top')
        handle(o, pr, -0.35, 0.86, 'chrome', 0.12, 0.028)
        line(o, prg, 'side', along(p['shoulder'], 0.6, -1.24, 12, -0.004), 0.016, 'chrome', 0.004, both=True)
    # Black plastic arch trims and sills.
    for xc in (xf, xr):
        line(o, pr, 'side', arch_pts(xc, R, R + 0.085, 4, 176, 28 if res else 10), 0.055, 'black', 0.006, both=True)
    line(o, pr, 'side', [(xf - R - 0.06, 0.27), (xr + R + 0.06, 0.27)], 0.08, 'black', 0.004, both=True)
    cx = p['ws_base'] - 0.03
    line(o, pr, 'top', [(cx, -0.62), (cx, 0.62)], 0.06, 'black', 0.003)
    if res:
        for (a, b) in ((0.48, -0.05), (-0.05, -0.58)):
            o.body.extend(tube([Vector((cx - 0.02, a, p['roof_z'](cx - 0.02) + 0.01)), Vector((cx - 0.12, b, p['roof_z'](cx - 0.12) + 0.012))], 0.007, 'black', 4))
        o.body.extend(rbox((-0.9, 0, p['roof_z'](-0.9) + 0.01), (0.07, 0.02, 0.025), 0.016, 'white', 1))


@car
def mini(res):
    return closed_car(res, mini_params())


# ------------------------------------------------------------------ the Käfer Classic

def fender(xc, zc, r0, h, y0, y1, a0, a1, res, stretch=0.0, region='paint'):
    """
    A separate bulbous wing round a wheel on the car's left: a half tube bent round the
    wheel centre (xc, zc) from angle a0 to a1 (degrees, 0 = forward, 90 = up), inner radius
    r0, bulging h, across y0..y1; its ends taper into the body. `stretch` draws the front
    (forward) half out. Lined underneath.
    """
    nu = 26 if res else 10
    nv = 8 if res else 4
    shell, liner = [], []
    for i in range(nu + 1):
        t = i / nu
        th = math.radians(a0 + (a1 - a0) * t)
        e = min(1.0, min(t, 1 - t) / 0.16)
        e = e * e * (3 - 2 * e)
        e = 0.25 + 0.75 * e
        d = Vector((math.cos(th) * (1 + stretch * max(0.0, math.cos(th))), 0, math.sin(th)))
        row = []
        for j in range(nv + 1):
            ph = math.pi * j / nv
            y = y0 + (y1 - y0) * (1 - math.cos(ph)) / 2
            rad = r0 + h * e * math.sin(ph) ** 0.6
            row.append(Vector((xc, y, zc)) + d * rad)
        shell.append(row)
        liner.append([Vector((xc, y0, zc)) + d * r0, Vector((xc, y1, zc)) + d * r0])
    m = Mesh()
    m.grid(shell, region)
    ln = Mesh()
    ln.grid(liner, 'liner')
    ymid = (y0 + y1) / 2
    for i, f in enumerate(m.f):
        cen = sum((m.v[j] for j in f), Vector()) / len(f)
        rel = Vector((cen.x - xc, 0, cen.z - zc))
        core = Vector((xc, ymid, zc)) + rel.normalized() * r0
        if _fnormal(m, f).dot(cen - core) < 0:
            m.f[i] = tuple(reversed(f))
    for i, f in enumerate(ln.f):
        cen = sum((ln.v[j] for j in f), Vector()) / len(f)
        if _fnormal(ln, f).dot(Vector((xc, cen.y, zc)) - cen) < 0:
            ln.f[i] = tuple(reversed(f))
    m.extend(ln)
    # Close the ends.
    for row in (shell[0], shell[-1]):
        c = sum(row, Vector()) / len(row)
        ci = m.vert(c)
        ids = [m.vert(q) for q in row]
        for k in range(len(ids) - 1):
            m.face((ci, ids[k], ids[k + 1]), region)
    return m


def fender_point(xc, zc, r0, h, y0, y1, ang, stretch=0.0, out=0.0):
    th = math.radians(ang)
    d = Vector((math.cos(th) * (1 + stretch * max(0.0, math.cos(th))), 0, math.sin(th)))
    return Vector((xc, (y0 + y1) / 2, zc)) + d * (r0 + h + out)


def beetle_params():
    L, W = 4.0, 1.54
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.2, -1.2
    R = 0.325
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.15, track=1.32, arch_gap=0.06, arch_in=0.5, rim='dogdish', rim_ratio=0.62, spokes=5, color=0x7fbfe0,
        bottom=C((x0, 0.44), (x0 + 0.2, 0.32), (xr, 0.27), (xf, 0.27), (x1 - 0.2, 0.32), (x1, 0.44)),
        shoulder=C((x0, 0.47), (x0 + 0.12, 0.57), (x0 + 0.35, 0.7), (-1.4, 0.84), (-1.0, 0.915), (-0.4, 0.93), (0.6, 0.92), (1.0, 0.86), (x1 - 0.4, 0.74), (x1 - 0.15, 0.61), (x1, 0.5)),
        top=C((x0, 0.49), (x0 + 0.12, 0.6), (x0 + 0.35, 0.76), (-1.4, 0.9), (-1.05, 0.985), (-0.4, 0.96), (0.62, 0.965), (1.0, 0.9), (x1 - 0.4, 0.79), (x1 - 0.15, 0.65), (x1, 0.52)),
        width=C((x0, 0.54), (x0 + 0.45, 0.62), (0.0, 0.665), (x1 - 0.45, 0.62), (x1, 0.54)),
        tuck=const(0.07), tumble=const(0.09), cfrac=const(0.5), rb=const(0.08), rs=const(0.13),
        front=(0.5, 2.0), rear=(0.5, 2.0),
        open=[(-0.95, 0.6, 0.27)],
        bl_base=-1.08, ws_base=0.62, inset=0.03, between=2,
        roof_z=C((-1.08, 0.99), (-1.0, 1.12), (-0.85, 1.3), (-0.6, 1.43), (-0.25, 1.49), (0.05, 1.48), (0.25, 1.42), (0.4, 1.3), (0.52, 1.13), (0.62, 0.97)),
        rail_z=C((-1.08, 0.98), (-1.0, 1.09), (-0.85, 1.25), (-0.6, 1.36), (-0.25, 1.41), (0.05, 1.4), (0.25, 1.35), (0.4, 1.25), (0.52, 1.1), (0.62, 0.955)),
        rail_w=C((-1.08, 0.5), (-0.5, 0.53), (0.3, 0.53), (0.62, 0.55)),
        corner=const(0.15),
        lines=[(-1.0, -1.0), (-0.92, -0.9), (-0.85, -0.72), (-0.32, -0.3), (-0.22, -0.2), (0.32, 0.3), (0.5, 0.42)],
        driver_y=0.32, hip_f=(-0.15, 0.5), benches=[(-0.82, 1.0, 0.52)], seats=4, seat_w=0.44,
        dash=(0.62, 0.44, 0.58, 0.64, 0.88), dash_region='paint', wheel_c=(0.22, 0.86), wheel_r=0.19, wheel_region='white', console=False,
        mirror=None,
    )

    def glass_region(i):
        seg, xb, xr_ = i['seg'], i['xb'], i['xr']
        if seg == 'side':
            if i['zone'] == 'front' or xb > 0.5 or -0.32 < xb < -0.22 or xb < -0.85:
                return 'paint'
            return 'glass'
        if seg == 'corner':
            return 'paint'
        if xr_ > 0.3 or (-1.02 < xr_ < -0.88 and i['k'] >= 5):
            return 'glass'
        return 'paint'

    p['glass_region'] = glass_region
    p['decor'] = beetle_decor
    return p


def beetle_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    # The four wings, the headlamps standing in the front ones, tail lamps on the rear ones.
    y0, y1 = 0.46, 0.78
    ff = dict(xc=xf, zc=R, r0=R + 0.05, h=0.12, y0=y0, y1=y1)
    rf = dict(xc=xr, zc=R, r0=R + 0.05, h=0.13, y0=y0, y1=y1)
    o.body.extend(fender(a0=-14, a1=196, res=res, stretch=0.35, **ff).both())
    o.body.extend(fender(a0=-16, a1=200, res=res, stretch=0.0, **rf).both())
    hc = fender_point(ang=52, stretch=0.35, out=-0.01, **ff) + Vector((0.06, 0.0, 0.07))
    hl = Mesh()
    hl.extend(lathe([(0.0, -0.2), (0.06, -0.17), (0.09, -0.08), (0.098, 0.0)], 'paint', 16 if res else 6, axis=(1, 0, 0), c=hc))
    hl.extend(torus(hc, (1, 0, 0), 0.094, 0.009, 'chrome', 16 if res else 6, 4 if res else 3))
    hl.extend(cyl(hc + Vector((-0.01, 0, 0)), hc + Vector((0.006, 0, 0)), 0.088, 'head', 16 if res else 6))
    tc = fender_point(ang=150, out=-0.03, **rf) + Vector((0.0, 0.0, 0.02))
    hl.extend(lathe([(0.0, -0.1), (0.045, -0.08), (0.055, -0.02), (0.056, 0.0)], 'paint', 12 if res else 6, axis=(-1, 0, 0), c=tc))
    hl.extend(cyl(tc + Vector((0.01, 0, 0)), tc + Vector((-0.006, 0, 0)), 0.05, 'tail', 12 if res else 6))
    if res:
        hl.extend(torus(tc, (-1, 0, 0), 0.053, 0.005, 'chrome', 12, 3))
        # Indicators on top of the front wings.
        ic = fender_point(ang=70, stretch=0.35, **ff)
        hl.extend(rbox(ic + Vector((0, 0, 0.0)), (0.04, 0.018, 0.018), 0.015, 'amber', 1))
    o.body.extend(hl.both())
    # Running boards between the wings.
    xa, xb_ = xf - (R + 0.05) * 0.98, xr + (R + 0.05) * 0.98
    rbd = Mesh()
    rbd.extend(rbox(((xa + xb_) / 2, (y0 + y1) / 2 + 0.01, 0.3), ((xa - xb_) / 2 + 0.04, (y1 - y0) / 2, 0.018), 0.012, 'black', 1))
    if res:
        rbd.extend(rbox(((xa + xb_) / 2, y1 + 0.012, 0.3), ((xa - xb_) / 2 + 0.04, 0.006, 0.012), 0.005, 'chrome', 1))
    o.body.extend(rbd.both())
    # Chrome blade bumpers on stalks, with overriders.
    for (xe, sg) in ((x1 + 0.03, 1), (x0 - 0.03, -1)):
        bm = sweep(plan_bar(xe, 0.76, 0.1, 0.42, sg, 14 if res else 6), rr_profile(0.05, 0.11, 0.03, 2 if res else 1), 'chrome')
        o.body.extend(bm)
        for s in (1, -1):
            o.body.extend(rbox((xe - sg * 0.1, s * 0.4, 0.42), (0.1, 0.025, 0.025), 0.01, 'black', 1))
            if res:
                o.body.extend(tube([(xe + sg * 0.03, s * 0.3, 0.33), (xe + sg * 0.05, s * 0.3, 0.45), (xe + sg * 0.03, s * 0.3, 0.6)], 0.014, 'chrome', 6))
    # The bonnet: a chrome strip down the middle and a handle; the lid's edge.
    if res:
        line(o, pr, 'top', [(0.75, 0.0), (1.85, 0.0)], 0.03, 'chrome', 0.005)
        o.body.extend(rbox((1.88, 0, hull.surface_z(1.88, 0.0) - 0.06), (0.03, 0.05, 0.02), 0.012, 'chrome', 1))
        line(o, pr, 'top', rounded([(0.68, 0.42), (1.6, 0.36), (1.95, 0.0), (1.6, -0.36), (0.68, -0.42)], 2) + [(0.68, 0.42)], 0.007, 'gap', 0.002)
        # The engine lid with its louvres, the plate and its lamp, twin tailpipes.
        gaps(o, pr, [[(-0.45, 0.88), (-0.48, 0.55), (-0.42, 0.42), (0.42, 0.42), (0.48, 0.55), (0.45, 0.88)]], frame='rear', both=False)
        for s in (1, -1):
            for k in range(5):
                z = 0.86 - k * 0.028
                line(o, pr, 'rear', [(s * 0.08, z), (s * 0.3, z)], 0.012, 'gap', 0.003)
        o.body.extend(rbox((x0 + 0.1, 0, 0.66), (0.04, 0.07, 0.025), 0.015, 'chrome', 1))
        for s in (1, -1):
            o.body.extend(tube([(x0 + 0.35, s * 0.32, 0.3), (x0 - 0.02, s * 0.32, 0.33)], 0.022, 'chrome', 8, caps=False))
            o.body.extend(cyl((x0, s * 0.32, 0.328), (x0 - 0.018, s * 0.32, 0.33), 0.019, 'gap', 8))
        # Doors, handles, chrome round the windows.
        gaps(o, pr, [
            [(0.55, 0.92), (0.58, 0.6), (0.52, 0.32)],
            [(-0.4, 0.93), (-0.44, 0.6), (-0.36, 0.32)],
        ])
        handle(o, pr, -0.28, 0.82, 'chrome', 0.1, 0.03)
        line(o, prg, 'side', along(p['shoulder'], 0.5, -0.85, 10, -0.002), 0.012, 'chrome', 0.004, both=True)
        o.body.extend(P.mirror((0.5, 0.64, 0.92), out=0.1, h=0.07, l=0.08, region='chrome', res=res))
        cx = p['ws_base'] - 0.03
        for (a, b) in ((0.4, -0.05), (-0.05, -0.45)):
            o.body.extend(tube([Vector((cx - 0.02, a, p['roof_z'](cx - 0.02) + 0.01)), Vector((cx - 0.1, b, p['roof_z'](cx - 0.1) + 0.012))], 0.006, 'chrome', 4))
    plate(o, pr, 'rear', (0.0, 0.58), 0.3, 0.13)
    plate(o, Projector(o.body), 'front', (0.0, 0.42), 0.3, 0.12, 0.012)


@car
def beetle(res):
    return closed_car(res, beetle_params())
