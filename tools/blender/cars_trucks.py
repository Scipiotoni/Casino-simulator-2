"""
The trucks: Sal's Old Pickup (a 1970s full-size pickup with a long bonnet, chrome grille and
bumpers and an open load bed), the Highroller SUV (a big upright modern luxury SUV) and the
Army Jeep (a wartime quarter-ton jeep: open tub, flat fold-down windscreen, flat fenders).
"""
import math

from mathutils import Matrix, Vector

from carkit import C, const, lerp, rbox, box, cyl, tube, prism, rrect_pts, circle_pts, ccw
from carbody import Glasshouse, Projector, aim, patch, strip, _end_stations
import carparts as P
from carcommon import car, closed_car, lamp, flat, line, gaps, handle, plate, rounded, arch_pts, along


# ------------------------------------------------------------------ a cab with a flat back

class Cab(Glasshouse):
    """
    A glasshouse whose rounded ends close right down, base and rail together, into a flat
    back (a pickup's cab, an SUV's tailgate) instead of tapering in height. `side_s` are the
    stops up the side (from the base, 0, towards the rail, 1) so the windows can start above
    the beltline; `rake` leans the back (the roof's rear edge that far ahead of its base);
    `taper` narrows the base with the end (off when the hull's own end already rounds it).
    """

    def __init__(self, hull, x0, x1, rail_w, rail_z, roof_z, corner=const(0.05), inset=const(0.03), lines=(),
                 front=None, rear=None, bulge=0.006, region=None, base_drop=0.025, between=1,
                 side_s=(0.0, 0.5), taper=True, rake=0.0, fmin=0.004, nt=4):
        super().__init__(hull, x0, x1, rail_w, rail_z, roof_z, corner, inset, lines, front, rear, bulge, region,
                         base_drop, between)
        self.side_s = side_s
        self.taper = taper
        self.rake = rake
        self.fmin = fmin
        self.nt = nt

    def base(self, x, f):
        h = self.hull
        wb = max(0.004, h.edge_y(x) - self.inset(x))
        if self.taper:
            wb = max(0.003, wb * f)
        return Vector((wb, h.surface_z(x, wb) - self.base_drop))

    def stations(self, res=1):
        out = []
        n_end = 7 if res else 3
        rk = self.rake
        a = self.x0 + (self.rear[0] if self.rear else 0.0)
        b = self.x1 - (self.front[0] if self.front else 0.0)
        if self.rear:
            for (t, f, th) in reversed(_end_stations(n_end, self.rear[1], self.fmin)):
                x = a - t * self.rear[0]
                out.append({'xb': x, 'xr': x + rk, 'f': f, 'zone': 'rear', 'th': th})
            out.pop()
        lines = [(a, a + rk)] + [l for l in self.lines if a < l[0] < b and a < l[1] < b] + [(b, b)]
        nb = self.between if res else 0
        for (l0, l1) in zip(lines, lines[1:]):
            for k in range(nb + 1):
                t = k / (nb + 1)
                out.append({'xb': lerp(l0[0], l1[0], t), 'xr': lerp(l0[1], l1[1], t), 'f': 1.0, 'zone': 'mid', 'th': 0.0})
        out.append({'xb': b, 'xr': b, 'f': 1.0, 'zone': 'mid', 'th': 0.0})
        if self.front:
            for (t, f, th) in _end_stations(n_end, self.front[1], self.fmin)[1:]:
                x = b + t * self.front[0]
                out.append({'xb': x, 'xr': x, 'f': f, 'zone': 'front', 'th': th})
        return out

    def ring(self, st, res=1):
        f = st['f']
        xb, xr = st['xb'], st['xr']
        B0 = self.base(xb, f)
        rw = max(0.003, self.rail_w(xr) * f)
        rz = self.rail_z(xr)
        zr = self.roof_z(xr)
        rr = min(self.corner(xr), rw * 0.4)
        K = Vector((rw, rz))
        ds = K - B0
        dl = max(1e-6, ds.length)
        ds = ds / dl
        dt = Vector((-1.0, 2 * (zr - rz) / rw)).normalized()
        A = K - ds * min(rr, dl * 0.6)
        E = K + dt * rr
        nrm = Vector((ds.y, -ds.x))
        nc = 2 if res else 1
        nt = self.nt if res else 2
        pts, lab = [], []
        side = self.side_s if res else self.side_s[:2]
        for s in side:
            p = B0.lerp(A, s) + nrm * self.bulge * math.sin(math.pi * s)
            pts.append(Vector((lerp(xb, xr, s), p.x, p.y)))
            lab.append('side')
        for k in range(nc):
            t = k / nc
            p = A * (1 - t) ** 2 + K * 2 * t * (1 - t) + E * t * t
            pts.append(Vector((xr, p.x, p.y)))
            lab.append('corner')
        for k in range(nt + 1):
            y = E.x * (1 - k / nt)
            pts.append(Vector((xr, y, zr + (E.y - zr) * (y / max(1e-6, E.x)) ** 2)))
            lab.append('top')
        return pts, lab

    def build(self, res=1, shell=True):
        m = super().build(res, shell)
        # Close the hair-thin slit left at the tip of a rounded end.
        sts = self.last_stations
        n = len(sts[0]['lab'])
        N = 2 * n - 1
        ends = []
        if self.rear:
            ends.append((0, 1, -1))
        if self.front:
            ends.append((len(sts) - 1, len(sts) - 2, 1))
        for (ri, rn, sgn) in ends:
            base = ri * N
            fi0 = min(ri, rn) * (N - 1)
            for j in range(n - 1):
                q = [base + j, base + j + 1, base + N - 2 - j, base + N - 1 - j]
                q = [v for k, v in enumerate(q) if v not in q[:k]]
                if len(q) < 3:
                    continue
                reg = m.r[fi0 + j]
                nrm = (m.v[q[1]] - m.v[q[0]]).cross(m.v[q[-1]] - m.v[q[0]])
                if nrm.x * sgn < 0:
                    q = list(reversed(q))
                m.face(q, reg)
        return m


def sweep(path, z, section, region, caps=True, centre=(0.0, 0.0)):
    """
    A closed section [(out, up)] swept along a plan-view path [(x, y)] at height z, `out`
    measured away from `centre` square to the path (bumpers, running boards, rails).
    """
    from carkit import Mesh, _fnormal
    m = Mesh()
    P2 = [Vector(p) for p in path]
    n = len(P2)
    cen = Vector(centre)
    rings = []
    for i, p in enumerate(P2):
        t = (P2[min(n - 1, i + 1)] - P2[max(0, i - 1)]).normalized()
        nrm = Vector((t.y, -t.x))
        if nrm.dot(p - cen) < 0:
            nrm = -nrm
        rings.append([m.vert((p.x + nrm.x * u, p.y + nrm.y * u, z + v)) for (u, v) in section])
    k = len(section)
    for i in range(n - 1):
        for j in range(k):
            j2 = (j + 1) % k
            m.face((rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]), region)
    if caps:
        for ring in (rings[0], rings[-1]):
            c = m.vert(sum((m.v[q] for q in ring), Vector()) / k)
            for j in range(k):
                m.face((c, ring[j], ring[(j + 1) % k]), region)
    # Wind every face outwards from the path.
    for fi, f in enumerate(m.f):
        cc = sum((m.v[q] for q in f), Vector()) / len(f)
        best = min(P2, key=lambda q: (q - cc.xy).length)
        core = Vector((best.x, best.y, z))
        if _fnormal(m, f).dot(cc - core) < 0:
            m.f[fi] = tuple(reversed(f))
    return m


def rsection(w, h, r, n=2, bow=0.0):
    """A rounded-rectangle section [(out, up)], w deep (out from -w/2 to w/2) and h tall; `bow` bulges the face."""
    pts = []
    for (cu, cv, a0) in ((w / 2 - r, h / 2 - r, 0.0), (-w / 2 + r, h / 2 - r, math.pi / 2), (-w / 2 + r, -h / 2 + r, math.pi), (w / 2 - r, -h / 2 + r, 1.5 * math.pi)):
        for k in range(n + 1):
            a = a0 + math.pi / 2 * k / n
            pts.append((cu + r * math.cos(a), cv + r * math.sin(a)))
    if bow:
        pts = [(u + (bow * (1 - (v / (h / 2)) ** 2) if u > 0 else 0.0), v) for (u, v) in pts]
    return pts


def bumper(x, z, half_w, h, depth, wrap, sign, region='chrome', res=1, back=0.12, bow=0.012):
    """A chrome bar bumper across the end at x (sign +1 at the front), curving back round the corners."""
    n = 8 if res else 3
    path = []
    for k in range(-n, n + 1):
        y = half_w * k / n
        path.append((x - sign * wrap * (abs(k) / n) ** 3, y))
    # Round the corners back along the sides.
    rc = 0.07
    for s in (-1, 1):
        ends = []
        for a in ((0.5, 1.0) if res else (1.0,)):
            ang = a * math.pi / 2
            ends.append((x - sign * (wrap + rc * math.sin(ang) + (back - rc) * (a == 1.0)), s * (half_w + rc * (1 - math.cos(ang)) * 0.4)))
        if s < 0:
            path = list(reversed(ends)) + path
        else:
            path = path + ends
    sec = rsection(depth, h, min(depth, h) * 0.35, 2 if res else 1, bow)
    return sweep(path, z, sec, region, centre=(x - sign * 1.0, 0.0))


def star_pts(c, r, n=5, inner=0.382, rot=math.pi / 2):
    """A five-pointed star outline (2D), point up."""
    pts = []
    for k in range(n * 2):
        a = rot + math.pi * k / n
        rr = r if k % 2 == 0 else r * inner
        pts.append((c[0] + rr * math.cos(a), c[1] + rr * math.sin(a)))
    return pts


# ------------------------------------------------------------------ Sal's Old Pickup

PU_BED = (-2.33, -0.585, 0.82)  # load bed: x from, x to, floor height
PU_CAB = (-0.43, 0.76, 0.6)  # cab floor


def pickup_params():
    L, W = 4.8, 2.0
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.6, -1.38
    R = 0.375
    gx0, gx1 = -0.5, 0.86
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.235, track=1.66, arch_gap=0.065, arch_flat=0.55,
        rim='dogdish', rim_ratio=0.53, tyre='road', color=0xc8582f,
        bottom=C((x0, 0.6), (x0 + 0.12, 0.57), (xr - 0.55, 0.55), (xr + 0.5, 0.5), (0.0, 0.48), (xf, 0.48), (x1 - 0.2, 0.5), (x1, 0.52)),
        shoulder=C((x0, 1.175), (x0 + 0.06, 1.195), (x0 + 0.2, 1.2), (-0.6, 1.2), (gx1, 1.19), (1.6, 1.165), (x1 - 0.06, 1.14), (x1, 1.12)),
        top=C((x0, 1.18), (x0 + 0.06, 1.2), (x0 + 0.2, 1.205), (-0.6, 1.205), (gx1, 1.225), (1.6, 1.205), (x1 - 0.06, 1.175), (x1, 1.15)),
        width=C((x0, 0.985), (-0.6, 0.995), (gx1, 0.995), (x1, 0.98)),
        tuck=const(0.03), tumble=const(0.022), cfrac=const(0.64),
        rb=const(0.035), rs=const(0.03),
        front=(0.11, 3.4), rear=(0.07, 4.0),
        flares=[],
        open=[PU_BED, PU_CAB],
        lip=0.05,
        keys=[-0.6, -0.55, gx0, gx1, x0 + 0.1, x0 + 0.16, x0 + 0.26, x1 - 0.16, x1 - 0.26],
        bl_base=gx0, ws_base=gx1, inset=0.03, glass=False, interior=False,
        driver_y=0.4, hip_f=(-0.08, 0.95), seats=2,
        height=1.78,
    )

    def hull_region(i, hull):
        seg, x, c = i['seg'], i['x'], i['c']
        if seg == 'in' and x < PU_BED[1] + 0.02:
            return 'metal' if c.z < PU_BED[2] + 0.012 else 'paint'
        if seg == 'top' and gx0 + 0.01 < x < gx1 - 0.01 and abs(c.y) < hull.edge_y(x) - 0.04:
            return 'interior'
        return None

    p['hull_region'] = hull_region
    p['decor'] = pickup_decor
    return p


PU_ROOF = C((-0.5, 1.765), (0.0, 1.78), (0.36, 1.774), (0.47, 1.745), (0.665, 1.48), (0.86, 1.215))
PU_RAIL = C((-0.5, 1.712), (0.36, 1.716), (0.47, 1.695), (0.665, 1.445), (0.86, 1.2))


def pickup_glass(i):
    seg, xb, xr, k = i['seg'], i['xb'], i['xr'], i['k']
    if seg == 'side':
        if i['zone'] == 'rear':
            return 'glass' if (k >= 2 and i['th'] > 0.5) else 'paint'
        if k == 0:
            return 'paint'
        if xb < -0.25:
            return 'paint'
        if 0.47 < xb < 0.505:
            return 'chrome'
        return 'glass'
    if seg == 'corner':
        return 'paint'
    if xr > 0.43:
        return 'glass'
    return 'paint'


def pickup_decor(o, res, pr, prg_unused, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    gx0, gx1 = p['bl_base'], p['ws_base']
    # The cab: a flat back with rounded corners, a raked windscreen, vent windows in the doors.
    cab = Cab(hull, gx0, gx1, C((gx0, 0.855), (0.4, 0.86), (gx1, 0.905)), PU_RAIL, PU_ROOF, corner=const(0.05),
              inset=const(0.03), lines=[(-0.25, -0.25), (-0.2, -0.2), (0.1, 0.1), (0.3, 0.27), (0.47, 0.4), (0.505, 0.435),
                                        (0.6, 0.53), (0.72, 0.66)],
              rear=(0.13, 2.4), region=pickup_glass, side_s=(0.0, 0.1, 0.27), taper=True, between=1)
    cm = cab.build(res, shell=bool(res))
    o.body.extend(cm)
    prg = Projector(o.body)

    # ---- front: chrome grille surround, egg-crate grille, square-bezel round headlamps.
    fz = 0.89
    flat(o, pr, 'front', rounded(rrect_pts((0.0, fz), 1.76, 0.35, 0.03, 2), 1), 'chrome', 0.006, res=res, rings=1)
    if res:
        flat(o, pr, 'front', rrect_pts((0.0, fz - 0.005), 1.02, 0.27, 0.015, 1), 'grille', 0.011, bezel=(0.012, 'gloss', 0.009), res=res, rings=1)
        for z in (fz - 0.005,):
            line(o, pr, 'front', [(-0.51, z), (0.51, z)], 0.022, 'chrome', 0.016)
        for y in (-0.34, -0.17, 0.0, 0.17, 0.34):
            line(o, pr, 'front', [(y, fz - 0.135), (y, fz + 0.125)], 0.018, 'chrome', 0.015)
    for s in (1, -1):
        hc = (s * 0.685, fz + 0.012)
        flat(o, pr, 'front', rrect_pts(hc, 0.26, 0.25, 0.03, 2), 'gloss', 0.011, res=res)
        lamp(o, pr, 'front', circle_pts(hc, 0.092, 18 if res else 8), 'head', res, 'chrome', 0.012, 0.016, both=False, bw=0.014)
        flat(o, pr, 'front', rrect_pts((s * 0.685, fz - 0.142), 0.2, 0.04, 0.008, 1), 'amber', 0.012, res=res)
    # The bonnet's front edge and shut lines.
    if res:
        line(o, pr, 'front', [(-0.93, 1.078), (0.93, 1.078)], 0.006, 'gap', 0.002)
        gaps(o, pr, [[(0.93, 0.925), (2.39, 0.925)]], frame='top')
        line(o, pr, 'top', [(0.93, -0.925), (0.93, 0.925)], 0.006, 'gap', 0.002)
    # Bumpers: chrome blades, the plate on the back one.
    fb = bumper(x1 + 0.05, 0.6, 0.93, 0.19, 0.07, 0.06, 1, 'chrome', res, back=0.13)
    rb_ = bumper(x0 - 0.05, 0.6, 0.93, 0.18, 0.07, 0.04, -1, 'chrome', res, back=0.1)
    o.body.extend(fb)
    o.body.extend(rb_)
    plate(o, Projector(rb_), 'rear', (0.0, 0.6), 0.3, 0.15)
    if res:
        plate(o, Projector(fb), 'front', (0.0, 0.6), 0.3, 0.15)
        # Bumper brackets down to the frame, the frame horns and a tow hook under the front.
        for s in (1, -1):
            o.body.extend(box((x1 - 0.05, s * 0.45, 0.52), (0.08, 0.05, 0.04), 'black'))
            o.body.extend(box((x0 + 0.05, s * 0.45, 0.52), (0.08, 0.05, 0.04), 'black'))
    # Black cowl under the windscreen, wipers.
    cx = gx1 - 0.03
    line(o, pr, 'top', [(cx, -0.84), (cx, 0.84)], 0.075, 'black', 0.003)
    if res:
        for (a, b) in ((0.62, 0.0), (-0.1, -0.72)):
            o.body.extend(tube([Vector((cx - 0.03, a, PU_ROOF(cx - 0.03) + 0.012)), Vector((cx - 0.09, b, PU_ROOF(cx - 0.09) + 0.016))], 0.007, 'black', 4))

    # ---- sides.
    if res:
        door_f, door_r = 0.84, -0.38
        gaps(o, pr, [
            [(door_f, 1.185), (door_f + 0.01, 0.8), (door_f, 0.56)],
            [(door_f, 0.56), (door_r, 0.56)],
            [(door_r, 0.56), (door_r, 1.185)],
            [(-0.54, 1.2), (-0.54, 0.6)],
        ])
        line(o, pr, 'top', [(-0.54, -0.99), (-0.54, 0.99)], 0.008, 'gap', 0.002)
        handle(o, pr, door_r + 0.15, 1.08, 'chrome', 0.12, 0.03)
        # Chrome trim along the crease, broken at the door and the bed.
        for (a, b) in ((2.3, door_f + 0.03), (door_f - 0.03, door_r + 0.03), (-0.57, x0 + 0.17)):
            line(o, pr, 'side', [(a, 0.925), (b, 0.925)], 0.02, 'chrome', 0.004, both=True)
        # A lower moulding along the doors and the bed sides.
        for (a, b) in ((door_f - 0.03, door_r + 0.03), (-0.57, xr + R + 0.16), (xr - R - 0.16, x0 + 0.17)):
            line(o, pr, 'side', [(a, 0.66), (b, 0.66)], 0.03, 'chrome', 0.004, both=True)
        # Side marker lamps.
        lamp(o, pr, 'side', rrect_pts((2.17, 0.84), 0.11, 0.045, 0.01, 1), 'amber', res, 'chrome', 0.004, 0.005, bw=0.006)
        lamp(o, pr, 'side', rrect_pts((-2.2, 0.84), 0.11, 0.045, 0.01, 1), 'tail', res, 'chrome', 0.004, 0.005, bw=0.006)
        # Fuel filler door on the bed side.
        line(o, pr, 'side', rounded(circle_pts((-0.9, 0.98), 0.07, 12), 1), 0.006, 'gap', 0.0015, closed=True)
        # Stake pockets in the bed rails.
        for x in (-0.66, -1.48, -2.26):
            flat(o, pr, 'top', rrect_pts((x, 0.945), 0.06, 0.022, 0.005, 1), 'gap', 0.002, both=True, res=res)
        # Aerial on the front fender.
        o.body.extend(cyl((1.05, -0.94, 1.17), (1.03, -0.94, 1.95), 0.004, 'chrome', 4))
    # Mirrors: chrome heads on two arms off the doors.
    for s in (1, -1):
        mx, my, mz = 0.66, s * 1.12, 1.3
        mm = rbox((mx, my, mz), (0.03, 0.08, 0.11), 0.02, 'chrome', 2 if res else 1)
        o.body.extend(mm)
        if res:
            o.body.extend(box((mx - 0.032, my, mz), (0.002, 0.07, 0.1), 'mirror'))
            for (zb, za) in ((1.24, 1.26), (1.1, 1.36)):
                o.body.extend(tube([Vector((0.72, s * 0.985, zb)), Vector((mx, my - s * 0.04, za))], 0.009, 'chrome', 5))

    # ---- rear: tailgate, tail lamps on the corner posts.
    if res:
        gaps(o, pr, [[(-0.835, 1.195), (-0.835, 0.66), (0.835, 0.66), (0.835, 1.195)]], frame='rear', both=False)
        flat(o, pr, 'rear', rrect_pts((0.0, 1.1), 0.22, 0.045, 0.015, 2), 'chrome', 0.006, bezel=(0.008, 'gap', 0.003), res=res)
        # A recessed panel in the tailgate.
        line(o, pr, 'rear', rounded(rrect_pts((0.0, 0.87), 1.5, 0.25, 0.03, 1), 1), 0.008, 'gap', 0.002, closed=True)
    for s in (1, -1):
        lamp(o, pr, 'rear', rrect_pts((s * 0.895, 0.92), 0.085, 0.34, 0.012, 2), 'tail', res, 'chrome', 0.006, 0.007, both=False, bw=0.008)
        if res:
            lamp(o, pr, 'rear', rrect_pts((s * 0.895, 0.795), 0.06, 0.07, 0.01, 1), 'white', res, None, 0.002, 0.016, both=False)
    # Exhaust out from under the bed, behind the right-hand rear wheel.
    o.body.extend(cyl((xr - 0.5, -0.72, 0.42), (xr - 0.9, -0.74, 0.42), 0.032, 'metal', 8 if res else 5))

    # ---- the load bed: ribbed floor, wheel housings.
    bx0, bx1, bfl = PU_BED
    if res:
        for k in range(9):
            y = -0.64 + k * 0.16
            o.body.extend(box(((bx0 + bx1) / 2, y, bfl + 0.006), ((bx1 - bx0) / 2 - 0.02, 0.022, 0.008), 'paint'))
    for s in (1, -1):
        o.body.extend(rbox((xr, s * 0.79, bfl + 0.09), (0.45, 0.17, 0.1), 0.05, 'paint', 2 if res else 1))

    # ---- the cab inside: bench seat, flat dashboard with round dials, a big thin wheel.
    if res:
        dy = p['driver_y']
        hx, hz = p['hip_f']
        o.body.extend(P.bench(hx + 0.04, 1.62, hz - 0.09, 0.5, 0.56, 0.2, 'seat', res=0))
        o.body.extend(box((hx + 0.02, 0, (PU_CAB[2] + hz - 0.2) / 2), (0.22, 0.78, (hz - 0.2 - PU_CAB[2]) / 2 + 0.01), 'interior'))
        o.body.extend(P.dashboard(0.84, 0.52, 0.88, 1.22, 0.86, dy, 'interior'))
        for yy in (dy - 0.09, dy + 0.09):
            o.body.extend(cyl((0.5, yy, 1.12), (0.505, yy, 1.12), 0.055, 'chrome', 12))
        o.body.extend(P.steering_wheel((0.33, dy, 1.22), 0.6, 0.205, region='black'))
        o.body.extend(tube([Vector((0.42, dy - 0.06, 1.14)), Vector((0.3, dy - 0.24, 1.17))], 0.008, 'chrome', 4))
        # The floor mat and the back wall's inside.
        o.body.extend(box((0.2, 0, PU_CAB[2] + 0.005), (0.55, 0.85, 0.006), 'black'))


@car
def pickup(res):
    o = closed_car(res, pickup_params())
    o.meta['dims'][0] = 4.95
    # Painted white steel wheels under chrome dog-dish caps.
    for w in (o.wheel.values() if res else [o.body]):
        w.recolor('white', only='rim')
    return o
