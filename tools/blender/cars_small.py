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
