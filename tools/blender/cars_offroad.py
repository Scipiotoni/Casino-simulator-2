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


def side_board(o, x0, x1, y, z, w=0.16, region='black', res=1):
    """A running board / side step along both sides."""
    for s in (1, -1):
        if res:
            o.body.extend(sweep([(x1, s * y), (x0, s * y)], z, rsection(w, 0.045, 0.018, 1), region))
        else:
            o.body.extend(box(((x0 + x1) / 2, s * y, z), ((x1 - x0) / 2, w / 2, 0.0225), region))


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
               front_pillar=None, mid_pillar=None, back_k=1):
    """A glass_region function: side windows between pillars, the windscreen ahead of ws_x, the back glass."""
    def reg(i):
        seg, xb, xr, k = i['seg'], i['xb'], i['xr'], i['k']
        if seg == 'side':
            if i['zone'] == 'rear':
                return 'glass' if (back_glass and k >= back_k and i['th'] > back_th) else pillar
            if k == 0:
                return frame
            if not (glass_x[0] < xb < glass_x[1]):
                return front_pillar if (front_pillar and xb >= glass_x[1]) else pillar
            for (a, b) in pillars:
                if a < xb < b:
                    return mid_pillar or pillar
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
    side_board(o, xr + R + 0.1, xf - R - 0.1, 0.98, 0.38, res=res)

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


# ------------------------------------------------------------------ crew-cab pickups

def crew_params(c):
    """A four-door pickup from a config: hull with a cab and an open bed, the rest in crew_decor."""
    L, W = c['L'], c['W']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = c['xf'], c['xr'], c['R']
    gx0, gx1 = c['gx0'], c['gx1']
    zb, belt, cowl_z, hood_z, crown = c['zb'], c['belt'], c['cowl_z'], c['hood_z'], c['crown']
    bed = c['bed']
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=c['tyre_w'], track=c['track'], arch_gap=c.get('arch_gap', 0.06), arch_flat=c.get('arch_flat', 0.4),
        rim=c['rim'], spokes=c.get('spokes', 6), rim_ratio=c['rim_ratio'], tyre=c.get('tyre', 'road'), color=c['color'],
        bottom=C((x0, zb + 0.09), (x0 + 0.15, zb + 0.06), (xr - R - 0.3, zb + 0.03), (xr, zb), (xf, zb), (x1 - 0.2, zb + 0.02), (x1, zb + 0.05)),
        shoulder=C((x0, belt - 0.025), (x0 + 0.06, belt - 0.005), (x0 + 0.2, belt), (gx0, belt), (gx1, cowl_z), (x1 - 0.08, hood_z + 0.02), (x1, hood_z)),
        top=C((x0, belt - 0.015), (x0 + 0.06, belt + 0.003), (x0 + 0.2, belt + 0.005), (gx0, belt + 0.005), (gx1, cowl_z + crown * 0.5),
              ((gx1 + x1) / 2, (cowl_z + hood_z) / 2 + crown), (x1 - 0.08, hood_z + 0.02 + crown * 0.6), (x1, hood_z + 0.01)),
        width=C((x0, W / 2 - 0.015), (gx0, W / 2), (gx1, W / 2), (x1, W / 2 - 0.02)),
        tuck=const(0.035), tumble=const(c.get('tumble', 0.03)), cfrac=const(c.get('cfrac', 0.6)),
        rb=const(0.04), rs=const(c.get('rs', 0.035)),
        front=c['front_end'], rear=(0.07, 4.0),
        flares=c.get('flares', []),
        open=[bed, (gx0 + 0.06, gx1 - 0.14, c['cabfloor'])],
        lip=0.05,
        keys=[bed[1] + 0.02, bed[1] + 0.06, gx0, gx1, x0 + 0.1, x0 + 0.16, x0 + 0.26, x1 - 0.16, x1 - 0.3],
        bl_base=gx0, ws_base=gx1, inset=0.03, glass=False,
        driver_y=c['dy'], hip_f=c['hip'], benches=[c['bench']], seats=4,
        dash=c['dash'], wheel_c=c['wheel_c'], wheel_tilt=c.get('wheel_tilt', 0.45),
        height=c['height'], cfg=c,
    )

    def hull_region(i, hull):
        seg, x, cc = i['seg'], i['x'], i['c']
        if seg == 'in' and x < bed[1] + 0.02:
            return c.get('bed_floor', 'metal') if cc.z < bed[2] + 0.012 else 'paint'
        if seg == 'top' and gx0 + 0.01 < x < gx1 - 0.01 and abs(cc.y) < hull.edge_y(x) - 0.04:
            return 'interior'
        return None

    p['hull_region'] = hull_region
    p['decor'] = crew_decor
    return p


def crew_decor(o, res, pr, prg_unused, hull, p):
    c = p['cfg']
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    gx0, gx1 = p['bl_base'], p['ws_base']
    hw = p['W'] / 2
    ax, rail, roof, cowl_z = c['a_x'], c['rail'], c['roof'], c['cowl_z']
    rail_c = C((gx0, rail), (ax - 0.1, rail + 0.003), (ax, rail - 0.02), ((ax + gx1) / 2, (rail + cowl_z) / 2), (gx1, cowl_z - 0.005))
    roof_c = C((gx0, roof - 0.015), (gx0 + 0.4, roof), (ax - 0.12, roof - 0.005), (ax, roof - 0.035), ((ax + gx1) / 2, (roof + cowl_z) / 2 - 0.01), (gx1, cowl_z + 0.01))
    rg = c['door_r'] + 0.1
    bp = c['b_pillar']
    reg = cab_region((rg, ax + 0.02), [bp], ax - 0.03, back_th=0.5, frame='gloss', pillar='paint', mid_pillar='gloss',
                     front_pillar='gloss', back_k=2)
    am = (ax + gx1) / 2
    cab = Cab(hull, gx0, gx1, C((gx0, hw - 0.14), (ax, hw - 0.135), (gx1, hw - 0.1)), rail_c, roof_c, corner=const(0.05),
              inset=const(0.03), lines=[(rg, rg), (bp[0], bp[0]), (bp[1], bp[1]), ((bp[1] + ax) / 2, (bp[1] + ax) / 2 - 0.03),
                                        (ax + 0.1, ax), (am + 0.06, am)],
              rear=(0.13, 2.4), region=reg, side_s=(0.0, 0.08, 0.27), taper=True, between=1)
    o.body.extend(cab.build(res, shell=bool(res)))

    c['front'](o, res, pr, p)
    cowl(o, res, pr, gx1 - 0.03, hw - 0.17, roof_c)

    # ---- sides.
    belt, zb = c['belt'], c['zb']
    zd = zb + 0.07
    bmid = (bp[0] + bp[1]) / 2
    if res:
        gaps(o, pr, [
            [(c['door_f'], belt - 0.01), (c['door_f'] + 0.01, (belt + zd) / 2), (c['door_f'], zd)],
            [(bmid, belt), (bmid, zd)],
            [(c['door_f'], zd), (c['door_r'], zd)],
            [(c['door_r'], belt), (c['door_r'], zd)],
            [(c['bed'][1] + 0.04, belt), (c['bed'][1] + 0.04, zb + 0.1)],
        ])
        line(o, pr, 'top', [(c['bed'][1] + 0.04, -hw), (c['bed'][1] + 0.04, hw)], 0.008, 'gap', 0.002)
        for x in (bmid - 0.25, c['door_r'] + 0.17):
            handle(o, pr, x, belt - 0.09, c.get('handle', 'chrome'), 0.15, 0.032)
        lamp(o, pr, 'side', rrect_pts((x0 + 0.2, belt - 0.12), 0.08, 0.04, 0.01, 1), 'tail', res, None, 0.003, 0.005)
    # Big mirrors on the doors.
    mr = c.get('mirror_region', 'black')
    for s in (1, -1):
        mx, my, mz = gx1 - 0.18, s * (hw + 0.14), belt + 0.13
        o.body.extend(rbox((mx, my, mz), (0.06, 0.11, 0.12), 0.04, mr, 2 if res else 1))
        if res:
            o.body.extend(box((mx - 0.062, my, mz), (0.002, 0.09, 0.1), 'mirror'))
            o.body.extend(rbox((mx + 0.02, s * (hw + 0.03), belt + 0.06), (0.06, 0.04, 0.03), 0.015, 'black', 1))
    side_board(o, xr + R + 0.12, xf - R - 0.12, hw - 0.02, zb - 0.1, 0.17, c.get('step_region', 'black'), res)

    # ---- rear: tailgate, tail lamps on the corner posts, step bumper with the plate.
    tw = hw - 0.16
    if res:
        gaps(o, pr, [[(-tw, belt - 0.005), (-tw, c['tail_bot']), (tw, c['tail_bot']), (tw, belt - 0.005)]], frame='rear', both=False)
        flat(o, pr, 'rear', rrect_pts((0.0, belt - 0.09), 0.24, 0.05, 0.015, 2), 'chrome' if c.get('chrome_tg', True) else 'gloss', 0.006,
             bezel=(0.008, 'gap', 0.003), res=res)
    tz = c['tail_z']
    for s in (1, -1):
        lamp(o, pr, 'rear', rrect_pts((s * (hw - 0.105), tz), 0.065, c['tail_h'], 0.015, 2), 'tail', res, 'gloss', 0.006, 0.007, both=False, bw=0.008)
        if res:
            lamp(o, pr, 'rear', rrect_pts((s * (hw - 0.105), tz - c['tail_h'] * 0.32), 0.045, 0.07, 0.01, 1), 'white', res, None, 0.002, 0.016, both=False)
    rb_ = bumper(x0 - 0.06, c['rbump_z'], hw - 0.06, c['rbump_h'], 0.09, 0.05, -1, c.get('rbump_region', 'chrome'), res, back=0.14)
    o.body.extend(rb_)
    plate(o, Projector(rb_), 'rear', (0.0, c['rbump_z']), 0.3, min(0.15, c['rbump_h'] - 0.04))
    o.body.extend(cyl((xr - 0.5, -0.72, zb - 0.06), (xr - 0.95, -0.74, zb - 0.06), 0.04, 'chrome', 8 if res else 5))

    # ---- the bed: ribbed floor, wheel housings.
    bx0, bx1, bfl = c['bed']
    if res:
        for k in range(9):
            y = -(hw - 0.37) + k * (hw - 0.37) / 4
            o.body.extend(box(((bx0 + bx1) / 2, y, bfl + 0.006), ((bx1 - bx0) / 2 - 0.02, 0.022, 0.008), c.get('bed_floor', 'metal')))
    for s in (1, -1):
        o.body.extend(rbox((xr, s * (hw - 0.2), bfl + 0.1), (R + 0.08, 0.17, 0.11), 0.05, 'paint', 2 if res else 1))
    if c.get('extra'):
        c['extra'](o, res, pr, p)


def f150_front(o, res, pr, p):
    x1 = p['L'] / 2
    # The big squared grille: a chrome frame, two heavy chrome bars.
    gz = 1.0
    flat(o, pr, 'front', rrect_pts((0.0, gz), 1.25, 0.5, 0.04, 2), 'chrome' if res else 'grille', 0.006, res=res, rings=1)
    if res:
        flat(o, pr, 'front', rrect_pts((0.0, gz), 1.12, 0.39, 0.025, 2), 'grille', 0.011, res=res, rings=1)
        for z in (gz - 0.07, gz + 0.07):
            flat(o, pr, 'front', rrect_pts((0.0, z), 1.12, 0.06, 0.015, 1), 'chrome', 0.018, res=res, rings=1)
        for y in (-0.37, -0.185, 0.0, 0.185, 0.37):
            line(o, pr, 'front', [(y, gz - 0.19), (y, gz + 0.19)], 0.012, 'gloss', 0.014)
    # Headlamps in the corners with the C-clamp light signature, open towards the grille.
    for s in (1, -1):
        lamp(o, pr, 'front', rrect_pts((s * 0.81, 1.07), 0.3, 0.2, 0.03, 2), 'head', res, 'gloss', 0.006, 0.008, both=False, bw=0.012)
        if res:
            line(o, pr, 'front', [(s * 0.68, 1.155), (s * 0.94, 1.155), (s * 0.94, 0.985), (s * 0.68, 0.985)], 0.022, 'white', 0.02)
            lamp(o, pr, 'front', circle_pts((s * 0.77, 1.07), 0.045, 12), 'chrome', res, 'gloss', 0.004, 0.022, both=False, bw=0.006, rings=2)
    # A chunky chrome bumper with fog lamps and the plate, a black air dam under it.
    fb = bumper(x1 + 0.07, 0.68, 0.95, 0.3, 0.13, 0.09, 1, 'chrome', res, back=0.2)
    o.body.extend(fb)
    pf = Projector(fb)
    if res:
        plate(o, pf, 'front', (0.0, 0.68), 0.3, 0.15)
        for s in (1, -1):
            lamp(o, pf, 'front', rrect_pts((s * 0.62, 0.66), 0.14, 0.07, 0.02, 2), 'head', res, 'gloss', 0.004, 0.006, both=False, bw=0.01)
        line(o, pr, 'front', [(-0.85, 1.27), (0.85, 1.27)], 0.006, 'gap', 0.002)
        gaps(o, pr, [[(p['ws_base'] + 0.08, 0.9), (x1 - 0.03, 0.9)]], frame='top')
    o.body.extend(rbox((x1 - 0.02, 0, 0.47), (0.06, 0.85, 0.05), 0.02, 'black', 1))


@car
def f150(res):
    c = dict(
        L=5.8, W=2.03, xf=1.92, xr=-1.76, R=0.415, tyre_w=0.275, track=1.74, rim='multi', spokes=6, rim_ratio=0.66,
        color=0x2a4a8a, zb=0.5, belt=1.36, cowl_z=1.36, hood_z=1.27, crown=0.04,
        gx0=-1.05, gx1=1.15, a_x=0.45, rail=1.9, roof=1.96, bed=(-2.78, -1.13, 0.9), cabfloor=0.62,
        door_f=1.12, b_pillar=(-0.07, 0.05), door_r=-0.98, front_end=(0.15, 3.0),
        hip=(0.08, 1.05), dy=0.42, bench=(-0.72, 1.5, 1.07), dash=(1.0, 0.6, 0.9, 0.95, 1.36), wheel_c=(0.5, 1.3),
        height=1.96, front=f150_front, tail_z=1.13, tail_h=0.36, tail_bot=0.74, rbump_z=0.64, rbump_h=0.22,
    )
    o = closed_car(res, crew_params(c))
    o.meta['dims'][0] = 5.89
    return o
