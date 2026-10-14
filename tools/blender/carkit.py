"""
The car modelling kit used by build_cars.py: smooth curves, a small mesh builder with colour
regions, lofted body shells (the lower body and the glasshouse are each a ring of section
points swept along the car), wheel arches cut with booleans, details projected onto the body
like decals (lamps, grilles, plates, panel gaps, trim), primitives for the separate parts
(mirrors, bumpers, seats, light bars...), and the wheels.

Car space in Blender: +X forward, +Y the car's left, +Z up, the ground at z = 0 and the
middle of the car's length at x = 0. The glTF exporter turns that into the game's car space
(+x forward, y up, +z the car's right).
"""
import math

import bpy
import bmesh
from mathutils import Matrix, Vector
from mathutils.bvhtree import BVHTree

# ------------------------------------------------------------------ regions

# Every face belongs to one colour region (exported as a material of that name). The game
# colours the regions itself: 'paint' takes the car's colour, the lamps light up at night.
# Preview colour (linear-ish sRGB), roughness, metallic for the Blender renders.
REGIONS = {
    'paint': ((0.8, 0.8, 0.82), 0.25, 0.2),
    'paint2': ((0.05, 0.05, 0.06), 0.25, 0.2),
    'black': ((0.025, 0.025, 0.028), 0.55, 0.0),
    'gloss': ((0.01, 0.01, 0.012), 0.15, 0.0),
    'chrome': ((0.9, 0.9, 0.92), 0.06, 1.0),
    'glass': ((0.03, 0.05, 0.06), 0.03, 0.0),
    'interior': ((0.06, 0.06, 0.065), 0.8, 0.0),
    'seat': ((0.09, 0.085, 0.08), 0.75, 0.0),
    'grille': ((0.015, 0.015, 0.017), 0.5, 0.3),
    'head': ((0.85, 0.87, 0.9), 0.05, 0.6),
    'tail': ((0.55, 0.02, 0.02), 0.1, 0.0),
    'amber': ((0.9, 0.42, 0.02), 0.1, 0.0),
    'plate': ((0.85, 0.85, 0.8), 0.5, 0.0),
    'tyre': ((0.025, 0.025, 0.027), 0.85, 0.0),
    'wall': ((0.85, 0.85, 0.82), 0.7, 0.0),
    'rim': ((0.7, 0.71, 0.73), 0.2, 1.0),
    'rim2': ((0.12, 0.12, 0.13), 0.4, 0.6),
    'liner': ((0.012, 0.012, 0.014), 0.9, 0.0),
    'gap': ((0.004, 0.004, 0.005), 0.9, 0.0),
    'mirror': ((0.6, 0.65, 0.7), 0.02, 1.0),
    'red': ((0.9, 0.03, 0.03), 0.2, 0.0),
    'blue': ((0.03, 0.15, 0.9), 0.2, 0.0),
    'sign': ((0.95, 0.93, 0.85), 0.3, 0.0),
    'white': ((0.85, 0.85, 0.85), 0.35, 0.0),
    'canvas': ((0.2, 0.2, 0.13), 0.9, 0.0),
    'metal': ((0.18, 0.18, 0.17), 0.5, 0.6),
    'track': ((0.05, 0.05, 0.05), 0.7, 0.5),
}

_materials = {}


def material(name):
    """The (shared) Blender material for a region, with preview shading."""
    m = _materials.get(name)
    if m and m.name in bpy.data.materials:
        return m
    col, rough, metal = REGIONS[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*col, 1)
    b.inputs['Roughness'].default_value = rough
    b.inputs['Metallic'].default_value = metal
    _materials[name] = m
    return m


def reset_materials():
    _materials.clear()


# ------------------------------------------------------------------ curves

class Curve:
    """A smooth monotone cubic through (x, y) points (no overshoot), flat beyond the ends."""

    def __init__(self, pts):
        pts = sorted(pts)
        self.x = [p[0] for p in pts]
        self.y = [p[1] for p in pts]
        n = len(pts)
        if n == 1:
            self.m = [0.0]
            return
        d = [(self.y[i + 1] - self.y[i]) / max(1e-9, self.x[i + 1] - self.x[i]) for i in range(n - 1)]
        m = [0.0] * n
        m[0] = d[0]
        m[-1] = d[-1]
        for i in range(1, n - 1):
            if d[i - 1] * d[i] <= 0:
                m[i] = 0.0
            else:
                w1 = 2 * (self.x[i + 1] - self.x[i]) + (self.x[i] - self.x[i - 1])
                w2 = (self.x[i + 1] - self.x[i]) + 2 * (self.x[i] - self.x[i - 1])
                m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i])
        self.m = m

    def __call__(self, x):
        xs = self.x
        if len(xs) == 1 or x <= xs[0]:
            return self.y[0]
        if x >= xs[-1]:
            return self.y[-1]
        lo, hi = 0, len(xs) - 1
        while hi - lo > 1:
            mid = (lo + hi) // 2
            if xs[mid] <= x:
                lo = mid
            else:
                hi = mid
        h = xs[hi] - xs[lo]
        t = (x - xs[lo]) / h
        t2, t3 = t * t, t * t * t
        return ((2 * t3 - 3 * t2 + 1) * self.y[lo] + (t3 - 2 * t2 + t) * h * self.m[lo]
                + (-2 * t3 + 3 * t2) * self.y[hi] + (t3 - t2) * h * self.m[hi])


def C(*pts):
    return Curve(list(pts))


def const(v):
    return Curve([(0.0, v)])


def lerp(a, b, t):
    return a + (b - a) * t


def smooth(t):
    t = max(0.0, min(1.0, t))
    return t * t * (3 - 2 * t)


def bump(x, c, half):
    """1 at c, falling smoothly to 0 at c +- half."""
    u = abs(x - c) / half
    return 0.0 if u >= 1 else 0.5 + 0.5 * math.cos(math.pi * u)


# ------------------------------------------------------------------ mesh builder

class Mesh:
    """Vertices, faces and a region per face (Blender car space)."""

    def __init__(self):
        self.v = []
        self.f = []
        self.r = []
        self.sharp = set()

    def vert(self, p):
        self.v.append(Vector(p))
        return len(self.v) - 1

    def face(self, idx, region):
        idx = tuple(idx)
        if len(set(idx)) < 3:
            return
        self.f.append(idx)
        self.r.append(region)

    def extend(self, other):
        o = len(self.v)
        self.v.extend(v.copy() for v in other.v)
        self.f.extend(tuple(i + o for i in f) for f in other.f)
        self.r.extend(other.r)
        self.sharp.update((a + o, b + o) for a, b in other.sharp)
        return self

    def copy(self):
        return Mesh().extend(self)

    def transform(self, M):
        M = Matrix(M)
        for i, v in enumerate(self.v):
            self.v[i] = M @ v
        if M.determinant() < 0:
            self.f = [tuple(reversed(f)) for f in self.f]
        return self

    def mirrored(self):
        """A copy mirrored to the other side of the car (y -> -y)."""
        return self.copy().transform(Matrix.Diagonal((1, -1, 1, 1)))

    def both(self):
        """This piece and its mirror image."""
        return self.extend(self.mirrored())

    def recolor(self, region, only=None):
        self.r = [region if (only is None or r == only) else r for r in self.r]
        return self

    def tris(self):
        return sum(len(f) - 2 for f in self.f)

    def grid(self, P, region, wrap_u=False, wrap_v=False, flip=False):
        """Quads over a 2D array of points P[i][j]; `region(i, j)` (or a name) per quad."""
        nu, nv = len(P), len(P[0])
        ids = [[self.vert(p) for p in row] for row in P]
        for i in range(nu if wrap_u else nu - 1):
            i2 = (i + 1) % nu
            for j in range(nv if wrap_v else nv - 1):
                j2 = (j + 1) % nv
                q = (ids[i][j], ids[i2][j], ids[i2][j2], ids[i][j2])
                if flip:
                    q = tuple(reversed(q))
                reg = region(i, j) if callable(region) else region
                if reg:
                    self.face(q, reg)
        return ids

    def to_object(self, name, sharp_angle=None, merge=0.0):
        """A Blender object with one material per region used, smooth shaded."""
        regs = sorted(set(self.r))
        me = bpy.data.meshes.new(name)
        me.from_pydata([tuple(v) for v in self.v], [], self.f)
        for rn in regs:
            me.materials.append(material(rn))
        ri = {rn: i for i, rn in enumerate(regs)}
        for p, rn in zip(me.polygons, self.r):
            p.material_index = ri[rn]
        me.update()
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        bm = bmesh.new()
        bm.from_mesh(me)
        if merge:
            bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=merge)
        for f in bm.faces:
            f.smooth = True
        if sharp_angle is not None:
            for e in bm.edges:
                if len(e.link_faces) == 2:
                    a, b = e.link_faces
                    if e.calc_face_angle(0) > sharp_angle or a.material_index != b.material_index:
                        e.smooth = False
                elif len(e.link_faces) != 2:
                    e.smooth = False
        bm.to_mesh(me)
        bm.free()
        return ob


def from_object(ob):
    """Read a Blender mesh object back into a Mesh (regions from its materials)."""
    m = Mesh()
    me = ob.data
    mw = ob.matrix_world
    m.v = [mw @ v.co for v in me.vertices]
    names = [mt.name.split('.')[0] for mt in me.materials]
    for p in me.polygons:
        m.f.append(tuple(p.vertices))
        m.r.append(names[p.material_index] if names else 'paint')
    return m


def remove(ob):
    me = ob.data
    bpy.data.objects.remove(ob)
    if me is not None and me.users == 0:
        bpy.data.meshes.remove(me)


# ------------------------------------------------------------------ primitives

def _frame(axis):
    """Two unit vectors perpendicular to `axis` (and each other)."""
    a = Vector(axis).normalized()
    ref = Vector((0, 0, 1)) if abs(a.z) < 0.9 else Vector((1, 0, 0))
    u = a.cross(ref).normalized()
    v = a.cross(u).normalized()
    return a, u, v


def rbox(c, half, r, region, seg=2, M=None):
    """A box with rounded edges (radius r, `seg` steps round each edge)."""
    m = Mesh()
    hx, hy, hz = half
    r = min(r, hx * 0.999, hy * 0.999, hz * 0.999)

    def coords(h):
        if r <= 1e-5:
            return [-h, h]
        inner = h - r
        cs = [-h]
        for k in range(1, seg):
            cs.append(-inner - r * math.cos(math.pi / 2 * k / seg))
        cs += [-inner, inner]
        for k in range(seg - 1, 0, -1):
            cs.append(inner + r * math.cos(math.pi / 2 * k / seg))
        cs.append(h)
        return cs

    X, Y, Z = coords(hx), coords(hy), coords(hz)

    def place(p):
        q = Vector((max(-hx + r, min(hx - r, p[0])), max(-hy + r, min(hy - r, p[1])), max(-hz + r, min(hz - r, p[2]))))
        d = Vector(p) - q
        if d.length > 1e-9 and r > 0:
            q = q + d.normalized() * r
        else:
            q = Vector(p)
        return Vector(c) + q

    # Six faces, each a grid wound outwards.
    def face(axis, sign):
        a, b = [(1, 2), (2, 0), (0, 1)][axis]
        A, Bc = [X, Y, Z][a], [X, Y, Z][b]
        h = [hx, hy, hz][axis]
        P = []
        for ca in A:
            row = []
            for cb in Bc:
                p = [0.0, 0.0, 0.0]
                p[axis] = sign * h
                p[a] = ca
                p[b] = cb
                row.append(place(p))
            P.append(row)
        m.grid(P, region, flip=sign < 0)

    for ax in range(3):
        face(ax, 1)
        face(ax, -1)
    out = weld(m, 1e-6)
    if M is not None:
        out.transform(M)
    return out


def box(c, half, region, M=None):
    return rbox(c, half, 0.0, region, 1, M)


def weld(m, dist=1e-5):
    """Merge coincident vertices (exact grid joins)."""
    key = {}
    remap = []
    out = Mesh()
    for v in m.v:
        k = (round(v.x / dist), round(v.y / dist), round(v.z / dist))
        if k not in key:
            key[k] = out.vert(v)
        remap.append(key[k])
    for f, r in zip(m.f, m.r):
        out.face([remap[i] for i in f], r)
    return out


def cyl(p0, p1, r0, region, seg=12, r1=None, caps=True, cap_region=None):
    """A cylinder (or cone) from p0 to p1."""
    r1 = r0 if r1 is None else r1
    p0, p1 = Vector(p0), Vector(p1)
    a, u, v = _frame(p1 - p0)
    m = Mesh()
    ring = []
    for (p, r) in ((p0, r0), (p1, r1)):
        ring.append([m.vert(p + (u * math.cos(2 * math.pi * k / seg) + v * math.sin(2 * math.pi * k / seg)) * r) for k in range(seg)])
    for k in range(seg):
        k2 = (k + 1) % seg
        m.face((ring[0][k], ring[0][k2], ring[1][k2], ring[1][k]), region)
    if caps:
        c0, c1 = m.vert(p0), m.vert(p1)
        for k in range(seg):
            k2 = (k + 1) % seg
            m.face((c0, ring[0][k2], ring[0][k]), cap_region or region)
            m.face((c1, ring[1][k], ring[1][k2]), cap_region or region)
    _orient(m, (p0 + p1) / 2)
    return m


def _orient(m, centre):
    """Wind every face away from `centre` (for convex primitives)."""
    for i, f in enumerate(m.f):
        n = _fnormal(m, f)
        c = sum((m.v[j] for j in f), Vector()) / len(f)
        if n.dot(c - Vector(centre)) < 0:
            m.f[i] = tuple(reversed(f))


def _fnormal(m, f):
    n = Vector()
    for k in range(len(f)):
        a = m.v[f[k]]
        b = m.v[f[(k + 1) % len(f)]]
        n += a.cross(b)
    return n.normalized() if n.length > 0 else n


def lathe(prof, region, seg=24, axis=(0, 1, 0), c=(0, 0, 0), regions=None, arc=None, phase=0.0):
    """
    A surface of revolution: `prof` is (radius, along) pairs; the axis runs through c. Wound so
    that the outside faces out when the profile runs from -along to +along with the radius
    above the axis (reverse the profile to flip). `regions[k]` names the band after point k.
    """
    a, u, v = _frame(axis)
    c = Vector(c)
    m = Mesh()
    n = seg if arc is None else seg + 1
    rows = []
    for (r, h) in prof:
        row = []
        for k in range(n):
            t = phase + (2 * math.pi * k / seg if arc is None else arc[0] + (arc[1] - arc[0]) * k / seg)
            row.append(c + a * h + (u * math.cos(t) + v * math.sin(t)) * r)
        rows.append(row)
    ids = [[m.vert(p) for p in row] for row in rows]
    for i in range(len(prof) - 1):
        reg = regions[i] if regions else region
        if not reg:
            continue
        for k in range(seg if arc is None else n - 1):
            k2 = (k + 1) % n
            m.face((ids[i][k], ids[i][k2], ids[i + 1][k2], ids[i + 1][k]), reg)
    return weld(m, 1e-6)


def torus(c, axis, R, r, region, seg=24, segr=8, arc=None):
    a, u, v = _frame(axis)
    c = Vector(c)
    m = Mesh()
    n = seg if arc is None else seg + 1
    P = []
    for k in range(n):
        t = 2 * math.pi * k / seg if arc is None else arc[0] + (arc[1] - arc[0]) * k / seg
        d = u * math.cos(t) + v * math.sin(t)
        row = []
        for j in range(segr):
            s = 2 * math.pi * j / segr
            row.append(c + d * (R + r * math.cos(s)) + a * r * math.sin(s))
        P.append(row)
    m.grid(P, region, wrap_u=arc is None, wrap_v=True)
    # Outward: away from the tube's centre line.
    for i, f in enumerate(m.f):
        cen = sum((m.v[j] for j in f), Vector()) / len(f)
        rel = cen - c
        radial = (rel - a * rel.dot(a))
        core = c + radial.normalized() * R
        if _fnormal(m, f).dot(cen - core) < 0:
            m.f[i] = tuple(reversed(f))
    return m


def tube(path, r, region, seg=8, caps=True, closed=False):
    """A round tube along a polyline (bends mitred)."""
    path = [Vector(p) for p in path]
    n = len(path)
    m = Mesh()
    rings = []
    prev_u = None
    for i, p in enumerate(path):
        if closed:
            t = (path[(i + 1) % n] - path[i - 1]).normalized()
        elif i == 0:
            t = (path[1] - path[0]).normalized()
        elif i == n - 1:
            t = (path[-1] - path[-2]).normalized()
        else:
            t = ((path[i + 1] - path[i]).normalized() + (path[i] - path[i - 1]).normalized()).normalized()
        if prev_u is None:
            _, u, _ = _frame(t)
        else:
            u = (prev_u - t * prev_u.dot(t)).normalized()
        v = t.cross(u)
        prev_u = u
        rings.append([m.vert(p + (u * math.cos(2 * math.pi * k / seg) + v * math.sin(2 * math.pi * k / seg)) * r) for k in range(seg)])
    for i in range(n if closed else n - 1):
        i2 = (i + 1) % n
        for k in range(seg):
            k2 = (k + 1) % seg
            m.face((rings[i][k], rings[i][k2], rings[i2][k2], rings[i2][k]), region)
    if caps and not closed:
        for idx, ring in ((0, rings[0]), (n - 1, rings[-1])):
            cc = m.vert(path[idx])
            for k in range(seg):
                k2 = (k + 1) % seg
                m.face((cc, ring[k], ring[k2]) if idx == 0 else (cc, ring[k2], ring[k]), region)
    # Orient each face away from its nearest point on the path.
    for i, f in enumerate(m.f):
        cen = sum((m.v[j] for j in f), Vector()) / len(f)
        best = min(path, key=lambda q: (q - cen).length)
        if _fnormal(m, f).dot(cen - best) < 0:
            m.f[i] = tuple(reversed(f))
    return m


def prism(outline, y0, y1, region, side_region=None):
    """A flat 2D outline in (x, z) extruded across the car from y0 to y1 (closed)."""
    m = Mesh()
    a = [m.vert((x, y0, z)) for x, z in outline]
    b = [m.vert((x, y1, z)) for x, z in outline]
    n = len(outline)
    for k in range(n):
        k2 = (k + 1) % n
        m.face((a[k], a[k2], b[k2], b[k]), side_region or region)
    m.face(list(reversed(a)), region)
    m.face(b, region)
    c = Vector((sum(p[0] for p in outline) / n, (y0 + y1) / 2, sum(p[1] for p in outline) / n))
    _orient(m, c)
    return m


def circle_pts(c, r, n, start=0.0):
    return [(c[0] + r * math.cos(start + 2 * math.pi * k / n), c[1] + r * math.sin(start + 2 * math.pi * k / n)) for k in range(n)]


def rrect_pts(c, w, h, r, n=4):
    """A rounded rectangle outline (2D, counter-clockwise), w x h, corner radius r."""
    cx, cy = c
    r = min(r, w / 2 * 0.999, h / 2 * 0.999)
    pts = []
    for (qx, qy, a0) in ((w / 2 - r, h / 2 - r, 0), (-w / 2 + r, h / 2 - r, math.pi / 2), (-w / 2 + r, -h / 2 + r, math.pi), (w / 2 - r, -h / 2 + r, 1.5 * math.pi)):
        for k in range(n + 1):
            t = a0 + math.pi / 2 * k / n
            pts.append((cx + qx + r * math.cos(t), cy + qy + r * math.sin(t)))
    return pts


def chaikin(pts, n=2, closed=True):
    """Round a 2D polygon's corners (corner cutting, n passes)."""
    for _ in range(n):
        out = []
        m = len(pts)
        for k in range(m if closed else m - 1):
            a, b = pts[k], pts[(k + 1) % m]
            out.append((a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25))
            out.append((a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75))
        if not closed:
            out = [pts[0]] + out + [pts[-1]]
        pts = out
    return pts


def ccw(pts):
    """The polygon wound counter-clockwise."""
    n = len(pts)
    a = sum(pts[k][0] * pts[(k + 1) % n][1] - pts[(k + 1) % n][0] * pts[k][1] for k in range(n))
    return pts if a > 0 else list(reversed(pts))


def poly_offset(pts, d):
    """Offset a closed 2D polygon outwards by d (counter-clockwise polygons)."""
    n = len(pts)
    out = []
    area = sum(pts[k][0] * pts[(k + 1) % n][1] - pts[(k + 1) % n][0] * pts[k][1] for k in range(n))
    s = 1 if area > 0 else -1
    for k in range(n):
        p0, p1, p2 = Vector(pts[k - 1]), Vector(pts[k]), Vector(pts[(k + 1) % n])
        e0 = (p1 - p0).normalized()
        e1 = (p2 - p1).normalized()
        n0 = Vector((e0.y, -e0.x)) * s
        n1 = Vector((e1.y, -e1.x)) * s
        nn = (n0 + n1)
        if nn.length < 1e-6:
            nn = n0
        nn.normalize()
        cosh = max(0.35, nn.dot(n0))
        q = p1 + nn * (d / cosh)
        out.append((q.x, q.y))
    return out
