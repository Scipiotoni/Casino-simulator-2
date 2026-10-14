"""
Car body shells for build_cars.py: the lower body and the glasshouse lofted from section
points, wheel arches cut with booleans, and details laid on the surface like decals (lamps,
grilles, number plates, panel gaps, trim strips). Blender car space (see carkit.py).
"""
import math

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

from carkit import Mesh, const, lerp, bump, prism, poly_offset, from_object, remove, _fnormal


def end_factor(t, p):
    """Plan-view rounding of a body end: 1 where the end zone starts, 0 at the tip."""
    t = max(0.0, min(1.0, t))
    return (1 - t ** p) ** (1 / p)


def _end_stations(n, p, fmin):
    """(t along the zone, width factor, step fraction) round a superellipse corner, start to near the tip."""
    th_max = math.acos(min(1.0, fmin ** (p / 2)))
    out = []
    for k in range(n + 1):
        th = th_max * k / n
        out.append((math.sin(th) ** (2 / p), math.cos(th) ** (2 / p), k / n))
    return out


def _adaptive(ring_at, xs, tol, max_dx, min_dx):
    """Stations between the key xs, split wherever the section changes faster than linearly."""
    out = [xs[0]]
    for a, b in zip(xs, xs[1:]):
        stack = [(a, b, 0)]
        seg = []
        while stack:
            x0, x1, d = stack.pop()
            xm = (x0 + x1) / 2
            r0, r1, rm = ring_at(x0), ring_at(x1), ring_at(xm)
            dev = max(((p0 + p1) / 2 - pm).length for p0, p1, pm in zip(r0, r1, rm))
            if (x1 - x0 > max_dx or dev > tol) and x1 - x0 > min_dx * 2 and d < 8:
                stack.append((xm, x1, d + 1))
                stack.append((x0, xm, d + 1))
            else:
                seg.append(x1)
        out += sorted(seg)
    return out


def _outward(pts2):
    """Outward normals (y, z) of a half section running from the bottom centre over to the top centre."""
    out = []
    n = len(pts2)
    for i in range(n):
        a = pts2[max(0, i - 1)]
        b = pts2[min(n - 1, i + 1)]
        d = (b - a)
        if d.length < 1e-9:
            out.append(Vector((1, 0)))
            continue
        d.normalize()
        out.append(Vector((d.y, -d.x)))
    return out


class Hull:
    """
    The lower body: sections from the bottom, round the sill, up the side (widest at the
    character line), over the shoulder and across the bonnet / deck (crowned), lofted from the
    rear end to the front end with both ends rounded in plan. Inside `open` ranges the top
    dips into a cabin or a load bed (door tops, inner walls, a floor). Parameters are Curves of x.
    """

    def __init__(self, x0, x1, bottom, shoulder, top, width, tuck=const(0.05), tumble=const(0.03),
                 cfrac=const(0.6), rb=const(0.06), rs=const(0.05), front=(0.3, 2.6), rear=(0.3, 2.6),
                 open=(), flares=(), lip=0.035, keys=(), fmin=0.05, region=None, side_bow=0.0):
        self.x0, self.x1 = x0, x1
        self.bottom, self.shoulder, self.top, self.width = bottom, shoulder, top, width
        self.tuck, self.tumble, self.cfrac, self.rb, self.rs = tuck, tumble, cfrac, rb, rs
        self.front, self.rear = front, rear
        self.open = list(open)
        self.flares = list(flares)
        self.lip = lip
        self.keys = list(keys)
        self.fmin = fmin
        self.region = region
        self.side_bow = side_bow

    def factor(self, x):
        Rf, pf = self.front
        Rr, pr = self.rear
        if x > self.x1 - Rf:
            return end_factor((x - (self.x1 - Rf)) / Rf, pf)
        if x < self.x0 + Rr:
            return end_factor(((self.x0 + Rr) - x) / Rr, pr)
        return 1.0

    def floor_at(self, x):
        for (a, b, z) in self.open:
            if a <= x <= b:
                return z
        return None

    def half(self, x, f=None, res=1, closed=False):
        """Half section points (y, z) from the bottom centre to the top centre, and segment labels."""
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
        nt = 5 if res else 3
        pts, lab = [], []

        def add(p, label):
            pts.append(Vector(p))
            lab.append(label)

        add((0.0, zb), 'bot')
        sill = (0.0, 0.5) if res else (0.0,)
        for a in sill:
            a = -math.pi / 2 + math.pi / 2 * a
            add((wl - rb + rb * math.cos(a), zb + rb + rb * math.sin(a)), 'sill')
        # Up the side to the character line, a crease (two close points), then tumbling home.
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
        if fl is None:
            for k in range(nt):
                y = ye * (1 - k / nt)
                add((y, zs + (zt - zs) * (1 - (y / max(1e-6, ye)) ** 2)), 'top')
            add((0.0, zt), 'top')
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
        # Fender flares: the side bulges round the wheels.
        for (xc, hx, amt, zc2, hz) in self.flares:
            kx = bump(x, xc, hx)
            if kx <= 0:
                continue
            for i, p in enumerate(pts):
                if lab[i] in ('low', 'up', 'sh', 'sill') or (lab[i] == 'top' and p.x > ye * 0.75):
                    pts[i] = Vector((p.x + amt * kx * f * bump(p.y, zc2, hz), p.y))
        return pts, lab

    def surface_z(self, x, y):
        """Height of the closed top (shoulder, bonnet or deck) at (x, y)."""
        pts, lab = self.half(x, closed=True)
        i0 = lab.index('sh')
        tops = pts[i0:]
        if y >= tops[0].x:
            return tops[0].y
        for a, b in zip(tops, tops[1:]):
            if b.x <= y <= a.x:
                t = (y - a.x) / (b.x - a.x) if abs(b.x - a.x) > 1e-9 else 0
                return lerp(a.y, b.y, t)
        return tops[-1].y

    def edge_y(self, x):
        """Half width of the top edge (where the shoulder turns into the bonnet or deck)."""
        pts, lab = self.half(x, closed=True)
        return pts[lab.index('top')].x

    def stations(self, res=1):
        Rf, pf = self.front
        Rr, pr = self.rear
        n_end = 7 if res else 3
        out = []
        for (t, f, th) in reversed(_end_stations(n_end, pr, self.fmin)):
            out.append({'x': self.x0 + Rr - t * Rr, 'f': f, 'zone': 'rear', 'th': th})
        out.pop()
        a, b = self.x0 + Rr, self.x1 - Rf
        keys = {a, b} | {k for k in self.keys if a < k < b}
        for (oa, ob, _) in self.open:
            for k in (oa - 0.004, oa + 0.004, ob - 0.004, ob + 0.004):
                if a < k < b:
                    keys.add(k)
        keys = sorted(keys)

        def ring_at(x):
            p, _ = self.half(x, None, res)
            return p

        mids = _adaptive(ring_at, keys, 0.008 if res else 0.04, 0.36 if res else 1.4, 0.003)
        for x in mids:
            out.append({'x': x, 'f': self.factor(x), 'zone': 'mid', 'th': 0.0})
        for (t, f, th) in _end_stations(n_end, pf, self.fmin)[1:]:
            out.append({'x': self.x1 - Rf + t * Rf, 'f': f, 'zone': 'front', 'th': th})
        return out

    def build(self, res=1):
        """The closed shell as a Mesh, every face in a region."""
        m = Mesh()
        sts = self.stations(res)
        rings = []
        n = None
        for st in sts:
            pts, lab = self.half(st['x'], st['f'], res)
            n = len(pts)
            full = [Vector((st['x'], p.x, p.y)) for p in pts]
            full += [Vector((st['x'], -pts[k].x, pts[k].y)) for k in range(n - 2, 0, -1)]
            st['lab'] = lab
            rings.append([m.vert(p) for p in full])
        N = len(rings[0])

        def half_index(j):
            return j if j <= n - 1 else 2 * n - 2 - j

        for i in range(len(rings) - 1):
            s0, s1 = sts[i], sts[i + 1]
            for j in range(N):
                j2 = (j + 1) % N
                hj = min(half_index(j), half_index(j2))
                l0, l1 = s0['lab'][hj], s1['lab'][hj]
                lab = 'in' if 'in' in (l0, l1) else l0
                q = (rings[i][j], rings[i][j2], rings[i + 1][j2], rings[i + 1][j])
                cen = sum((m.v[k] for k in q), Vector()) / 4
                info = {'x': cen.x, 'seg': lab, 'zone': s1['zone'] if s1['zone'] == 'front' else s0['zone'],
                        'th': max(s0['th'], s1['th']), 'side': 1 if cen.y >= 0 else -1, 'j': hj, 'n': n, 'c': cen}
                reg = self.region(info) if self.region else None
                m.face(q, reg or default_hull_region(info))
        # Caps: a shallow dome over each end ring.
        for (ring, st, sgn) in ((rings[0], sts[0], -1), (rings[-1], sts[-1], 1)):
            c = sum((m.v[k] for k in ring), Vector()) / len(ring)
            c.x += sgn * 0.003
            ci = m.vert(c)
            for j in range(N):
                j2 = (j + 1) % N
                info = {'x': c.x, 'seg': 'cap', 'zone': st['zone'], 'th': 1.0, 'side': 1, 'j': 0, 'n': n, 'c': c}
                reg = (self.region(info) if self.region else None) or 'paint'
                m.face((ci, ring[j2], ring[j]) if sgn < 0 else (ci, ring[j], ring[j2]), reg)
        self.last_stations = sts
        return m


def default_hull_region(info):
    seg = info['seg']
    if seg == 'bot':
        return 'black'
    if seg == 'in':
        return 'interior'
    return 'paint'


class Glasshouse:
    """
    The cabin above the beltline: sections from the base (tucked into the body) up the side
    glass to the roof rail, round a corner and across the roof, lofted from the windscreen to
    the back window (either end straight, or rounded in plan like a tailgate). Stations in
    the middle run along key lines (x at the base, x at the rail) so pillar edges can lean;
    `region(info)` paints the glass, the pillars and the roof.
    """

    def __init__(self, hull, x0, x1, rail_w, rail_z, roof_z, corner=const(0.06), inset=const(0.03),
                 lines=(), front=None, rear=None, bulge=0.012, region=None, base_drop=0.025, between=2,
                 base_w=None, base_z=None):
        self.hull = hull
        self.x0, self.x1 = x0, x1
        self.rail_w, self.rail_z, self.roof_z, self.corner, self.inset = rail_w, rail_z, roof_z, corner, inset
        self.lines = sorted(lines)
        self.front, self.rear = front, rear
        self.bulge = bulge
        self.region = region
        self.base_drop = base_drop
        self.between = between
        self.base_w = base_w
        self.base_z = base_z

    def factor(self, x):
        if self.front and x > self.x1 - self.front[0]:
            return end_factor((x - (self.x1 - self.front[0])) / self.front[0], self.front[1])
        if self.rear and x < self.x0 + self.rear[0]:
            return end_factor(((self.x0 + self.rear[0]) - x) / self.rear[0], self.rear[1])
        return 1.0

    def section(self, x, f):
        """Key points of the section at x: base, side-glass top, corner, roof edge, roof centre."""
        h = self.hull
        wb = self.base_w(x) if self.base_w else max(0.02, h.edge_y(x) - self.inset(x))
        zb = self.base_z(x) if self.base_z else h.surface_z(x, wb) - self.base_drop
        rw = max(0.01, self.rail_w(x) * f)
        rz = self.rail_z(x)
        zr = self.roof_z(x)
        rr = min(self.corner(x), rw * 0.4)
        K = Vector((rw, rz))
        B0 = Vector((wb, zb))
        ds = K - B0
        dl = max(1e-6, ds.length)
        ds = ds / dl
        dt = Vector((-1.0, 2 * (zr - rz) / rw)).normalized()
        A = K - ds * min(rr, dl * 0.6)
        E = K + dt * rr
        return B0, A, K, E, zr, ds

    def point(self, x, part, s, f):
        B0, A, K, E, zr, ds = self.section(x, f)
        if part == 'side':
            p = B0.lerp(A, s)
            return p + Vector((ds.y, -ds.x)) * self.bulge * math.sin(math.pi * s)
        if part == 'corner':
            return A * (1 - s) ** 2 + K * 2 * s * (1 - s) + E * s * s
        y = E.x * (1 - s)
        return Vector((y, zr + (E.y - zr) * (y / max(1e-6, E.x)) ** 2))

    def counts(self, res):
        return (2, 2, 4) if res else (1, 1, 2)

    def stations(self, res=1):
        out = []
        n_end = 7 if res else 3
        a = self.x0 + (self.rear[0] if self.rear else 0.0)
        b = self.x1 - (self.front[0] if self.front else 0.0)
        if self.rear:
            for (t, f, th) in reversed(_end_stations(n_end, self.rear[1], 0.04)):
                x = a - t * self.rear[0]
                out.append({'xb': x, 'xr': x, 'f': f, 'zone': 'rear', 'th': th})
            out.pop()
        lines = [(a, a)] + [l for l in self.lines if a < l[0] < b and a < l[1] < b] + [(b, b)]
        nb = self.between if res else 0
        for (l0, l1) in zip(lines, lines[1:]):
            for k in range(nb + 1):
                t = k / (nb + 1)
                out.append({'xb': lerp(l0[0], l1[0], t), 'xr': lerp(l0[1], l1[1], t), 'f': 1.0, 'zone': 'mid', 'th': 0.0})
        out.append({'xb': b, 'xr': b, 'f': 1.0, 'zone': 'mid', 'th': 0.0})
        if self.front:
            for (t, f, th) in _end_stations(n_end, self.front[1], 0.04)[1:]:
                x = b + t * self.front[0]
                out.append({'xb': x, 'xr': x, 'f': f, 'zone': 'front', 'th': th})
        return out

    def ring(self, st, res=1):
        ns, nc, nt = self.counts(res)
        pts, lab = [], []
        f = st['f']
        for k in range(ns):
            s = k / ns
            x = lerp(st['xb'], st['xr'], s)
            p = self.point(x, 'side', s, f)
            pts.append(Vector((x, p.x, p.y)))
            lab.append('side')
        for k in range(nc):
            p = self.point(st['xr'], 'corner', k / nc, f)
            pts.append(Vector((st['xr'], p.x, p.y)))
            lab.append('corner')
        for k in range(nt + 1):
            p = self.point(st['xr'], 'top', k / nt, f)
            pts.append(Vector((st['xr'], p.x, p.y)))
            lab.append('top')
        return pts, lab

    def build(self, res=1, shell=True):
        m = Mesh()
        sts = self.stations(res)
        rings = []
        for st in sts:
            pts, lab = self.ring(st, res)
            st['lab'] = lab
            rings.append(pts + [Vector((p.x, -p.y, p.z)) for p in reversed(pts[:-1])])
        n = len(sts[0]['lab'])
        N = len(rings[0])
        ids = [[m.vert(p) for p in r] for r in rings]
        inner = Mesh()
        iid = None
        if shell:
            # Inside: the headlining and the backs of the pillars, a little in from the skin.
            iid = []
            for r in rings:
                half = [Vector((p.y, p.z)) for p in r[:n]]
                nrm = _outward(half)
                row = []
                for j, p in enumerate(r):
                    hj = j if j < n else N - 1 - j
                    d = nrm[hj]
                    row.append(inner.vert(Vector((p.x, p.y - d.x * 0.022 * (1 if p.y >= 0 else -1), p.z - d.y * 0.022))))
                iid.append(row)
        for i in range(len(sts) - 1):
            s0, s1 = sts[i], sts[i + 1]
            for j in range(N - 1):
                hj = j if j < n - 1 else N - 2 - j
                lab = s0['lab'][hj]
                info = {'xb': (s0['xb'] + s1['xb']) / 2, 'xr': (s0['xr'] + s1['xr']) / 2, 'seg': lab,
                        'k': hj, 'zone': s1['zone'] if s1['zone'] == 'front' else s0['zone'],
                        'th': max(s0['th'], s1['th']), 'side': 1 if j < n - 1 else -1}
                q = (ids[i][j], ids[i][j + 1], ids[i + 1][j + 1], ids[i + 1][j])
                reg = (self.region(info) if self.region else None) or default_glass_region(info)
                m.face(q, reg)
                if shell and reg != 'glass':
                    inner.face((iid[i][j], iid[i + 1][j], iid[i + 1][j + 1], iid[i][j + 1]), 'interior')
        self.last_stations = sts
        if shell:
            m.extend(inner)
        return m


def default_glass_region(info):
    return 'glass' if info['seg'] == 'side' else 'paint'


# ------------------------------------------------------------------ booleans

def arch_cutter(xc, zc, r, y0, y1, flat=0.0, seg=32):
    """A wheel-arch cutter: a circle in side view (squared off at the top by `flat`), across y0..y1."""
    pts = []
    for k in range(seg):
        a = 2 * math.pi * k / seg
        x, z = math.cos(a) * r, math.sin(a) * r
        if flat and z > 0:
            # A squarer arch: the upper part pushed out towards a box.
            q = (z / r)
            x = x * (1 + flat * q * 0.25)
            z = z * (1 - flat * 0.12) + flat * 0.12 * r * (abs(math.cos(a)) ** 0.5) * q
        pts.append((xc + x, zc + z))
    return prism(pts, y0, y1, 'liner')


def cut(mesh, cutters, name='cut'):
    """Subtract closed cutter Meshes from a closed Mesh; the cut faces take the cutter's region."""
    ob = mesh.to_object(name + '_src')
    obs = []
    for i, c in enumerate(cutters):
        co = c.to_object(f'{name}_c{i}')
        mod = ob.modifiers.new('cut', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.solver = 'EXACT'
        mod.material_mode = 'TRANSFER'
        mod.object = co
        obs.append(co)
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    tmp = bpy.data.objects.new(name + '_res', me)
    bpy.context.scene.collection.objects.link(tmp)
    out = from_object(tmp)
    remove(tmp)
    remove(ob)
    for co in obs:
        remove(co)
    return out


# ------------------------------------------------------------------ decals

class Projector:
    """Ray casts onto a target Mesh, for laying details on the body's surface."""

    def __init__(self, *meshes):
        v, f = [], []
        for mesh in meshes:
            o = len(v)
            v += [tuple(p) for p in mesh.v]
            f += [tuple(i + o for i in fc) for fc in mesh.f]
        self.tree = BVHTree.FromPolygons(v, f, all_triangles=False)

    def hit(self, origin, direction):
        d = Vector(direction).normalized()
        loc, nor, idx, dist = self.tree.ray_cast(Vector(origin), d, 30.0)
        if loc is None:
            return None
        return loc, nor


# Named projection frames: (plane origin, s axis, t axis, ray direction).
FRAMES = {
    'front': (Vector((6, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((-1, 0, 0))),
    'rear': (Vector((-6, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)), Vector((1, 0, 0))),
    'side': (Vector((0, 4, 0)), Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, -1, 0))),
    'top': (Vector((0, 0, 5)), Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, -1))),
}


def aim(target, yaw, pitch=0.0, dist=4.0):
    """
    A frame centred on `target`, looking at the car from `yaw` (0 = from straight ahead,
    +pi/2 = from the left, pi = from behind) and `pitch` (from above). 2D coordinates are
    offsets from the target: s horizontal (+y in a front view), t up.
    """
    d = Vector((-math.cos(yaw) * math.cos(pitch), -math.sin(yaw) * math.cos(pitch), -math.sin(pitch)))
    s = -Vector((0, 0, 1)).cross(d).normalized()
    t = -d.cross(s).normalized()
    if t.z < 0:
        t = -t
    return (Vector(target) - d * dist, s, t, d)


def _frame(frame):
    return FRAMES[frame] if isinstance(frame, str) else frame


def project(proj, frame, s, t, lift):
    O, U, V, D = _frame(frame)
    o = O + U * s + V * t
    h = proj.hit(o, D)
    if h is None:
        return None
    loc, nor = h
    if nor.dot(D) > 0:
        nor = -nor
    return loc + nor * lift


def _vert(m, proj, frame, s, t, lift, fallback):
    p = project(proj, frame, s, t, lift)
    if p is None:
        p = fallback
    return m.vert(p)


def _face_out(m, D):
    for i in range(len(m.f)):
        if _fnormal(m, m.f[i]).dot(D) > 0:
            m.f[i] = tuple(reversed(m.f[i]))


def patch(proj, frame, outline, region, lift=0.004, dome=0.0, rings=3, bezel=None, centre=None, inner=None):
    """
    A flat 2D outline laid on the surface: concentric rings in to its centre, lifted off the
    paint (and domed, for lenses). `bezel = (width, region, lift)` adds a surround;
    `inner = [(scale, region)]` recolours the rings inside a fraction of the outline.
    """
    O, U, V, D = _frame(frame)
    m = Mesh()
    n = len(outline)
    c = centre or (sum(p[0] for p in outline) / n, sum(p[1] for p in outline) / n)
    rows = []
    last = None
    for k in range(rings):
        t = k / rings
        row = []
        for p in outline:
            s2 = c[0] + (p[0] - c[0]) * (1 - t)
            t2 = c[1] + (p[1] - c[1]) * (1 - t)
            q = project(proj, frame, s2, t2, lift + dome * math.sin(t * math.pi / 2))
            if q is None:
                q = last if last is not None else O + U * s2 + V * t2
            last = q
            row.append(m.vert(q))
        rows.append(row)
    cq = project(proj, frame, c[0], c[1], lift + dome) or last
    ci = m.vert(cq)

    for k in range(rings - 1):
        rg = region
        if inner:
            frac = 1 - (k + 0.5) / rings
            for (sc, r2) in sorted(inner, reverse=True):
                if frac < sc:
                    rg = r2
        for j in range(n):
            j2 = (j + 1) % n
            m.face((rows[k][j], rows[k][j2], rows[k + 1][j2], rows[k + 1][j]), rg)
    rg = region
    if inner:
        for (sc, r2) in sorted(inner, reverse=True):
            if 0.5 / rings < sc:
                rg = r2
    for j in range(n):
        m.face((rows[-1][j], rows[-1][(j + 1) % n], ci), rg)
    if bezel:
        bw, br, bl = bezel
        outer = poly_offset(outline, bw)
        o = [m.vert(project(proj, frame, p[0], p[1], bl) or m.v[rows[0][j]]) for j, p in enumerate(outer)]
        inn = [m.vert(m.v[rows[0][j]]) for j in range(n)]
        for j in range(n):
            j2 = (j + 1) % n
            m.face((o[j], o[j2], inn[j2], inn[j]), br)
    _face_out(m, D)
    return m


def strip(proj, frame, pts, width, region, lift=0.002, closed=False):
    """A band `width` wide along a 2D polyline laid on the surface (trim, panel gaps)."""
    O, U, V, D = _frame(frame)
    m = Mesh()
    P = [Vector(p) for p in pts]
    n = len(P)
    L, R = [], []
    for i in range(n):
        if closed:
            d = P[(i + 1) % n] - P[i - 1]
        else:
            d = P[min(n - 1, i + 1)] - P[max(0, i - 1)]
        d = d.normalized() if d.length > 0 else Vector((1, 0))
        nrm = Vector((-d.y, d.x)) * (width / 2)
        a, b = P[i] + nrm, P[i] - nrm
        pa = project(proj, frame, a.x, a.y, lift)
        pb = project(proj, frame, b.x, b.y, lift)
        if pa is None or pb is None:
            L.append(None)
            R.append(None)
            continue
        L.append(m.vert(pa))
        R.append(m.vert(pb))
    for i in range(n if closed else n - 1):
        i2 = (i + 1) % n
        if None in (L[i], R[i], L[i2], R[i2]):
            continue
        m.face((L[i], R[i], R[i2], L[i2]), region)
    _face_out(m, D)
    return m


def polyline(fn, a, b, n):
    """Sample a 2D curve fn(t) for t from a to b."""
    return [fn(a + (b - a) * k / n) for k in range(n + 1)]
