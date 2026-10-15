"""
The off-roaders and the modern pickups: the Gelände G (a square German off-roader), the Trail
Rambler (a two-door seven-slot off-roader), the Hammer H1 (a wide military-style truck), the
Fjord Rancher 150 (a full-size crew-cab pickup), the Kaido Hilo (a mid-size double-cab pickup)
and the Edison Cyberwedge (a flat-panelled steel wedge of a pickup). Built with the kit in
cars_trucks.py: the flat-backed Cab glasshouse, swept bumpers, boards and flares.
"""
import math

from mathutils import Matrix, Vector

from carkit import C, const, rbox, box, cyl, tube, rrect_pts, circle_pts
from carbody import Projector, aim
import carparts as P
from carcommon import car, closed_car, lamp, flat, line, gaps, handle, plate, rounded, arch_pts
from cars_trucks import Cab, sweep, rsection, bumper, sweep_xz


# ------------------------------------------------------------------ shared bits

def cowl(o, res, pr, x, half, roof):
    """A black strip under the windscreen and two wipers on it."""
    line(o, pr, 'top', [(x, -half), (x, half)], 0.07, 'black', 0.003)
    if res:
        for (a, b) in ((half * 0.7, -half * 0.05), (-half * 0.05, -half * 0.8)):
            o.body.extend(tube([Vector((x - 0.03, a, roof(x - 0.03) + 0.012)), Vector((x - 0.09, b, roof(x - 0.09) + 0.016))], 0.007, 'black', 4))


def side_board(o, x0, x1, y, z, w=0.16, region='black'):
    """A running board / side step along both sides."""
    for s in (1, -1):
        o.body.extend(sweep([(x1, s * y), (x0, s * y)], z, rsection(w, 0.045, 0.018, 1), region))


def hinge(o, x, z, y, region='black'):
    """An exposed door hinge on both sides."""
    for s in (1, -1):
        o.body.extend(rbox((x, s * y, z), (0.035, 0.012, 0.03), 0.008, region, 1))


def arch_flare(o, res, x, R, r_in, width, out, y_body, region='black', a0=-8, a1=188, z_c=None, n=10):
    """A flat flare round a wheel arch, `width` wide, standing `out` proud of the body side at y_body."""
    zc = R if z_c is None else z_c
    path = [(x + r_in * math.cos(math.radians(a0 + (a1 - a0) * k / n)), zc + r_in * math.sin(math.radians(a0 + (a1 - a0) * k / n))) for k in range(n + 1)]
    if not res:
        path = path[::2] + ([path[-1]] if n % 2 else [])
    sec = [(y_body - 0.02, 0.0), (y_body + out, 0.0), (y_body + out, width), (y_body + out - 0.03, width), (y_body - 0.02, 0.02)]
    m = sweep_xz(path, sec, region, centre=(x, zc))
    o.body.extend(m.both())


def door_gaps(o, pr, doors, z_top, z_bot, arch=None):
    """Door shut lines: doors = [(front x, rear x)]; the last door's bottom can follow the rear arch."""
    ls = []
    for (a, b) in doors:
        ls.append([(a, z_top), (a, z_bot)])
        ls.append([(b, z_top), (b, z_bot)])
        ls.append([(a, z_bot), (b, z_bot)])
    gaps(o, pr, ls)


def cab_region(glass_x, pillars, ws_x, back_th=0.45, frame='gloss', pillar='paint', roof='paint', back_glass=True,
               front_pillar=None):
    """A glass_region function: side windows between pillars, the windscreen ahead of ws_x, the back glass."""
    def reg(i):
        seg, xb, xr, k = i['seg'], i['xb'], i['xr'], i['k']
        if seg == 'side':
            if i['zone'] == 'rear':
                return 'glass' if (back_glass and k >= 1 and i['th'] > back_th) else pillar
            if k == 0:
                return frame
            if not (glass_x[0] < xb < glass_x[1]):
                return front_pillar if (front_pillar and xb >= glass_x[1]) else pillar
            for (a, b) in pillars:
                if a < xb < b:
                    return pillar
            return 'glass'
        if seg == 'corner':
            return roof if i['zone'] != 'rear' else pillar
        if xr > ws_x and i['zone'] != 'rear':
            return 'glass'
        return roof
    return reg


# ------------------------------------------------------------------ Gelände G

def gclass_params():
    L, W = 4.6, 1.93
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.42, -1.43
    R = 0.385
    gx1 = 1.0
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.275, track=1.62, arch_gap=0.065, arch_flat=0.35,
        rim='multi', spokes=5, rim_ratio=0.66, tyre='road', color=0x15151a,
        bottom=C((x0, 0.5), (x0 + 0.2, 0.46), (xr, 0.44), (xf, 0.44), (x1 - 0.2, 0.46), (x1, 0.5)),
        shoulder=C((x0, 1.18), (x0 + 0.04, 1.205), (gx1, 1.21), (x1 - 0.04, 1.19), (x1, 1.17)),
        top=C((x0, 1.19), (x0 + 0.04, 1.215), (gx1, 1.225), (x1 - 0.04, 1.205), (x1, 1.18)),
        width=const(0.93),
        tuck=const(0.03), tumble=const(0.015), cfrac=const(0.62),
        rb=const(0.04), rs=const(0.03),
        front=(0.06, 4.0), rear=(0.06, 4.0),
        flares=[(xf, 0.62, 0.03, 0.66, 0.24), (xr, 0.62, 0.03, 0.66, 0.24)],
        open=[(-2.15, 0.96, 0.52)],
        keys=[gx1, x0 + 0.12, x1 - 0.12, x0 + 0.3, x1 - 0.3],
        bl_base=x0, ws_base=gx1, inset=0.03, glass=False,
        driver_y=0.4, hip_f=(-0.12, 0.98), benches=[(-1.15, 1.4, 1.0)], seats=4,
        dash=(0.98, 0.58, 0.84, 0.85, 1.24), wheel_c=(0.3, 1.2), wheel_tilt=0.4,
        mirror=(0.9, 0.9, 1.24), mirror_out=0.19,
        height=1.97,
    )

    def hull_region(i, hull):
        if i['seg'] == 'top' and x0 + 0.05 < i['x'] < gx1 - 0.01 and abs(i['c'].y) < hull.edge_y(i['x']) - 0.04:
            return 'interior'
        return None

    p['hull_region'] = hull_region
    p['decor'] = gclass_decor
    return p


G_RAIL = C((-2.3, 1.875), (0.77, 1.88), (0.81, 1.855), (1.0, 1.22))
G_ROOF = C((-2.3, 1.925), (-2.2, 1.95), (0.72, 1.955), (0.8, 1.925), (1.0, 1.235))


def gclass_decor(o, res, pr, prg_unused, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    gx1 = p['ws_base']
    reg = cab_region((-2.1, 0.74), [(-1.45, -1.33), (-0.3, -0.18)], 0.79)
    cab = Cab(hull, x0, gx1, C((x0, 0.86), (gx1, 0.875)), G_RAIL, G_ROOF, corner=const(0.035), inset=const(0.03),
              lines=[(-2.1, -2.1), (-1.45, -1.45), (-1.33, -1.33), (-0.8, -0.8), (-0.3, -0.3), (-0.18, -0.18), (0.3, 0.3),
                     (0.74, 0.74), (0.85, 0.82)],
              rear=(0.06, 4.0), region=reg, side_s=(0.0, 0.07), taper=False, between=1, base_drop=0.03)
    o.body.extend(cab.build(res, shell=bool(res)))
    # Rain gutters along the roof edges.
    if res:
        for s in (1, -1):
            o.body.extend(box((-0.75, s * 0.865, 1.875), (1.5, 0.008, 0.012), 'paint'))

    # ---- front: upright grille with three slats, round lamps, indicators on the wings.
    flat(o, pr, 'front', rrect_pts((0.0, 0.9), 0.84, 0.36, 0.02, 2), 'grille', 0.005, bezel=(0.02, 'paint', 0.007), res=res, rings=1)
    if res:
        for z in (0.81, 0.9, 0.99):
            line(o, pr, 'front', [(-0.4, z), (0.4, z)], 0.035, 'paint', 0.012)
    for s in (1, -1):
        hc = (s * 0.655, 0.92)
        flat(o, pr, 'front', circle_pts(hc, 0.14, 18 if res else 8), 'gloss', 0.004, res=res, rings=1)
        lamp(o, pr, 'front', circle_pts(hc, 0.105, 18 if res else 8), 'head', res, 'chrome', 0.014, 0.008, both=False, bw=0.012)
        # The indicator pod on top of the wing.
        o.body.extend(rbox((x1 - 0.12, s * 0.79, 1.225), (0.08, 0.075, 0.035), 0.02 if res else 0.0, 'paint', 1))
        o.body.extend(rbox((x1 - 0.05, s * 0.79, 1.225), (0.015, 0.06, 0.025), 0.01 if res else 0.0, 'amber', 1))
    # A heavy black bumper with fog lamps, the plate on it.
    fb = rbox((x1 + 0.06, 0, 0.53), (0.08, 0.94, 0.12), 0.035, 'black', 2 if res else 1)
    o.body.extend(fb)
    pf = Projector(fb)
    plate(o, pf, 'front', (0.0, 0.53), 0.3, 0.12)
    if res:
        for s in (1, -1):
            lamp(o, pf, 'front', circle_pts((s * 0.62, 0.52), 0.05, 12), 'head', res, 'chrome', 0.006, 0.006, both=False, bw=0.008)
        # Bonnet shut lines along the wings, its front edge.
        gaps(o, pr, [[(gx1 + 0.05, 0.8), (x1 - 0.02, 0.8)]], frame='top')
        line(o, pr, 'front', [(-0.8, 1.15), (0.8, 1.15)], 0.006, 'gap', 0.002)
    cowl(o, res, pr, gx1 - 0.035, 0.82, G_ROOF)

    # ---- sides: doors with exposed hinges, push-button handles, a rubbing strip, steps, flares.
    if res:
        rear_arch = arch_pts(xr, R, R + 0.12, 70, 0, 6)
        gaps(o, pr, [
            [(0.98, 1.2), (0.98, 0.47)],
            [(-0.24, 1.21), (-0.24, 0.47)],
            [(0.98, 0.47), (xr + R + 0.12, 0.47)],
            [(-1.45, 1.21), (-1.45, 0.88)] + rear_arch[:-1],
        ])
        for x in (0.96, -0.26):
            for z in (1.08, 0.64):
                hinge(o, x, z, 0.945)
        for x in (-0.12, -1.33):
            handle(o, pr, x, 1.1, 'chrome', 0.1, 0.03)
        for (a, b) in ((x1 - 0.1, xf + R + 0.13), (xf - R - 0.13, xr + R + 0.13), (xr - R - 0.13, x0 + 0.1)):
            line(o, pr, 'side', [(a, 0.78), (b, 0.78)], 0.05, 'black', 0.005, both=True)
    for x in (xf, xr):
        arch_flare(o, res, x, R, R + 0.075, 0.07, 0.04, 0.9)
    side_board(o, xr + R + 0.1, xf - R - 0.1, 0.98, 0.38)

    # ---- rear: side-hinged door with the spare wheel, tall tail lamps.
    if res:
        gaps(o, pr, [[(-0.78, 1.2), (-0.78, 0.55), (0.82, 0.55), (0.82, 1.2)]], frame='rear', both=False)
        for z in (1.0, 0.65):
            o.body.extend(rbox((x0 - 0.01, -0.8, z), (0.02, 0.035, 0.03), 0.008, 'black', 1))
    for s in (1, -1):
        lamp(o, pr, 'rear', rrect_pts((s * 0.85, 0.92), 0.1, 0.32, 0.015, 2), 'tail', res, 'gloss', 0.006, 0.006, both=False, bw=0.01)
        if res:
            lamp(o, pr, 'rear', rrect_pts((s * 0.85, 0.82), 0.08, 0.06, 0.01, 1), 'amber', res, None, 0.002, 0.014, both=False)
    spare = P.wheel(R, 0.26, 'steel', 'road', 0.66, 20 if res else 8, res)
    spare.transform(Matrix.Rotation(-math.pi / 2, 4, 'Z'))
    spare.transform(Matrix.Translation((x0 - 0.15, 0.0, 1.08)))
    o.body.extend(spare)
    if res:
        o.body.extend(cyl((x0 - 0.27, 0.0, 1.08), (x0 - 0.29, 0.0, 1.08), 0.3, 'paint', 24))
        o.body.extend(cyl((x0 - 0.288, 0.0, 1.08), (x0 - 0.292, 0.0, 1.08), 0.27, 'rim2', 24))
    o.body.extend(rbox((x0 - 0.05, 0, 0.55), (0.07, 0.93, 0.1), 0.03, 'black', 2 if res else 1))
    plate(o, pr, 'rear', (0.45, 0.72), 0.3, 0.13)


@car
def gclass(res):
    o = closed_car(res, gclass_params())
    o.meta['dims'][0] = 4.82
    return o
