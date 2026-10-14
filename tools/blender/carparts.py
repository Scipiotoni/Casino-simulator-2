"""
Separate car parts for build_cars.py: wheels (tyres with sidewalls and tread, a rim of the
right kind for the car), the interior seen through the glass (seats, dashboard, steering
wheel), and the bolt-on bits (mirrors, bumpers, light bars, roof signs, exhausts, wipers).
Blender car space (see carkit.py); wheels are built round their own centre.
"""
import math

from mathutils import Matrix, Vector

from carkit import Mesh, _fnormal, cyl, lathe, rbox, torus, tube, weld

# Wheels are modelled with the axle along +Z (outer face at +Z), then turned so the outer face
# looks along -Y: the game's +z, the car's right; the game turns the left-hand wheels round.
WHEEL_TO_CAR = Matrix.Rotation(math.pi / 2, 4, 'X')


def _orient_about(m, core_fn):
    for i, f in enumerate(m.f):
        c = sum((m.v[j] for j in f), Vector()) / len(f)
        if _fnormal(m, f).dot(c - core_fn(c)) < 0:
            m.f[i] = tuple(reversed(f))


def tyre(R, w, rr, seg=24, kind='road', res=1):
    """
    A tyre round the Z axis: tread R, width w, bead (rim) radius rr. kind: 'road', 'low'
    (low profile), 'wall' (whitewall band), 'knobby' (off-road blocks), 'smooth'.
    """
    hw = w / 2
    sh = R - rr  # sidewall height
    if res:
        sr = min(0.028, sh * 0.25)
        prof = [
            (rr + 0.004, -hw * 0.8),
            (rr + sh * 0.55, -hw * 1.0),
            (R - sr, -hw * 0.93),
            (R, -hw * 0.62),
            (R, hw * 0.62),
            (R - sr, hw * 0.93),
            (rr + sh * 0.72, hw * 1.0),
            (rr + sh * 0.3, hw * 0.98),
            (rr + 0.004, hw * 0.8),
        ]
    else:
        prof = [(R - 0.02, -hw), (R, -hw * 0.5), (R, hw * 0.5), (R - 0.02, hw), (rr, hw * 0.9)]
    regions = []
    for (a, b) in zip(prof, prof[1:]):
        reg = 'tyre'
        if kind == 'wall' and a[1] > hw * 0.9 and b[1] > hw * 0.9 and min(a[0], b[0]) > rr + sh * 0.3 and max(a[0], b[0]) < rr + sh * 0.75:
            reg = 'wall'
        regions.append(reg)
    if kind == 'wall' and res:
        # A white band on the outer sidewall.
        regions = ['wall' if (a[1] > hw * 0.97 and b[1] > hw * 0.97) else r for (a, b), r in zip(zip(prof, prof[1:]), regions)]
    m = lathe(prof, 'tyre', seg, axis=(0, 0, 1), regions=regions)
    if kind == 'knobby' and res:
        # Tread blocks: every other step round the tread pushed out.
        for i, v in enumerate(m.v):
            rad = math.hypot(v.x, v.y)
            if rad > R - 0.003:
                a = math.atan2(v.y, v.x)
                k = int(round((a + math.pi) / (2 * math.pi) * seg)) % seg
                if k % 2 == 0:
                    s = (R + 0.018) / rad
                    m.v[i] = Vector((v.x * s, v.y * s, v.z))
    rc = (R + rr) / 2

    def core(c):
        d = Vector((c.x, c.y, 0))
        if d.length < 1e-9:
            return Vector((0, 0, 0))
        return d.normalized() * rc

    _orient_about(m, core)
    return m


def _disc(r0, r1, z, region, seg, z1=None):
    """A flat (or coned) annulus facing +Z."""
    z1 = z if z1 is None else z1
    m = lathe([(r1, z1), (r0, z)], region, seg, axis=(0, 0, 1)) if r0 > 0 else lathe([(r1, z1), (0.0, z)], region, seg, axis=(0, 0, 1))
    for i, f in enumerate(m.f):
        if _fnormal(m, f).z < 0:
            m.f[i] = tuple(reversed(f))
    return m


def _spoke(m, a, r0, r1, w0, w1, z0, z1, region, t=0.012, twist=0.0):
    """One spoke from the hub (r0) to the rim (r1): a front face and two sides."""
    def at(r, off, z, ang):
        d = Vector((math.cos(ang), math.sin(ang), 0))
        n = Vector((-d.y, d.x, 0))
        return d * r + n * off + Vector((0, 0, z))

    a1 = a + twist
    p = [at(r0, -w0 / 2, z0, a), at(r1, -w1 / 2, z1, a1), at(r1, w1 / 2, z1, a1), at(r0, w0 / 2, z0, a)]
    q = [v - Vector((0, 0, t)) for v in p]
    ids = [m.vert(v) for v in p + q]
    m.face((ids[0], ids[1], ids[2], ids[3]), region)
    m.face((ids[4], ids[5], ids[1], ids[0]), region)
    m.face((ids[3], ids[2], ids[6], ids[7]), region)
    return ids


def rim(kind, rr, w, seg=24, res=1, spokes=5):
    """
    A rim round the Z axis (outer face at +Z) for a tyre with bead radius rr and width w.
    kind: 'alloy' (n spokes), 'twin' (n twin spokes), 'multi', 'fuchs', 'slot', 'steel',
    'dogdish', 'fullcap', 'retro', 'mesh', 'military', 'turbine'.
    """
    m = Mesh()
    hw = w / 2
    face_z = hw * 0.62
    lip_r = rr + 0.012
    inner = rr - 0.022
    if not res:
        m.extend(_disc(0.0, lip_r, face_z * 0.8, 'rim', seg))
        return m
    # Lip and barrel.
    m.extend(lathe([(inner, face_z - 0.03), (inner + 0.004, face_z + 0.004), (lip_r, face_z + 0.004), (rr, face_z - 0.02)], 'rim', seg, axis=(0, 0, 1)))
    m.extend(lathe([(inner, -hw * 0.8), (inner, face_z - 0.03)], 'rim2', seg, axis=(0, 0, 1)))
    # The back: a dark disc with the brake disc and hub in front of it.
    m.extend(_disc(0.0, inner, -hw * 0.3, 'rim2', seg))
    if kind in ('alloy', 'twin', 'multi', 'fuchs', 'turbine', 'mesh'):
        m.extend(_disc(rr * 0.25, rr * 0.78, -hw * 0.05, 'metal', seg))
    hub_r = rr * (0.24 if kind != 'military' else 0.3)
    if kind in ('alloy', 'twin', 'multi', 'turbine', 'mesh'):
        n = spokes
        dish = 0.02 if kind != 'turbine' else 0.035
        z_hub = face_z - dish
        m.extend(lathe([(hub_r + 0.01, z_hub - 0.03), (hub_r + 0.01, z_hub), (0.0, z_hub + 0.01)], 'rim', seg, axis=(0, 0, 1)))
        m.extend(_disc(0.0, hub_r * 0.42, z_hub + 0.012, 'chrome' if kind != 'turbine' else 'rim2', 10))
        if kind == 'alloy':
            for k in range(n):
                _spoke(m, 2 * math.pi * k / n, hub_r * 0.9, inner + 0.003, 0.055 * rr / 0.23, 0.075 * rr / 0.23, z_hub + 0.004, face_z - 0.004, 'rim', t=0.025)
        elif kind == 'twin':
            for k in range(n):
                for o in (-0.09, 0.09):
                    _spoke(m, 2 * math.pi * k / n + o, hub_r * 0.95, inner + 0.003, 0.03 * rr / 0.23, 0.026 * rr / 0.23, z_hub + 0.004, face_z - 0.004, 'rim', t=0.022)
        elif kind == 'multi':
            for k in range(n):
                for o in (-0.07, 0.07):
                    _spoke(m, 2 * math.pi * k / n + o, hub_r * 0.95, inner + 0.003, 0.028 * rr / 0.23, 0.03 * rr / 0.23, z_hub + 0.004, face_z - 0.002, 'rim', t=0.02, twist=o * 0.8)
        elif kind == 'turbine':
            for k in range(n):
                _spoke(m, 2 * math.pi * k / n, hub_r * 0.9, inner + 0.003, 0.03 * rr / 0.23, 0.04 * rr / 0.23, z_hub + 0.004, face_z - 0.003, 'rim', t=0.02, twist=0.22)
        elif kind == 'mesh':
            for k in range(n):
                for o in (-0.13, 0.13):
                    _spoke(m, 2 * math.pi * k / n, hub_r * 0.95, inner + 0.003, 0.02, 0.02, z_hub + 0.004, face_z - 0.004, 'rim', t=0.015, twist=o)
    elif kind == 'fuchs':
        # Five forged petals, polished, with the black between them.
        m.extend(_disc(hub_r, inner + 0.002, face_z - 0.026, 'rim2', seg))
        m.extend(lathe([(hub_r + 0.012, face_z - 0.03), (hub_r + 0.012, face_z - 0.004), (hub_r * 0.5, face_z + 0.002), (0.0, face_z + 0.004)], 'rim', seg, axis=(0, 0, 1)))
        for k in range(5):
            _spoke(m, 2 * math.pi * k / 5, hub_r * 0.9, inner + 0.003, 0.05 * rr / 0.2, 0.15 * rr / 0.2, face_z - 0.006, face_z - 0.008, 'rim', t=0.02)
        m.extend(_disc(0.0, hub_r * 0.45, face_z + 0.006, 'paint2', 12))
    elif kind == 'slot':
        # A chrome dish with five slots and a cap.
        m.extend(lathe([(inner + 0.002, face_z - 0.004), (rr * 0.62, face_z - 0.05), (hub_r, face_z - 0.035), (hub_r * 0.6, face_z - 0.01), (0.0, face_z - 0.005)], 'chrome', seg, axis=(0, 0, 1)))
        for k in range(5):
            a = 2 * math.pi * (k + 0.5) / 5
            _slot(m, a, rr * 0.36, rr * 0.7, 0.045 * rr / 0.2, face_z - 0.035)
    elif kind in ('steel', 'military'):
        # A pressed steel disc with round holes; the military one has a split ring of bolts.
        reg = 'rim'
        m.extend(lathe([(inner + 0.002, face_z - 0.03), (rr * 0.6, face_z - 0.012), (hub_r + 0.015, face_z - 0.005), (hub_r, face_z + 0.004), (0.0, face_z + 0.006)], reg, seg, axis=(0, 0, 1)))
        holes = 6 if kind == 'steel' else 0
        for k in range(holes):
            a = 2 * math.pi * (k + 0.5) / holes
            c = Vector((math.cos(a), math.sin(a), 0)) * rr * 0.66
            m.extend(_disc_at(c, 0.028 * rr / 0.2, face_z - 0.008, 'rim2', 8))
        nuts = 5
        for k in range(nuts):
            a = 2 * math.pi * k / nuts
            c = Vector((math.cos(a), math.sin(a), 0)) * hub_r * 0.75
            m.extend(cyl(c + Vector((0, 0, face_z)), c + Vector((0, 0, face_z + 0.012)), 0.009, 'chrome' if kind == 'steel' else 'metal', 6))
        if kind == 'military':
            for k in range(10):
                a = 2 * math.pi * k / 10
                c = Vector((math.cos(a), math.sin(a), 0)) * rr * 0.83
                m.extend(cyl(c + Vector((0, 0, face_z - 0.03)), c + Vector((0, 0, face_z - 0.018)), 0.01, 'metal', 6))
        else:
            m.extend(lathe([(hub_r * 0.55, face_z + 0.004), (hub_r * 0.5, face_z + 0.018), (0.0, face_z + 0.024)], 'chrome', 12, axis=(0, 0, 1)))
    elif kind == 'dogdish':
        m.extend(lathe([(inner + 0.002, face_z - 0.03), (rr * 0.7, face_z - 0.012), (rr * 0.5, face_z - 0.006), (0.0, face_z - 0.004)], 'rim', seg, axis=(0, 0, 1)))
        m.extend(lathe([(rr * 0.5, face_z - 0.004), (rr * 0.47, face_z + 0.02), (rr * 0.3, face_z + 0.04), (0.0, face_z + 0.046)], 'chrome', seg, axis=(0, 0, 1)))
        m.extend(lathe([(inner + 0.002, face_z + 0.002), (rr * 0.86, face_z - 0.006)], 'chrome', seg, axis=(0, 0, 1)))
    elif kind == 'fullcap':
        # A full chrome hubcap: a domed disc with ribs and a spinner.
        m.extend(lathe([(lip_r, face_z + 0.004), (rr * 0.9, face_z + 0.012), (rr * 0.55, face_z + 0.03), (rr * 0.3, face_z + 0.04), (rr * 0.12, face_z + 0.06), (0.0, face_z + 0.062)], 'chrome', seg, axis=(0, 0, 1)))
        for k in range(12):
            a = 2 * math.pi * k / 12
            _spoke(m, a, rr * 0.34, rr * 0.82, 0.008, 0.012, face_z + 0.038, face_z + 0.016, 'rim2', t=0.002)
        for k in range(3):
            a = 2 * math.pi * k / 3
            _spoke(m, a, 0.0, rr * 0.36, 0.03, 0.014, face_z + 0.07, face_z + 0.05, 'chrome', t=0.015)
    elif kind == 'retro':
        # Small painted steel wheel with a body-coloured centre and a chrome cap.
        m.extend(lathe([(inner + 0.002, face_z - 0.03), (rr * 0.72, face_z - 0.015), (rr * 0.45, face_z - 0.005), (0.0, face_z)], 'rim', seg, axis=(0, 0, 1)))
        for k in range(4):
            a = 2 * math.pi * (k + 0.5) / 4
            c = Vector((math.cos(a), math.sin(a), 0)) * rr * 0.62
            m.extend(_disc_at(c, 0.03, face_z - 0.008, 'rim2', 8))
        m.extend(lathe([(rr * 0.42, face_z), (rr * 0.38, face_z + 0.018), (0.0, face_z + 0.026)], 'chrome', seg, axis=(0, 0, 1)))
    return m


def _disc_at(c, r, z, region, seg):
    m = Mesh()
    ids = [m.vert(Vector((c.x + math.cos(2 * math.pi * k / seg) * r, c.y + math.sin(2 * math.pi * k / seg) * r, z))) for k in range(seg)]
    ci = m.vert(Vector((c.x, c.y, z)))
    for k in range(seg):
        m.face((ci, ids[k], ids[(k + 1) % seg]), region)
    return m


def _slot(m, a, r0, r1, w, z):
    d = Vector((math.cos(a), math.sin(a), 0))
    n = Vector((-d.y, d.x, 0))
    p = [d * r0 - n * w * 0.35, d * r1 - n * w / 2, d * r1 + n * w / 2, d * r0 + n * w * 0.35]
    ids = [m.vert(v + Vector((0, 0, z + 0.004))) for v in p]
    m.face(ids, 'rim2')


def wheel(R, w, rim_kind, tyre_kind='road', rim_ratio=0.68, seg=24, res=1, spokes=5, brake=False):
    """A complete wheel (tyre + rim) round its centre, outer face towards -Y."""
    rr = R * rim_ratio
    if not res:
        seg = 10
    m = tyre(R, w, rr, seg, tyre_kind, res)
    m.extend(rim(rim_kind, rr, w, seg, res, spokes))
    m.transform(WHEEL_TO_CAR)
    return m


def place(m, x, y, z):
    return m.copy().transform(Matrix.Translation((x, y, z)))


def wheel_pair(m, x, y, z):
    """A wheel on each side at (x, +-y, z): the left one turned round so its face looks out."""
    out = place(m, x, -y, z)
    left = m.copy().transform(Matrix.Rotation(math.pi, 4, 'Z'))
    out.extend(place(left, x, y, z))
    return out


# ------------------------------------------------------------------ interior

def seat(x, y, zc, w=0.5, depth=0.5, back=0.62, recline=0.3, region='seat', res=1, head=True, bolster=True):
    """A front seat: cushion top at zc, front edge at x + depth / 2, backrest reclined."""
    m = Mesh()
    seg = 2 if res else 1
    m.extend(rbox((x, y, zc - 0.06), (depth / 2, w / 2, 0.06), 0.035, region, seg))
    bx = x - depth / 2 + 0.05
    M = Matrix.Translation((bx, y, zc)) @ Matrix.Rotation(-recline, 4, 'Y') @ Matrix.Translation((0, 0, back / 2))
    m.extend(rbox((0, 0, 0), (0.055, w / 2 * 0.96, back / 2), 0.04, region, seg, M))
    if bolster and res:
        for s in (-1, 1):
            Mb = M @ Matrix.Translation((0.04, s * w * 0.42, -back * 0.1))
            m.extend(rbox((0, 0, 0), (0.05, 0.05, back * 0.32), 0.03, region, 1, Mb))
    if head:
        Mh = M @ Matrix.Translation((0.0, 0, back / 2 + 0.11))
        m.extend(rbox((0, 0, 0), (0.05, w * 0.3, 0.09), 0.035, region, seg, Mh))
    return m


def bench(x, w, zc, depth=0.5, back=0.58, recline=0.3, region='seat', res=1, head=False):
    return seat(x, 0.0, zc, w, depth, back, recline, region, res, head, bolster=False)


def dashboard(x_front, x_back, half_w, z_top, z_low, driver_y, region='interior', res=1):
    """The dashboard under the windscreen with an instrument hood in front of the driver."""
    m = Mesh()
    cx = (x_front + x_back) / 2
    m.extend(rbox((cx, 0, (z_top + z_low) / 2), ((x_front - x_back) / 2, half_w, (z_top - z_low) / 2), 0.05, region, 2 if res else 1))
    if res:
        m.extend(rbox((x_back + 0.1, driver_y, z_top + 0.035), (0.09, 0.2, 0.04), 0.03, region, 2))
        # The centre stack and console.
        m.extend(rbox((x_back - 0.05, 0, (z_top + z_low) / 2 - 0.12), (0.06, 0.13, (z_top - z_low) / 2), 0.02, region, 1))
    return m


def console(x0, x1, z0, z1, region='interior'):
    return rbox(((x0 + x1) / 2, 0, (z0 + z1) / 2), ((x0 - x1) / 2, 0.1, (z1 - z0) / 2), 0.03, region, 1)


def steering_wheel(c, tilt=0.45, r=0.19, res=1, region='black'):
    """A steering wheel facing the driver (centre c, tilted back by `tilt`) and its column."""
    m = Mesh()
    axis = Vector((-math.cos(tilt), 0, math.sin(tilt)))
    m.extend(torus(c, axis, r, 0.017, region, 20 if res else 8, 6 if res else 3))
    m.extend(cyl(Vector(c) - axis * 0.01, Vector(c) + axis * 0.03, 0.05, region, 10))
    _, u, v = _frame(axis)
    for ang in (0.0, math.pi * 0.5, math.pi):
        d = u * math.cos(ang) + v * math.sin(ang)
        # Spokes at 3, 6 and 9 o'clock.
        if d.z > 0.5:
            continue
        m.extend(tube([Vector(c), Vector(c) + d * r], 0.012, region, 4, caps=False))
    m.extend(cyl(Vector(c) - axis * 0.01, Vector(c) - axis * 0.32, 0.035, region, 8))
    return m


def _frame(axis):
    a = Vector(axis).normalized()
    ref = Vector((0, 0, 1)) if abs(a.z) < 0.9 else Vector((1, 0, 0))
    u = a.cross(ref).normalized()
    v = a.cross(u).normalized()
    return a, u, v


# ------------------------------------------------------------------ bolt-on parts

def mirror(base, out=0.17, h=0.11, l=0.15, region='paint', res=1, arm=True):
    """A door mirror on the left at `base` (the sail), housing in `region`, glass at the back."""
    m = Mesh()
    bx, by, bz = base
    c = (bx - 0.02, by + out * 0.62, bz + 0.05)
    m.extend(rbox(c, (l / 2, out * 0.38, h / 2), 0.04, region, 2 if res else 1))
    if arm:
        m.extend(rbox((bx, by + out * 0.15, bz + 0.02), (0.05, out * 0.17, 0.025), 0.012, 'black', 1))
    # Mirror glass facing back.
    gx = c[0] - l / 2 - 0.002
    g = Mesh()
    pts = [(c[1] - out * 0.33, c[2] - h * 0.4), (c[1] + out * 0.33, c[2] - h * 0.4), (c[1] + out * 0.33, c[2] + h * 0.4), (c[1] - out * 0.33, c[2] + h * 0.4)]
    ids = [g.vert((gx, y, z)) for (y, z) in pts]
    g.face(list(reversed(ids)), 'mirror')
    m.extend(g)
    return m


def bar_bumper(x, z, half_w, r, wrap, region='chrome', ends=0.25, seg=8, sign=1):
    """A classic bar bumper across the car at x (sign +1 at the front), wrapping round the corners."""
    pts = []
    n = 6
    for k in range(-n, n + 1):
        y = half_w * k / n
        pts.append(Vector((x - sign * wrap * (abs(k) / n) ** 4, y, z)))
    for s in (-1, 1):
        pts_end = Vector((x - sign * (wrap + ends), s * (half_w - 0.02), z))
        if s < 0:
            pts.insert(0, pts_end)
        else:
            pts.append(pts_end)
    return tube(pts, r, region, seg)


def blade_bumper(x, z, half_w, h, depth, wrap, region='chrome', sign=1, res=1):
    """A flat chrome blade bumper (rounded box bent round the corners)."""
    m = Mesh()
    seg = 7 if res else 3
    for k in range(seg):
        y0 = -half_w + 2 * half_w * k / seg
        y1 = -half_w + 2 * half_w * (k + 1) / seg
        yc = (y0 + y1) / 2
        back = wrap * (abs(yc) / half_w) ** 4
        M = Matrix.Translation((x - sign * back, yc, z)) @ Matrix.Rotation(-sign * math.atan2(4 * wrap * abs(yc) ** 3 / half_w ** 4, 1) * (1 if yc > 0 else -1), 4, 'Z')
        m.extend(rbox((0, 0, 0), (depth / 2, (y1 - y0) / 2 + 0.01, h / 2), min(h, depth) * 0.45, region, 2 if res else 1, M))
    return m


def lightbar(x, z, half_w, depth=0.26, h=0.09, res=1):
    """A police light bar on the roof: red on the left, blue on the right, a black base."""
    m = Mesh()
    m.extend(rbox((x, 0, z + 0.02), (depth / 2, half_w, 0.025), 0.015, 'black', 1))
    seg = 2 if res else 1
    for s, reg in ((1, 'red'), (-1, 'blue')):
        m.extend(rbox((x, s * half_w * 0.52, z + 0.045 + h / 2), (depth / 2 * 0.92, half_w * 0.46, h / 2), 0.03, reg, seg))
    m.extend(rbox((x, 0, z + 0.045 + h / 2), (depth / 2 * 0.85, half_w * 0.07, h / 2 * 0.9), 0.02, 'sign', 1))
    for s in (-1, 1):
        m.extend(rbox((x, s * half_w * 0.6, z), (0.04, 0.03, 0.03), 0.01, 'black', 1))
    return m


def letters(text, centre, z0, h, sign=1, gap=0.2):
    """
    Block capitals (T A X I P O L C E S) as rectangles [(s, t) corners] centred on `centre`
    along s, reading towards +s (sign 1) or -s (sign -1); for laying on as decals.
    """
    t = h * 0.17  # stroke
    w = h * 0.62
    step = w + h * gap
    total = step * len(text) - h * gap
    cx = centre - sign * total / 2
    out = []
    for ch in text:
        for (u0, v0, u1, v1) in _glyph(ch, w, h, t):
            a, b = cx + sign * u0, cx + sign * u1
            out.append([(a, z0 + v0), (b, z0 + v0), (b, z0 + v1), (a, z0 + v1)])
        cx += sign * step
    return out


def _glyph(ch, w, h, t):
    """Bars (u0, v0, u1, v1) for one block letter, u across, v up."""
    if ch == 'T':
        return [(0, h - t, w, h), (w / 2 - t / 2, 0, w / 2 + t / 2, h - t)]
    if ch == 'A':
        return [(0, 0, t, h), (w - t, 0, w, h), (t, h - t, w - t, h), (t, h * 0.45, w - t, h * 0.45 + t)]
    if ch == 'X':
        return [(0, 0, t, h * 0.4), (w - t, 0, w, h * 0.4), (0, h * 0.6, t, h), (w - t, h * 0.6, w, h), (t * 0.6, h * 0.4, w - t * 0.6, h * 0.6)]
    if ch == 'I':
        return [(w / 2 - t / 2, 0, w / 2 + t / 2, h)]
    if ch == 'P':
        return [(0, 0, t, h), (t, h - t, w, h), (w - t, h * 0.45, w, h - t), (t, h * 0.45, w - t, h * 0.45 + t)]
    if ch == 'O':
        return [(0, 0, t, h), (w - t, 0, w, h), (t, 0, w - t, t), (t, h - t, w - t, h)]
    if ch == 'L':
        return [(0, 0, t, h), (t, 0, w, t)]
    if ch == 'C':
        return [(0, 0, t, h), (t, 0, w, t), (t, h - t, w, h)]
    if ch == 'E':
        return [(0, 0, t, h), (t, 0, w, t), (t, h - t, w, h), (t, h * 0.45, w * 0.85, h * 0.45 + t)]
    if ch == 'S':
        return [(0, h - t, w, h), (0, h * 0.45, t, h - t), (0, h * 0.45, w, h * 0.45 + t), (w - t, t, w, h * 0.45), (0, 0, w, t)]
    return []
