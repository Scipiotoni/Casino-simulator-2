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


# ------------------------------------------------------------------ Highroller SUV

def suv_params():
    L, W = 5.05, 2.0
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.55, -1.44
    R = 0.405
    gx1 = 0.95
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.285, track=1.7, arch_gap=0.055, arch_flat=0.2,
        rim='multi', spokes=6, rim_ratio=0.69, tyre='low', color=0x15151a,
        bottom=C((x0, 0.46), (x0 + 0.2, 0.4), (xr - 0.5, 0.36), (xr, 0.34), (xf, 0.34), (x1 - 0.35, 0.36), (x1 - 0.1, 0.4), (x1, 0.45)),
        shoulder=C((x0, 1.1), (x0 + 0.08, 1.15), (x0 + 0.25, 1.17), (-1.0, 1.165), (gx1, 1.13), (1.7, 1.09), (x1 - 0.12, 1.04), (x1, 0.98)),
        top=C((x0, 1.12), (x0 + 0.08, 1.165), (x0 + 0.25, 1.185), (-1.0, 1.18), (gx1, 1.17), (1.7, 1.13), (x1 - 0.12, 1.075), (x1, 1.0)),
        width=C((x0, 0.985), (-1.0, 1.0), (1.0, 1.0), (x1, 0.97)),
        tuck=const(0.05), tumble=const(0.045), cfrac=C((x0, 0.66), (0.0, 0.62), (x1, 0.66)),
        rb=const(0.06), rs=const(0.045),
        front=(0.32, 2.8), rear=(0.2, 3.0),
        flares=[(xf, 0.6, 0.012, 0.62, 0.25), (xr, 0.6, 0.014, 0.64, 0.25)],
        open=[(-2.18, 0.86, 0.5)],
        keys=[gx1, x0 + 0.3, x1 - 0.45],
        bl_base=x0, ws_base=gx1, inset=0.03, glass=False,
        driver_y=0.4, hip_f=(-0.12, 0.9), benches=[(-1.05, 1.42, 0.92), (-1.9, 1.3, 0.86)], seats=6,
        seat_w=0.54, dash=(0.92, 0.5, 0.86, 0.76, 1.17), wheel_c=(0.3, 1.11), wheel_tilt=0.45,
        mirror=(0.84, 0.93, 1.15), mirror_out=0.2,
        height=1.86,
    )

    def hull_region(i, hull):
        seg, x, c = i['seg'], i['x'], i['c']
        if seg == 'top' and x0 + 0.05 < x < gx1 - 0.01 and abs(c.y) < hull.edge_y(x) - 0.04:
            return 'interior'
        return None

    p['hull_region'] = hull_region
    p['decor'] = suv_decor
    return p


SUV_RAIL = C((-2.5, 1.7), (-2.0, 1.73), (-0.5, 1.745), (0.28, 1.74), (0.4, 1.715), (0.67, 1.44), (0.95, 1.15))
SUV_ROOF = C((-2.5, 1.79), (-2.2, 1.835), (-1.6, 1.85), (-0.5, 1.86), (0.22, 1.85), (0.36, 1.815), (0.66, 1.49), (0.95, 1.165))


def suv_glass(i):
    seg, xb, xr, k = i['seg'], i['xb'], i['xr'], i['k']
    if seg == 'side':
        if i['zone'] == 'rear':
            return 'glass' if (k >= 1 and i['th'] > 0.45) else 'gloss'
        if k == 0:
            return 'chrome'
        if xb < -2.12 or -1.62 < xb < -1.5 or -0.47 < xb < -0.35:
            return 'gloss'
        if xb > 0.82:
            return 'gloss'
        return 'glass'
    if seg == 'corner':
        return 'gloss' if i['zone'] == 'rear' or xr < 0.36 else 'gloss'
    if xr > 0.33 and i['zone'] != 'rear':
        return 'glass'
    return 'paint'


def suv_decor(o, res, pr, prg_unused, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    gx1 = p['ws_base']
    cab = Cab(hull, x0, gx1, C((x0, 0.84), (-1.0, 0.86), (0.4, 0.865), (gx1, 0.9)), SUV_RAIL, SUV_ROOF, corner=const(0.07),
              inset=const(0.03), lines=[(-2.12, -2.0), (-1.62, -1.56), (-1.5, -1.47), (-1.0, -1.0), (-0.47, -0.47), (-0.35, -0.35),
                                        (0.1, 0.1), (0.4, 0.3), (0.62, 0.5), (0.82, 0.76)],
              rear=(0.2, 3.0), region=suv_glass, side_s=(0.0, 0.05), taper=False, rake=0.12, between=1, base_drop=0.03)
    cm = cab.build(res, shell=bool(res))
    o.body.extend(cm)
    prg = Projector(cm)

    # ---- front: a big chrome-framed grille, slim lamps either side, intakes below.
    gz = 0.79
    flat(o, pr, 'front', rounded(rrect_pts((0.0, gz), 1.02, 0.36, 0.05, 2), 1), 'grille', 0.008, bezel=(0.035, 'chrome', 0.009), res=res, rings=1)
    if res:
        for k in range(6):
            z = gz - 0.14 + k * 0.056
            line(o, pr, 'front', [(-0.48, z), (0.48, z)], 0.012, 'chrome', 0.014)
        for y in (-0.24, 0.0, 0.24):
            line(o, pr, 'front', [(y, gz - 0.165), (y, gz + 0.165)], 0.01, 'gloss', 0.012)
    hf = aim((x1 - 0.12, 0.74, 0.86), 0.42, 0.0)
    head = rounded([(-0.22, -0.045), (0.2, -0.04), (0.25, 0.0), (0.24, 0.04), (-0.2, 0.05), (-0.25, 0.02)], 2)
    lamp(o, pr, hf, head, 'head', res, 'gloss', 0.008, 0.006, bw=0.012)
    if res:
        line(o, pr, hf, [(-0.21, -0.03), (0.2, -0.026), (0.235, 0.0)], 0.01, 'white', 0.016, both=True)
        for t in (-0.12, -0.03, 0.06):
            lamp(o, pr, hf, circle_pts((t, 0.012), 0.022, 10), 'chrome', res, 'gloss', 0.004, 0.016, bw=0.005, rings=2)
    # Lower bumper: a wide black intake, fog lamps in the corners, a silver skid plate.
    flat(o, pr, 'front', rounded([(-0.62, 0.53), (0.62, 0.53), (0.7, 0.4), (-0.7, 0.4)], 2), 'grille', 0.004, bezel=(0.012, 'gloss', 0.003), res=res, rings=1)
    if res:
        line(o, pr, 'front', [(-0.6, 0.465), (0.6, 0.465)], 0.012, 'gloss', 0.007)
        flat(o, pr, 'front', rounded([(-0.45, 0.39), (0.45, 0.39), (0.4, 0.35), (-0.4, 0.35)], 1), 'rim', 0.006, res=res, rings=1)
    fv = aim((x1 - 0.2, 0.8, 0.47), 0.6, 0.0)
    if res:
        flat(o, pr, fv, rrect_pts((0.0, 0.0), 0.16, 0.07, 0.02, 2), 'gloss', 0.004, both=True, res=res)
        lamp(o, pr, fv, rrect_pts((0.0, 0.0), 0.12, 0.035, 0.015, 2), 'head', res, None, 0.004, 0.008)
    plate(o, pr, 'front', (0.0, 0.575), 0.3, 0.11)
    if res:
        # Clamshell bonnet shut lines, its front edge.
        gaps(o, pr, [[(gx1 + 0.06, 0.9), (1.8, 0.89), (2.3, 0.84), (2.45, 0.75)]], frame='top')
        line(o, pr, 'front', [(-0.75, 0.985), (0.75, 0.985)], 0.006, 'gap', 0.002)
    cx = gx1 - 0.035
    line(o, pr, 'top', [(cx, -0.84), (cx, 0.84)], 0.08, 'black', 0.003)
    if res:
        for (a, b) in ((0.55, -0.05), (-0.05, -0.65)):
            o.body.extend(tube([Vector((cx - 0.03, a, SUV_ROOF(cx - 0.03) + 0.012)), Vector((cx - 0.09, b, SUV_ROOF(cx - 0.09) + 0.016))], 0.007, 'black', 4))

    # ---- sides: doors, handles, a vent behind the front wheels, running boards.
    if res:
        rear_arch = arch_pts(xr, R, R + 0.11, 62, 6, 6)
        gaps(o, pr, [
            [(0.93, 1.13), (0.95, 0.8), (0.93, 0.42)],
            [(-0.4, 1.17), (-0.4, 0.42)],
            [(-1.55, 1.17), (-1.55, 0.86)] + rear_arch[:-1],
            [(0.93, 0.42), (xr + R + 0.11, 0.42)],
        ])
        for (x, z) in ((0.15, 1.04), (-1.25, 1.05)):
            handle(o, pr, x, z, 'chrome', 0.15, 0.03)
        vent = aim((1.05, 0.9, 0.84), math.pi / 2, 0.0)
        flat(o, pr, 'side', rrect_pts((1.06, 0.86), 0.26, 0.09, 0.02, 2), 'gloss', 0.004, both=True, bezel=(0.008, 'chrome', 0.004), res=res)
        for t in (0.835, 0.86, 0.885):
            line(o, pr, 'side', [(0.95, t), (1.17, t)], 0.008, 'chrome', 0.008, both=True)
        # Chrome along the bottom of the doors.
        line(o, pr, 'side', [(0.85, 0.5), (xr + R + 0.13, 0.5)], 0.025, 'chrome', 0.004, both=True)
        # Fuel flap.
        line(o, pr, 'side', rounded(rrect_pts((-2.0, 0.98), 0.17, 0.12, 0.03, 2), 1), 0.006, 'gap', 0.0015, closed=True)
    # Running boards.
    for s in (1, -1):
        rbd = sweep([(xf - R - 0.1, s * 1.0), (xr + R + 0.1, s * 1.0)], 0.36, rsection(0.18, 0.05, 0.02, 1), 'black', centre=(0.0, 0.0))
        o.body.extend(rbd)
        if res:
            o.body.extend(box(((xf + xr) / 2, s * 1.07, 0.388), ((xf - xr) / 2 - R - 0.12, 0.01, 0.004), 'chrome'))
    # Roof rails on four feet.
    for s in (1, -1):
        y = s * 0.68
        pts = []
        for x in (-2.0, -1.4, -0.6, 0.1):
            h = prg.hit((x, y, 4.0), (0, 0, -1))
            pts.append((x, h[0].z if h else SUV_ROOF(x)))
        zr = max(z for _, z in pts) + 0.04
        o.body.extend(rbox((-0.95, y, zr), (1.1, 0.025, 0.015), 0.012, 'rim', 2) if res else box((-0.95, y, zr), (1.1, 0.025, 0.015), 'rim'))
        for (x, z) in ((pts[0], pts[-1]) if res else ()):
            o.body.extend(rbox((x, y, (z + zr) / 2), (0.06, 0.024, (zr - z) / 2 + 0.005), 0.01, 'black', 1))

    # ---- rear: slim wrap-round lamps, a black band, the plate in the tailgate.
    tf = aim((x0 + 0.1, 0.78, 1.08), math.pi - 0.62, 0.0)
    tail = rounded([(0.26, -0.035), (0.27, 0.035), (-0.05, 0.045), (-0.26, 0.03), (-0.27, -0.02), (0.0, -0.04)], 2)
    lamp(o, pr, tf, tail, 'tail', res, 'gloss', 0.006, 0.006, bw=0.008)
    if res:
        line(o, pr, tf, [(0.2, 0.0), (-0.22, 0.004)], 0.01, 'red', 0.014, both=True)
        line(o, pr, 'rear', [(-0.6, 1.08), (0.6, 1.08)], 0.06, 'gloss', 0.004)
        gaps(o, pr, [[(-0.72, 1.17), (-0.72, 0.62), (0.72, 0.62), (0.72, 1.17)]], frame='rear', both=False)
        flat(o, pr, 'rear', rrect_pts((0.0, 0.55), 0.9, 0.025, 0.01, 1), 'tail', 0.004, res=res, rings=1)
        flat(o, pr, 'rear', rounded([(-0.45, 0.47), (0.45, 0.47), (0.4, 0.42), (-0.4, 0.42)], 1), 'rim', 0.006, res=res, rings=1)
        for s in (1, -1):
            o.body.extend(cyl((x0 + 0.1, s * 0.55, 0.43), (x0 - 0.015, s * 0.55, 0.43), 0.04, 'chrome', 10))
        # Rear wiper.
        wz = SUV_ROOF(x0 + 0.1) - 0.25
        o.body.extend(tube([Vector((x0 + 0.06, 0.0, wz - 0.12)), Vector((x0 + 0.1, 0.4, wz + 0.04))], 0.006, 'black', 4))
    plate(o, pr, 'rear', (0.0, 0.84), 0.3, 0.15)
    line(o, pr, 'rear', [(-0.8, 0.5), (0.8, 0.5)], 0.13, 'black', 0.003)


@car
def suv(res):
    return closed_car(res, suv_params())


# ------------------------------------------------------------------ Army Jeep

def sweep_xz(path, section, region, centre=None):
    """
    A closed section [(y, d)] swept along a side-view path [(x, z)], d along the path's upward
    normal (or, given a side-view `centre`, its normal away from that: arch flares).
    """
    from carkit import Mesh, _fnormal
    m = Mesh()
    P2 = [Vector(p) for p in path]
    n = len(P2)
    rings = []
    cents = []
    for i, p in enumerate(P2):
        t = (P2[min(n - 1, i + 1)] - P2[max(0, i - 1)]).normalized()
        nrm = Vector((-t.y, t.x))
        if centre is not None:
            if nrm.dot(p - Vector(centre)) < 0:
                nrm = -nrm
        elif nrm.y < 0 and abs(nrm.y) > abs(nrm.x) * 0.2:
            nrm = -nrm
        ring = [m.vert((p.x + nrm.x * d, y, p.y + nrm.y * d)) for (y, d) in section]
        rings.append(ring)
        cents.append(sum((m.v[q] for q in ring), Vector()) / len(ring))
    k = len(section)
    owner = []
    for i in range(n - 1):
        for j in range(k):
            j2 = (j + 1) % k
            m.face((rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j]), region)
            owner.append((cents[i] + cents[i + 1]) / 2)
    for (ring, c0, nb) in ((rings[0], cents[0], cents[1]), (rings[-1], cents[-1], cents[-2])):
        c = m.vert(c0)
        for j in range(k):
            m.face((c, ring[j], ring[(j + 1) % k]), region)
            owner.append(c0 + (nb - c0))
    for fi, f in enumerate(m.f):
        cc = sum((m.v[q] for q in f), Vector()) / len(f)
        if _fnormal(m, f).dot(cc - owner[fi]) < 0:
            m.f[fi] = tuple(reversed(f))
    return m


JP_TUB = (-1.52, 0.44, 0.5)  # the open tub: x from, x to, floor


def jeep_params():
    L, W = 3.24, 1.56
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.03, -1.0
    R = 0.36
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.165, track=1.25, arch_gap=0.06, arch_flat=0.9,
        rim='military', rim_ratio=0.57, tyre='knobby', color=0x5d6b3a,
        bottom=C((x0, 0.43), (x1, 0.46)),
        shoulder=C((x0, 0.96), (x0 + 0.05, 0.98), (-0.66, 0.985), (-0.56, 0.95), (-0.48, 0.82), (-0.38, 0.75), (0.2, 0.75),
                   (0.3, 0.83), (0.38, 0.97), (0.44, 1.0), (0.62, 1.0), (1.0, 0.985), (x1 - 0.04, 0.975), (x1, 0.95)),
        top=C((x0, 0.97), (x0 + 0.05, 0.99), (-0.66, 0.995), (0.44, 1.012), (0.62, 1.015), (1.0, 1.0), (x1 - 0.04, 0.99), (x1, 0.96)),
        width=C((x0, 0.765), (0.5, 0.775), (0.6, 0.44), (x1, 0.44)),
        tuck=const(0.01), tumble=const(0.012), cfrac=const(0.5),
        rb=const(0.025), rs=const(0.035),
        front=(0.04, 4.0), rear=(0.05, 4.0),
        flares=[],
        open=[JP_TUB],
        lip=0.03,
        keys=[0.5, 0.52, 0.55, 0.58, 0.62, x0 + 0.1],
        bl_base=0.5, ws_base=0.52, inset=0.03, glass=False,
        driver_y=0.3, hip_f=(-0.2, 0.93), benches=[(-1.1, 1.05, 0.95)], seats=4,
        seat_w=0.44, seat_back=0.5, headrests=False, console=False, seat_region='canvas',
        dash=(0.44, 0.4, 0.68, 0.8, 0.97), dash_region='paint', wheel_c=(0.2, 1.09), wheel_tilt=0.6, wheel_r=0.2,
        height=1.65,
    )

    def hull_region(i, hull):
        if i['seg'] == 'in':
            return 'paint'
        return None

    p['hull_region'] = hull_region
    p['decor'] = jeep_decor
    return p


def jeep_decor(o, res, pr, prg_unused, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    seg = 10 if res else 6
    # Flat front fenders over the wheels, curving down at the front.
    fpath = [(0.54, 0.925), (0.9, 0.932), (1.3, 0.932), (1.48, 0.922), (1.57, 0.89), (1.63, 0.82), (1.655, 0.72), (1.66, 0.6)]
    if not res:
        fpath = fpath[::2] + [fpath[-1]]
    fsec = [(0.43, 0.0), (0.745, 0.0), (0.775, -0.02), (0.775, -0.065), (0.755, -0.065), (0.755, -0.025), (0.43, -0.025)]
    fl = sweep_xz(fpath, fsec, 'paint')
    o.body.extend(fl.both())
    # The grille: nine tall slots, round headlamps either side.
    for k in range(9):
        y = -0.22 + k * 0.055
        flat(o, pr, 'front', rrect_pts((y, 0.73), 0.03, 0.3, 0.014, 2), 'gloss', 0.003, res=res, rings=1)
    for s in (1, -1):
        hc = (s * 0.32, 0.83)
        flat(o, pr, 'front', circle_pts(hc, 0.105, 16 if res else 8), 'gloss', 0.003, res=res, rings=1)
        lamp(o, pr, 'front', circle_pts(hc, 0.085, 16 if res else 8), 'head', res, 'metal', 0.02, 0.006, both=False, bw=0.012)
        if res:
            # Little parking lamps under the headlamps.
            lamp(o, pr, 'front', circle_pts((s * 0.32, 0.64), 0.03, 10), 'amber', res, 'metal', 0.006, 0.006, both=False, bw=0.008)
    # Steel channel bumper on the frame horns, tow hooks.
    o.body.extend(rbox((x1 + 0.12, 0, 0.5), (0.04, 0.8, 0.075), 0.01, 'paint', 1))
    for s in (1, -1):
        o.body.extend(box((x1 + 0.03, s * 0.36, 0.45), (0.08, 0.04, 0.05), 'black'))
        if res:
            o.body.extend(tube([Vector((x1 + 0.15, s * 0.3, 0.43)), Vector((x1 + 0.23, s * 0.3, 0.45)), Vector((x1 + 0.25, s * 0.3, 0.52)), Vector((x1 + 0.2, s * 0.3, 0.55))], 0.012, 'black', 5))
    # Frame rails, axles and differentials under the body.
    for s in (1, -1):
        o.body.extend(box((0.0, s * 0.38, 0.43), (x1 + 0.05, 0.035, 0.05), 'black'))
    for x in (xf, xr):
        o.body.extend(cyl((x, -0.55, R), (x, 0.55, R), 0.04, 'black', seg))
        o.body.extend(rbox((x, -0.12 if x > 0 else 0.0, R), (0.11, 0.1, 0.11), 0.05, 'black', 1) if res else box((x, -0.12 if x > 0 else 0.0, R), (0.11, 0.1, 0.11), 'black'))
    if res:
        # Leaf springs.
        for x in (xf, xr):
            for s in (1, -1):
                o.body.extend(box((x, s * 0.42, R + 0.055), (0.42, 0.03, 0.02), 'black'))

    # Bonnet: shut line, clamps, a big white star; blackout lamps on the fenders.
    if res:
        line(o, pr, 'top', [(0.62, -0.4), (0.62, 0.4)], 0.008, 'gap', 0.002)
        for s in (1, -1):
            o.body.extend(rbox((1.42, s * 0.445, 0.92), (0.025, 0.012, 0.05), 0.006, 'metal', 1))
            o.body.extend(cyl((1.48, s * 0.68, 0.93), (1.48, s * 0.68, 0.975), 0.03, 'metal', 8))
            o.body.extend(cyl((1.51, s * 0.68, 0.955), (1.515, s * 0.68, 0.955), 0.017, 'amber', 8))
            # Rubber stops the folded windscreen rests on.
            o.body.extend(cyl((1.2, s * 0.32, 1.0), (1.2, s * 0.32, 1.03), 0.022, 'black', 8))
    flat(o, pr, 'top', star_pts((1.08, 0.0), 0.25, rot=0.0), 'white', 0.003, res=res, rings=1)
    if res:
        line(o, pr, 'top', rounded(circle_pts((1.08, 0.0), 0.29, 24), 1), 0.022, 'white', 0.003, closed=True)
        # Stars on the tub sides.
        flat(o, pr, 'side', star_pts((-0.95, 0.9), 0.065), 'white', 0.003, both=True, res=res, rings=1)

    # The windscreen: a flat frame on the cowl with two panes, leaning back a little.
    M = Matrix.Translation((0.52, 0.0, 1.01)) @ Matrix.Rotation(-0.16, 4, 'Y')
    hw, hh = 0.7, 0.6
    fr = [rbox((0, 0, 0.02), (0.025, hw, 0.025), 0.01, 'paint', 1, M), rbox((0, 0, hh), (0.025, hw, 0.025), 0.01, 'paint', 1, M),
          rbox((0, 0, hh / 2 + 0.01), (0.022, 0.02, hh / 2 - 0.02), 0.006, 'paint', 1, M)]
    for s in (1, -1):
        fr.append(rbox((0, s * hw, hh / 2 + 0.01), (0.025, 0.025, hh / 2 + 0.01), 0.01, 'paint', 1, M))
        fr.append(box((0, s * hw / 2, hh / 2 + 0.01), (0.006, hw / 2 - 0.035, hh / 2 - 0.035), 'glass', M))
    for m in fr:
        o.body.extend(m)
    if res:
        # Hinges, the arms holding it up, a wiper, the mirror on its arm.
        for s in (1, -1):
            o.body.extend(cyl((0.52, s * 0.6, 1.03), (0.52, s * 0.5, 1.03), 0.018, 'metal', 6))
            o.body.extend(tube([M @ Vector((-0.03, s * (hw + 0.03), 0.3)), Vector((0.38, s * 0.76, 0.99))], 0.01, 'metal', 4))
        o.body.extend(tube([M @ Vector((0.03, 0.35, hh - 0.03)), M @ Vector((0.03, 0.1, 0.25))], 0.006, 'black', 4))
        mb = M @ Vector((0.0, hw + 0.02, hh * 0.7))
        o.body.extend(tube([mb, mb + Vector((0.0, 0.14, 0.04))], 0.008, 'metal', 4))
        o.body.extend(cyl(mb + Vector((0.0, 0.17, 0.05)), mb + Vector((-0.02, 0.17, 0.05)), 0.055, 'metal', 12))
        o.body.extend(cyl(mb + Vector((-0.021, 0.17, 0.05)), mb + Vector((-0.024, 0.17, 0.05)), 0.048, 'mirror', 12))

    # Inside: seat boxes, rear wheel housings, the dials, the gear lever.
    hx, hz = p['hip_f']
    dy = p['driver_y']
    fl_z = JP_TUB[2]
    for s in (1, -1):
        if res:
            o.body.extend(rbox((hx + 0.04, s * dy, (fl_z + hz - 0.2) / 2), (0.2, 0.2, (hz - 0.2 - fl_z) / 2 + 0.01), 0.02, 'paint', 1))
        o.body.extend(rbox((xr, s * 0.62, 0.66), (0.44, 0.14, 0.16), 0.04, 'paint', 1) if res else box((xr, s * 0.62, 0.66), (0.44, 0.14, 0.16), 'paint'))
    if res:
        o.body.extend(rbox((-1.1, 0, 0.62), (0.22, 0.48, 0.12), 0.02, 'paint', 1))
        for (y, r) in ((dy, 0.045), (dy - 0.13, 0.035), (0.05, 0.035), (-0.08, 0.035)):
            o.body.extend(cyl((0.44, y, 0.9), (0.43, y, 0.9), r, 'gloss', 10))
            o.body.extend(cyl((0.429, y, 0.9), (0.428, y, 0.9), r * 0.8, 'white', 10))
        o.body.extend(tube([Vector((0.05, 0.0, fl_z)), Vector((-0.05, 0.02, 0.85))], 0.01, 'black', 4))
        o.body.extend(rbox((-0.05, 0.02, 0.87), (0.025, 0.025, 0.025), 0.02, 'black', 1))

    # Rear: spare wheel on the right, jerry can on the left, small tail lamps, bumperettes.
    spare = P.wheel(R, 0.165, 'military', 'knobby', 0.57, 20 if res else 8, res)
    spare.recolor('canvas', only='rim')
    spare.transform(Matrix.Rotation(-math.pi / 2, 4, 'Z'))
    spare.transform(Matrix.Translation((x0 - 0.12, -0.34, 0.84)))
    o.body.extend(spare)
    o.body.extend(rbox((x0 - 0.02, -0.34, 0.84), (0.03, 0.12, 0.05), 0.01, 'black', 1))
    can = rbox((x0 - 0.1, 0.4, 0.8), (0.08, 0.17, 0.235), 0.025, 'paint', 2 if res else 1)
    o.body.extend(can)
    if res:
        for yy in (0.33, 0.4, 0.47):
            o.body.extend(box((x0 - 0.1, yy, 1.045), (0.012, 0.012, 0.012), 'paint'))
        o.body.extend(box((x0 - 0.1, 0.4, 1.06), (0.014, 0.08, 0.008), 'paint'))
        o.body.extend(box((x0 - 0.1, 0.4, 0.8), (0.09, 0.18, 0.012), 'black'))
        pc = Projector(can)
        line(o, pc, 'rear', [(0.27, 0.62), (0.53, 0.98)], 0.012, 'gap', 0.002)
        line(o, pc, 'rear', [(0.53, 0.62), (0.27, 0.98)], 0.012, 'gap', 0.002)
    for s in (1, -1):
        lamp(o, pr, 'rear', rrect_pts((s * 0.66, 0.78), 0.07, 0.05, 0.01, 1), 'tail', res, 'metal', 0.004, 0.006, both=False, bw=0.008)
        o.body.extend(rbox((x0 - 0.06, s * 0.66, 0.55), (0.06, 0.06, 0.05), 0.01, 'paint', 1))
    o.body.extend(box((x0 - 0.06, 0.0, 0.47), (0.06, 0.05, 0.03), 'black'))
    # The canvas top folded down behind the rear seat, its bows over it.
    o.body.extend(rbox((x0 + 0.13, 0.0, 1.03), (0.1, 0.72, 0.06), 0.04, 'canvas', 2 if res else 1))
    if res:
        for dx in (0.08, 0.15):
            o.body.extend(tube([Vector((x0 + dx, 0.74, 0.98)), Vector((x0 + dx, 0.74, 1.1)), Vector((x0 + dx, -0.74, 1.1)), Vector((x0 + dx, -0.74, 0.98))], 0.012, 'black', 4))


@car
def jeep(res):
    o = closed_car(res, jeep_params())
    o.meta['dims'][0] = 3.62
    # Olive drab painted wheels.
    for w in (o.wheel.values() if res else [o.body]):
        w.recolor('canvas', only='rim')
    return o
