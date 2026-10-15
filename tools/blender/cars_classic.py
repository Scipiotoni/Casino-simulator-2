"""
Big saloons, grand tourers and classics: the Crown Victor (a long body-on-frame V8 saloon),
the Regal Phantasm (a stately limousine with a temple grille), the Bel Aire '57 (a two-tone
'50s hardtop with fins), the Crewe Continent GT (a British grand tourer), the Coventry E-Type
(the long-bonnet '60s coupe) and the DeLuna DMC (the brushed-steel gull-wing wedge).
"""
import math

from mathutils import Matrix, Vector

from carkit import C, const, rbox, box, cyl, tube, torus, rrect_pts, circle_pts, ccw
from carbody import aim, patch, strip, project
import carparts as P
from carcommon import car, closed_car, lamp, flat, line, gaps, handle, plate, rounded, arch_pts, along


# ------------------------------------------------------------------ shared bits

def body_gaps(o, pr, p, doors, sill_z, arch_r=None):
    """
    Door shut lines: doors = list of (front edge [(x, z)...] top to bottom) plus the last door's
    rear edge running round the rear arch; a sill line joins them.
    """
    xr, R = p['xr'], p.get('R_rear', p['R'])
    ar = arch_r or R + p['arch_gap'] + 0.05
    lines = []
    for edge in doors[:-1]:
        lines.append(edge)
    rear = doors[-1]
    lines.append(rear + arch_pts(xr, R, ar, 62, 4, 6) + [(xr + ar, sill_z)])
    lines.append([(doors[0][-1][0], sill_z), (xr + ar, sill_z)])
    gaps(o, pr, lines)


def oval(c, rx, rz, n=14):
    return [(c[0] + rx * math.cos(2 * math.pi * k / n), c[1] + rz * math.sin(2 * math.pi * k / n)) for k in range(n)]


def surface_tube(o, pr, frame, pts, r, region, off, seg=8):
    """A rod following the body at `off` from the surface, through 2D points in a frame (slim bumpers)."""
    path = [project(pr, frame, s, t, off) for (s, t) in pts]
    path = [q for q in path if q is not None]
    if len(path) > 1:
        o.body.extend(tube(path, r, region, seg))


def wipers(o, p, cx, pairs):
    for (a, b) in pairs:
        o.body.extend(tube([Vector((cx - 0.03, a, p['roof_z'](cx - 0.03) + 0.01)), Vector((cx - 0.075, b, p['roof_z'](cx - 0.075) + 0.012))], 0.007, 'black', 4))


# ------------------------------------------------------------------ Crown Victor

def crownvic_params():
    L, W = 5.39, 1.98
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.675, -1.238
    R = 0.34
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.225, track=1.62, arch_gap=0.055, rim='slot', spokes=5, color=0x23324a,
        bottom=C((x0, 0.42), (x0 + 0.1, 0.34), (x0 + 0.4, 0.27), (xr - 0.35, 0.21), (xr, 0.2), (xf, 0.2), (xf + 0.5, 0.23), (x1 - 0.1, 0.27), (x1, 0.32)),
        shoulder=C((x0, 0.93), (x0 + 0.04, 0.97), (x0 + 0.2, 0.982), (-1.6, 0.985), (0.0, 0.96), (1.2, 0.935), (x1 - 0.25, 0.9), (x1 - 0.05, 0.86), (x1, 0.8)),
        top=C((x0, 0.95), (x0 + 0.04, 0.99), (x0 + 0.2, 1.008), (-1.6, 1.015), (1.0, 0.975), (x1 - 0.25, 0.935), (x1 - 0.05, 0.89), (x1, 0.82)),
        width=C((x0, 0.95), (-1.6, 0.98), (1.4, 0.985), (x1, 0.955)),
        tuck=const(0.07), tumble=const(0.075), cfrac=const(0.72),
        rb=const(0.085), rs=C((x0, 0.05), (x0 + 0.3, 0.075), (1.2, 0.075), (x1 - 0.3, 0.06), (x1, 0.05)),
        front=(0.36, 3.0), rear=(0.3, 3.6),
        flares=[(xf, 0.55, 0.006, 0.62, 0.25), (xr, 0.6, 0.008, 0.64, 0.26)],
        open=[(-1.2, 0.97, 0.3)],
        bl_base=-1.56, ws_base=1.0, inset=0.03,
        roof_z=C((-1.56, 1.0), (-1.25, 1.2), (-0.95, 1.38), (-0.75, 1.43), (-0.3, 1.455), (0.15, 1.445), (0.45, 1.33), (0.75, 1.15), (1.0, 0.965)),
        rail_z=C((-1.56, 0.99), (-1.25, 1.17), (-0.95, 1.335), (-0.75, 1.38), (-0.3, 1.4), (0.15, 1.39), (0.45, 1.28), (0.75, 1.11), (1.0, 0.95)),
        rail_w=C((-1.56, 0.8), (-1.0, 0.765), (-0.3, 0.755), (0.3, 0.77), (1.0, 0.85)),
        corner=C((-1.0, 0.085), (0.1, 0.075), (0.6, 0.05)),
        lines=[(-1.22, -0.98), (-1.02, -0.84), (-0.07, -0.13), (0.03, -0.03), (0.22, 0.18)],
        driver_y=0.4, hip_f=(-0.02, 0.55), benches=[(-1.0, 1.42, 0.58)], seats=5, more_seats=[(-1.0, 0.0, 0.58)],
        dash=(0.98, 0.56, 0.8, 0.62, 0.95), wheel_c=(0.42, 0.88),
        mirror=(0.86, 0.9, 0.99),
    )

    def glass_region(i):
        seg, xb, xr_ = i['seg'], i['xb'], i['xr']
        if seg == 'side':
            if i['zone'] == 'front' or xb > 0.86:
                return 'black'
            if -0.07 < xb < 0.03:
                return 'gloss'
            if xb < -1.22:
                return 'paint'
            return 'glass'
        if seg == 'corner':
            return 'paint'
        if xr_ > 0.18 or xr_ < -0.84:
            return 'glass'
        return 'paint'

    p['glass_region'] = glass_region
    p['decor'] = crownvic_decor
    return p


def crownvic_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    # Big rectangular headlamps, the amber corner lamp wrapping round the side.
    head = rounded([(0.44, 0.61), (0.8, 0.615), (0.86, 0.64), (0.86, 0.765), (0.8, 0.78), (0.44, 0.775)], 1)
    lamp(o, pr, 'front', head, 'head', res, 'chrome', 0.006, 0.006, bw=0.014)
    if res:
        lamp(o, pr, 'front', rounded(rrect_pts((0.56, 0.695), 0.17, 0.12, 0.03, 2), 1), 'chrome', res, None, 0.003, 0.012, rings=2)
        lamp(o, pr, 'front', circle_pts((0.56, 0.695), 0.045, 12), 'head', res, None, 0.01, 0.016, rings=2)
    lamp(o, pr, 'front', rounded([(0.77, 0.63), (0.845, 0.645), (0.845, 0.755), (0.77, 0.765)], 1), 'amber', res, None, 0.003, 0.012, rings=2)
    # The chrome-ringed grille between them: a wide rounded oblong with fine bars.
    gr = rounded([(-0.36, 0.585), (0.36, 0.585), (0.4, 0.64), (0.38, 0.745), (0.0, 0.765), (-0.38, 0.745), (-0.4, 0.64)], 2)
    flat(o, pr, 'front', gr, 'grille', 0.006, bezel=(0.026, 'chrome', 0.012), res=res)
    if res:
        for z in (0.615, 0.645, 0.675, 0.705, 0.735):
            line(o, pr, 'front', [(-0.37, z), (0.37, z)], 0.008, 'chrome', 0.01)
        lamp(o, pr, 'front', oval((0.0, 0.675), 0.07, 0.04), 'chrome', res, None, 0.004, 0.016, rings=2)
    # Bumper: body colour with a black rubbing strip; the plate in its middle; a black air dam.
    line(o, pr, 'front', [(-0.86, 0.5), (0.86, 0.5)], 0.06, 'black', 0.006)
    if res:
        line(o, pr, 'front', [(-0.86, 0.5), (0.86, 0.5)], 0.01, 'chrome', 0.009)
    plate(o, pr, 'front', (0.0, 0.41))
    line(o, pr, 'front', [(-0.8, 0.3), (0.8, 0.3)], 0.05, 'black', 0.003)
    flat(o, pr, 'front', rounded([(-0.45, 0.33), (-0.25, 0.33), (-0.25, 0.37), (-0.45, 0.37)], 1), 'grille', 0.004, both=True, res=res)

    # Tail: lamps on the corners and a red reflector panel joining them across the boot lid.
    tl = rounded([(0.5, 0.71), (0.84, 0.71), (0.87, 0.74), (0.87, 0.89), (0.5, 0.9)], 1)
    lamp(o, pr, 'rear', tl, 'tail', res, 'chrome', 0.006, 0.006, bw=0.012)
    if res:
        lamp(o, pr, 'rear', rounded(rrect_pts((0.58, 0.805), 0.1, 0.07, 0.01, 1), 1), 'white', res, None, 0.002, 0.012, rings=1)
        line(o, pr, 'rear', [(0.68, 0.76), (0.85, 0.76)], 0.01, 'amber', 0.012, both=True)
    flat(o, pr, 'rear', [(-0.48, 0.75), (0.48, 0.75), (0.48, 0.87), (-0.48, 0.87)], 'red', 0.005, bezel=(0.012, 'chrome', 0.004), res=res)
    if res:
        line(o, pr, 'rear', [(-0.86, 0.69), (0.86, 0.69)], 0.012, 'chrome', 0.004)
    line(o, pr, 'rear', [(-0.88, 0.5), (0.88, 0.5)], 0.06, 'black', 0.006)
    plate(o, pr, 'rear', (0.0, 0.6))
    if res:
        o.body.extend(cyl((x0 + 0.1, -0.55, 0.33), (x0 - 0.03, -0.55, 0.33), 0.03, 'chrome', 10))
        o.body.extend(cyl((x0 + 0.05, 0.55, 0.33), (x0 - 0.03, 0.55, 0.33), 0.03, 'chrome', 10))

    if res:
        body_gaps(o, pr, p, [
            [(1.0, 0.95), (1.03, 0.75), (1.06, 0.5), (1.07, 0.36)],
            [(-0.04, 0.97), (-0.04, 0.36)],
            [(-1.12, 0.98), (-1.15, 0.78)],
        ], 0.36)
        gaps(o, pr, [[(1.02, 0.8), (2.1, 0.8), (2.5, 0.76), (2.62, 0.6)]], frame='top')
        gaps(o, pr, [[(2.62, -0.6), (2.62, 0.6)]], frame='top', both=False)
        gaps(o, pr, [[(-1.62, 0.82), (-2.62, 0.8)]], frame='top')
        gaps(o, pr, [[(-0.47, 0.95), (-0.47, 0.67), (0.47, 0.67), (0.47, 0.95)]], frame='rear', both=False)
        line(o, pr, 'side', rounded(rrect_pts((-1.95, 0.86), 0.16, 0.12, 0.03, 2), 1), 0.006, 'gap', 0.0015, closed=True)
        for (x, z) in ((0.42, 0.86), (-0.68, 0.87)):
            handle(o, pr, x, z, 'chrome')
        # Wide black bodyside mouldings along the doors and wings.
        line(o, pr, 'side', [(xf - R - 0.2, 0.6), (xr + R + 0.2, 0.6)], 0.045, 'black', 0.005, both=True)
        line(o, pr, 'side', [(x1 - 0.25, 0.6), (xf + R + 0.12, 0.6)], 0.045, 'black', 0.005, both=True)
        line(o, pr, 'side', [(xr - R - 0.12, 0.6), (x0 + 0.3, 0.6)], 0.045, 'black', 0.005, both=True)
        # Black window frames.
        line(o, prg, 'side', along(p['shoulder'], 0.9, -1.2, 12, -0.002), 0.02, 'black', 0.004, both=True)
    cx = p['ws_base'] - 0.035
    line(o, pr, 'top', [(cx, -0.8), (cx, 0.8)], 0.08, 'black', 0.003)
    if res:
        wipers(o, p, cx, ((0.55, -0.05), (-0.02, -0.62)))


@car
def crownvic(res):
    return closed_car(res, crownvic_params())


# ------------------------------------------------------------------ Regal Phantasm

def phantom_params():
    L, W = 5.76, 2.02
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.93, -1.62
    R = 0.38
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.255, track=1.68, arch_gap=0.05, rim='multi', spokes=7, color=0x2a1a3a,
        bottom=C((x0, 0.45), (x0 + 0.1, 0.36), (x0 + 0.4, 0.29), (xr - 0.4, 0.22), (xr, 0.21), (xf, 0.21), (xf + 0.4, 0.24), (x1 - 0.1, 0.28), (x1, 0.33)),
        shoulder=C((x0, 1.02), (x0 + 0.05, 1.07), (x0 + 0.25, 1.09), (-1.8, 1.1), (0.0, 1.095), (1.0, 1.085), (x1 - 0.2, 1.065), (x1 - 0.04, 1.05), (x1, 1.02)),
        top=C((x0, 1.04), (x0 + 0.05, 1.09), (x0 + 0.25, 1.115), (-1.8, 1.125), (1.0, 1.13), (x1 - 0.2, 1.1), (x1 - 0.04, 1.085), (x1, 1.055)),
        width=C((x0, 0.97), (-1.6, 1.0), (1.4, 1.005), (x1, 0.975)),
        tuck=const(0.06), tumble=const(0.05), cfrac=const(0.62),
        rb=const(0.08), rs=const(0.045),
        front=(0.2, 4.5), rear=(0.3, 3.4),
        flares=[(xf, 0.6, 0.006, 0.66, 0.26), (xr, 0.6, 0.008, 0.68, 0.26)],
        open=[(-1.52, 0.83, 0.36)],
        bl_base=-1.92, ws_base=0.86, inset=0.03,
        roof_z=C((-1.92, 1.12), (-1.72, 1.33), (-1.48, 1.55), (-1.2, 1.63), (-0.5, 1.65), (0.05, 1.635), (0.3, 1.53), (0.6, 1.31), (0.86, 1.135)),
        rail_z=C((-1.92, 1.11), (-1.72, 1.3), (-1.48, 1.5), (-1.2, 1.575), (-0.5, 1.595), (0.05, 1.58), (0.3, 1.48), (0.6, 1.27), (0.86, 1.12)),
        rail_w=C((-1.92, 0.84), (-1.2, 0.82), (0.0, 0.82), (0.86, 0.9)),
        corner=C((-1.2, 0.07), (0.1, 0.07), (0.6, 0.05)),
        lines=[(-1.62, -1.4), (-1.44, -1.2), (-0.34, -0.4), (-0.22, -0.28), (0.1, 0.06)],
        driver_y=0.43, hip_f=(-0.12, 0.66), benches=[(-1.22, 1.45, 0.68)], seats=4,
        dash=(0.86, 0.45, 0.84, 0.72, 1.1), wheel_c=(0.34, 1.0),
        mirror=(0.74, 0.92, 1.13), mirror_region='paint2',
    )

    def glass_region(i):
        seg, xb, xr_ = i['seg'], i['xb'], i['xr']
        if seg == 'side':
            if i['zone'] == 'front' or xb > 0.74:
                return 'black'
            if -0.34 < xb < -0.22:
                return 'gloss'
            if xb < -1.44:
                return 'paint2'
            return 'glass'
        if seg == 'corner':
            return 'paint2'
        if xr_ > 0.06 or xr_ < -1.4:
            return 'glass'
        return 'paint2'

    def hull_region(i, hull):
        # Two-tone: the bonnet, the shoulders and the boot lid dark, the sides in the car's colour.
        if i['seg'] in ('sh', 'top', 'lip'):
            return 'paint2'
        return None

    p['glass_region'] = glass_region
    p['hull_region'] = hull_region
    p['decor'] = phantom_decor
    return p


def phantom_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    # The temple grille: a tall chrome frame standing proud of the nose, vertical vanes inside.
    gz, gh, gw = 0.83, 0.23, 0.32
    o.body.extend(rbox((x1 - 0.02, 0, gz), (0.075, gw + 0.035, gh + 0.03), 0.018, 'chrome', 2 if res else 1))
    o.body.extend(box((x1 + 0.052, 0, gz), (0.004, gw, gh), 'grille'))
    if res:
        n = 13
        for k in range(-n, n + 1):
            o.body.extend(box((x1 + 0.058, k * gw / (n + 0.5), gz), (0.008, 0.0045, gh), 'chrome'))
        o.body.extend(rbox((x1 + 0.01, 0, gz + gh + 0.035), (0.065, gw + 0.045, 0.012), 0.008, 'chrome', 1))
    # Slim rectangular headlamps high up beside the grille, a light strip under each.
    head = rounded([(0.42, 0.9), (0.86, 0.905), (0.9, 0.93), (0.9, 0.99), (0.42, 0.99)], 1)
    lamp(o, pr, 'front', head, 'head', res, 'gloss', 0.006, 0.006, bw=0.012)
    if res:
        for s in (0.52, 0.66, 0.8):
            lamp(o, pr, 'front', circle_pts((s, 0.948), 0.028, 10), 'chrome', res, None, 0.004, 0.014, rings=2)
        line(o, pr, 'front', [(0.43, 0.885), (0.86, 0.885)], 0.012, 'white', 0.012, both=True)
    # The bumper: a wide lower intake with chrome bars, side intakes, the plate under the grille.
    low = rounded([(-0.62, 0.35), (0.62, 0.35), (0.66, 0.48), (-0.66, 0.48)], 1)
    flat(o, pr, 'front', low, 'grille', 0.004, bezel=(0.02, 'chrome', 0.006), res=res)
    if res:
        for z in (0.39, 0.43):
            line(o, pr, 'front', [(-0.6, z), (0.6, z)], 0.01, 'chrome', 0.008)
    flat(o, pr, 'front', rrect_pts((0.79, 0.44), 0.14, 0.11, 0.02, 2), 'grille', 0.004, both=True, bezel=(0.012, 'chrome', 0.004), res=res)
    plate(o, pr, 'front', (0.0, 0.53), lift=0.012)
    line(o, pr, 'front', [(-0.8, 0.31), (0.8, 0.31)], 0.03, 'black', 0.003)

    # Tall rectangular tail lamps on the corners, chrome across the boot, the plate between.
    tl = rrect_pts((0.76, 0.92), 0.27, 0.23, 0.025, 2)
    lamp(o, pr, 'rear', tl, 'tail', res, 'chrome', 0.006, 0.006, bw=0.012)
    if res:
        lamp(o, pr, 'rear', rounded(rrect_pts((0.76, 0.86), 0.2, 0.05, 0.01, 1), 1), 'white', res, None, 0.002, 0.012, rings=1)
        lamp(o, pr, 'rear', rounded(rrect_pts((0.76, 0.98), 0.18, 0.06, 0.02, 1), 1), 'red', res, None, 0.002, 0.012, rings=1)
        line(o, pr, 'rear', [(-0.6, 0.97), (0.6, 0.97)], 0.02, 'chrome', 0.005)
    plate(o, pr, 'rear', (0.0, 0.84))
    line(o, pr, 'rear', [(-0.86, 0.52), (0.86, 0.52)], 0.025, 'chrome', 0.005)
    line(o, pr, 'rear', [(-0.8, 0.36), (0.8, 0.36)], 0.06, 'black', 0.003)
    if res:
        for s in (1, -1):
            o.body.extend(rbox((x0 + 0.05, s * 0.55, 0.38), (0.05, 0.1, 0.03), 0.02, 'chrome', 1))
            o.body.extend(rbox((x0 + 0.02, s * 0.55, 0.38), (0.03, 0.085, 0.02), 0.012, 'gap', 1))

    if res:
        # Front door hinged at the front, the coach door behind it hinged at the back: the
        # handles meet at the B-pillar.
        body_gaps(o, pr, p, [
            [(0.86, 1.1), (0.9, 0.85), (0.95, 0.55), (0.96, 0.4)],
            [(-0.3, 1.1), (-0.3, 0.4)],
            [(-1.52, 1.1), (-1.55, 0.9)],
        ], 0.4)
        for (x, z) in ((-0.12, 0.98), (-0.48, 0.98)):
            handle(o, pr, x, z, 'chrome', w=0.15)
        gaps(o, pr, [[(0.9, 0.86), (2.4, 0.86), (2.78, 0.82)]], frame='top')
        gaps(o, pr, [[(2.79, -0.82), (2.79, 0.82)]], frame='top', both=False)
        gaps(o, pr, [[(-1.96, 0.82), (-2.75, 0.8)]], frame='top')
        gaps(o, pr, [[(-0.58, 1.08), (-0.58, 0.72), (0.58, 0.72), (0.58, 1.08)]], frame='rear', both=False)
        # The coachline along the waist, chrome round the windows, a chrome sill strip.
        line(o, pr, 'side', along(p['shoulder'], x1 - 0.15, x0 + 0.15, 24, -0.07), 0.008, 'white', 0.003, both=True)
        line(o, prg, 'side', along(p['shoulder'], 0.78, -1.5, 16, -0.002), 0.02, 'chrome', 0.004, both=True)
        line(o, pr, 'side', [(xf - R - 0.15, 0.42), (xr + R + 0.15, 0.42)], 0.03, 'chrome', 0.004, both=True)
    cx = p['ws_base'] - 0.035
    line(o, pr, 'top', [(cx, -0.84), (cx, 0.84)], 0.08, 'black', 0.003)
    if res:
        wipers(o, p, cx, ((0.58, -0.05), (-0.02, -0.66)))


@car
def phantom(res):
    return closed_car(res, phantom_params())


# ------------------------------------------------------------------ Bel Aire '57

def belair_params():
    L, W = 5.0, 1.96
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.6, -1.32
    R = 0.36
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.2, track=1.56, arch_gap=0.05, rim='fullcap', tyre='wall', rim_ratio=0.58, color=0x4fd0c8,
        bottom=C((x0, 0.42), (x0 + 0.12, 0.34), (x0 + 0.45, 0.27), (xr - 0.4, 0.22), (xr, 0.21), (xf, 0.21), (xf + 0.4, 0.24), (x1 - 0.12, 0.29), (x1, 0.34)),
        shoulder=C((x0, 0.93), (x0 + 0.04, 1.0), (x0 + 0.12, 1.02), (-1.6, 0.97), (-1.0, 0.92), (-0.3, 0.9), (0.6, 0.895), (1.6, 0.9), (x1 - 0.15, 0.9), (x1 - 0.04, 0.87), (x1, 0.8)),
        top=C((x0, 0.86), (x0 + 0.04, 0.9), (x0 + 0.12, 0.915), (-1.6, 0.93), (-1.0, 0.93), (1.0, 0.9), (1.8, 0.88), (x1 - 0.15, 0.865), (x1 - 0.04, 0.84), (x1, 0.78)),
        width=C((x0, 0.92), (-1.5, 0.96), (0.0, 0.975), (1.5, 0.97), (x1, 0.95)),
        tuck=const(0.08), tumble=const(0.06), cfrac=const(0.7),
        rb=const(0.08), rs=C((x0, 0.03), (x0 + 0.4, 0.035), (0.0, 0.06), (x1, 0.04)),
        front=(0.3, 3.5), rear=(0.25, 4.0), arch_flat=0.3,
        open=[(-1.05, 0.95, 0.3)],
        bl_base=-1.3, ws_base=0.98, inset=0.03,
        roof_z=C((-1.3, 0.95), (-1.1, 1.18), (-0.9, 1.35), (-0.65, 1.44), (-0.2, 1.47), (0.4, 1.46), (0.62, 1.42), (0.8, 1.26), (0.98, 0.93)),
        rail_z=C((-1.3, 0.94), (-1.1, 1.15), (-0.9, 1.31), (-0.65, 1.4), (-0.2, 1.425), (0.4, 1.415), (0.62, 1.38), (0.8, 1.22), (0.98, 0.92)),
        rail_w=C((-1.3, 0.76), (-0.8, 0.73), (0.0, 0.73), (0.6, 0.75), (0.98, 0.82)),
        corner=C((-1.0, 0.07), (0.1, 0.06), (0.6, 0.04)),
        gh_front=(0.28, 2.4), gh_rear=(0.25, 2.4),
        lines=[(-1.0, -0.86), (-0.82, -0.62), (-0.25, -0.23), (-0.21, -0.19), (0.6, 0.5), (0.66, 0.56)],
        driver_y=0.4, hip_f=(-0.05, 0.52), benches=[(-0.85, 1.35, 0.55)], seats=5, more_seats=[(-0.85, 0.0, 0.55)],
        dash=(0.95, 0.6, 0.8, 0.62, 0.9), wheel_c=(0.4, 0.84), wheel_r=0.21,
        mirror=(0.72, 0.88, 0.93), mirror_region='chrome',
    )

    def glass_region(i):
        seg, xb, xr_ = i['seg'], i['xb'], i['xr']
        if seg == 'side':
            if i['zone'] in ('front', 'rear') or xb > 0.66 or xb < -1.0:
                return 'glass'
            if 0.6 < xb < 0.66 or -0.25 < xb < -0.21:
                return 'chrome'
            if xb < -0.82:
                return 'white'
            return 'glass'
        if xr_ > 0.56 or xr_ < -0.8 or i['zone'] in ('front', 'rear'):
            return 'glass'
        return 'white'

    p['glass_region'] = glass_region
    p['decor'] = belair_decor
    return p


def belair_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    # Hooded round headlamps out at the wing tips.
    for (c, r) in (((0.74, 0.77), 0.085),):
        lamp(o, pr, 'front', circle_pts(c, r, 16), 'head', res, 'chrome', 0.012, 0.008, bw=0.03)
        if res:
            lamp(o, pr, 'front', circle_pts(c, r * 0.3, 10), 'chrome', res, None, 0.004, 0.024, rings=1)
            # The hood over it: a painted brow.
            o.body.extend(rbox((x1 - 0.06, c[0], c[1] + r + 0.025), (0.08, r + 0.03, 0.025), 0.02, 'paint', 1).both())
    # The full-width chrome grille: a mesh with a bar across, round parking lamps at its ends.
    gr = rounded([(-0.66, 0.47), (0.66, 0.47), (0.7, 0.55), (0.66, 0.68), (-0.66, 0.68), (-0.7, 0.55)], 2)
    flat(o, pr, 'front', gr, 'grille', 0.004, bezel=(0.03, 'chrome', 0.012), res=res)
    if res:
        line(o, pr, 'front', [(-0.66, 0.6), (0.66, 0.6)], 0.022, 'chrome', 0.014)
        for k in range(-11, 12):
            line(o, pr, 'front', [(k * 0.056, 0.49), (k * 0.056, 0.66)], 0.006, 'chrome', 0.008)
        lamp(o, pr, 'front', circle_pts((0.6, 0.6), 0.04, 12), 'amber', res, 'chrome', 0.01, 0.02, bw=0.012)
    # The bumper: a heavy chrome blade with bullet guards ('Dagmars') standing out of it.
    o.body.extend(P.blade_bumper(x1 + 0.02, 0.4, 0.98, 0.13, 0.11, 0.2, 'chrome', 1, res))
    for s in (1, -1):
        o.body.extend(cyl((x1 - 0.02, s * 0.44, 0.53), (x1 + 0.13, s * 0.44, 0.53), 0.065, 'chrome', 14 if res else 6, r1=0.022))
    plate(o, pr, 'front', (0.0, 0.4), lift=0.07)
    # Bonnet: the twin chrome windsplits.
    if res:
        line(o, pr, 'top', [(1.1, 0.3), (2.3, 0.27)], 0.016, 'chrome', 0.008, both=True)

    # Fins: chrome along their tops, the round tail lamps low in their chrome ends.
    if res:
        line(o, pr, 'side', along(p['shoulder'], -0.9, x0 + 0.02, 14, -0.012), 0.014, 'chrome', 0.004, both=True)
    fin = rounded(rrect_pts((0.82, 0.9), 0.15, 0.22, 0.04, 2), 1)
    flat(o, pr, 'rear', fin, 'chrome', 0.006, both=True, res=res)
    lamp(o, pr, 'rear', circle_pts((0.82, 0.86), 0.055, 14), 'tail', res, 'chrome', 0.012, 0.012, bw=0.012)
    if res:
        lamp(o, pr, 'rear', circle_pts((0.82, 0.96), 0.03, 10), 'tail', res, None, 0.006, 0.012, rings=1)
    o.body.extend(P.blade_bumper(x0 - 0.02, 0.45, 0.97, 0.14, 0.11, 0.2, 'chrome', -1, res))
    for s in (1, -1):
        o.body.extend(rbox((x0 - 0.06, s * 0.5, 0.5), (0.05, 0.07, 0.07), 0.035, 'chrome', 2 if res else 1))
        if res:
            o.body.extend(cyl((x0 - 0.05, s * 0.5, 0.49), (x0 - 0.115, s * 0.5, 0.49), 0.03, 'gap', 10))
    plate(o, pr, 'rear', (0.0, 0.66))
    if res:
        lamp(o, pr, 'rear', rounded([(-0.2, 0.75), (0.2, 0.75), (0.0, 0.84)], 1), 'chrome', res, None, 0.004, 0.006, rings=1)

    # Side: the spear running back from the wing, forking on the door into the cove, the
    # cove filled with a white insert.
    cove = [(0.1, 0.795), (-0.4, 0.73), (-0.9, 0.64), (-1.0, 0.64)] + arch_pts(xr, R, R + 0.11, 40, 140, 6) + [(-1.85, 0.65), (x0 + 0.12, 0.66), (x0 + 0.1, 0.83), (-1.0, 0.82), (-0.4, 0.81)]
    flat(o, pr, 'side', cove, 'white', 0.003, both=True, res=res)
    if res:
        line(o, pr, 'side', [(x1 - 0.15, 0.79), (0.1, 0.8), (-0.4, 0.812), (-1.0, 0.825), (x0 + 0.1, 0.835)], 0.016, 'chrome', 0.006, both=True)
        line(o, pr, 'side', [(0.1, 0.795), (-0.4, 0.73), (-0.9, 0.64), (-1.0, 0.64)], 0.014, 'chrome', 0.006, both=True)
        line(o, pr, 'side', [(-1.85, 0.65), (x0 + 0.12, 0.66)], 0.014, 'chrome', 0.006, both=True)
        # Chrome along the beltline and the window frames, chrome rocker strip.
        line(o, prg, 'side', along(p['shoulder'], 0.95, -1.0, 14, -0.004), 0.018, 'chrome', 0.004, both=True)
        line(o, pr, 'side', [(xf - R - 0.12, 0.36), (xr + R + 0.12, 0.36)], 0.03, 'chrome', 0.004, both=True)
        gaps(o, pr, [
            [(0.97, 0.9), (1.0, 0.7), (1.03, 0.4)],
            [(-0.28, 0.9), (-0.28, 0.4)],
            [(1.03, 0.4), (-0.28, 0.4)],
        ])
        handle(o, pr, -0.16, 0.86, 'chrome')
        gaps(o, pr, [[(1.0, 0.76), (2.35, 0.74), (2.42, 0.4)]], frame='top')
        gaps(o, pr, [[(2.42, -0.4), (2.42, 0.4)]], frame='top', both=False)
        gaps(o, pr, [[(-1.36, 0.72), (-2.38, 0.7)]], frame='top')
        gaps(o, pr, [[(-2.38, -0.7), (-2.38, 0.7)]], frame='top', both=False)
    cx = p['ws_base'] - 0.035
    line(o, pr, 'top', [(cx, -0.78), (cx, 0.78)], 0.06, 'chrome', 0.003)
    if res:
        wipers(o, p, cx, ((0.5, 0.05), (-0.05, -0.55)))


@car
def belair(res):
    return closed_car(res, belair_params())


# ------------------------------------------------------------------ Crewe Continent GT

def bentley_params():
    L, W = 4.85, 1.95
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.475, -1.376
    R = 0.36
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.275, track=1.66, arch_gap=0.04, rim='multi', spokes=10, tyre='low', rim_ratio=0.72, color=0x0e3b2e,
        bottom=C((x0, 0.4), (x0 + 0.1, 0.32), (x0 + 0.4, 0.24), (xr - 0.3, 0.18), (xr, 0.17), (xf, 0.17), (xf + 0.45, 0.2), (x1 - 0.1, 0.24), (x1, 0.3)),
        shoulder=C((x0, 0.86), (x0 + 0.06, 0.93), (x0 + 0.3, 0.98), (-1.4, 1.0), (-0.6, 0.97), (0.6, 0.94), (1.5, 0.9), (x1 - 0.15, 0.83), (x1 - 0.03, 0.78), (x1, 0.73)),
        top=C((x0, 0.88), (x0 + 0.06, 0.95), (x0 + 0.3, 1.0), (-1.7, 1.02), (0.75, 0.96), (1.5, 0.925), (x1 - 0.15, 0.86), (x1 - 0.03, 0.8), (x1, 0.75)),
        width=C((x0, 0.9), (xr, 0.975), (-0.3, 0.95), (xf, 0.96), (x1, 0.92)),
        tuck=const(0.09), tumble=C((x0, 0.09), (0.0, 0.07), (x1, 0.07)), cfrac=const(0.68),
        rb=const(0.07), rs=const(0.06),
        front=(0.42, 2.8), rear=(0.38, 3.0),
        flares=[(xf, 0.55, 0.012, 0.62, 0.25), (xr, 0.8, 0.035, 0.74, 0.3)],
        open=[(-1.4, 0.72, 0.26)],
        bl_base=-1.78, ws_base=0.75, inset=0.03,
        roof_z=C((-1.78, 1.02), (-1.5, 1.13), (-1.2, 1.26), (-0.85, 1.36), (-0.45, 1.405), (-0.05, 1.39), (0.25, 1.3), (0.5, 1.13), (0.75, 0.95)),
        rail_z=C((-1.78, 1.01), (-1.5, 1.1), (-1.2, 1.22), (-0.85, 1.315), (-0.45, 1.355), (-0.05, 1.34), (0.25, 1.25), (0.5, 1.09), (0.75, 0.94)),
        rail_w=C((-1.78, 0.62), (-1.2, 0.68), (-0.4, 0.7), (0.3, 0.72), (0.75, 0.8)),
        corner=C((-1.0, 0.07), (0.1, 0.06), (0.6, 0.04)),
        gh_rear=(0.35, 2.4),
        lines=[(-1.25, -0.95), (-1.1, -0.85), (-0.44, -0.52), (-0.4, -0.48), (0.28, 0.22)],
        driver_y=0.38, hip_f=(-0.2, 0.45), benches=[(-1.05, 1.15, 0.5)], seats=4,
        dash=(0.75, 0.38, 0.78, 0.55, 0.88), wheel_c=(0.2, 0.8),
        mirror=(0.6, 0.86, 0.96),
    )

    def glass_region(i):
        seg, xb, xr_ = i['seg'], i['xb'], i['xr']
        if seg == 'side':
            if i['zone'] == 'front' or xb > 0.62:
                return 'black'
            if -0.44 < xb < -0.4:
                return 'chrome'
            if xb < -1.25:
                return 'paint'
            return 'glass'
        if seg == 'corner':
            return 'paint'
        if xr_ > 0.22 or xr_ < -0.85:
            return 'glass'
        return 'paint'

    p['glass_region'] = glass_region
    p['decor'] = bentley_decor
    return p


def bentley_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    # Twin round lamps each side, the outer one bigger, in one dark housing.
    hf = aim((x1 - 0.1, 0.62, 0.69), 0.45, 0.15)
    lamp(o, pr, hf, rounded([(-0.17, -0.07), (0.05, -0.1), (0.2, -0.08), (0.24, 0.0), (0.2, 0.08), (0.04, 0.09), (-0.16, 0.06), (-0.2, 0.0)], 2), 'gloss', res, 'chrome', 0.004, 0.005, bw=0.008)
    for (c, r) in (((0.11, -0.005), 0.085), ((-0.11, -0.01), 0.06)):
        lamp(o, pr, hf, circle_pts(c, r, 16), 'head', res, 'chrome', 0.012, 0.012, bw=0.012)
        if res:
            line(o, pr, hf, circle_pts(c, r * 0.62, 14), 0.008, 'chrome', 0.026, both=True, closed=True)
    # The big upright matrix grille in a heavy chrome frame.
    gr = rounded([(-0.4, 0.37), (0.4, 0.37), (0.38, 0.74), (0.3, 0.765), (-0.3, 0.765), (-0.38, 0.74)], 1)
    flat(o, pr, 'front', gr, 'grille', 0.006, bezel=(0.035, 'chrome', 0.014), res=res)
    if res:
        for k in range(-9, 10):
            s = k * 0.075
            line(o, pr, 'front', [(s - 0.2, 0.38), (s + 0.2, 0.75)], 0.008, 'chrome', 0.01)
            line(o, pr, 'front', [(s + 0.2, 0.38), (s - 0.2, 0.75)], 0.008, 'chrome', 0.01)
        # Clean up the lattice beyond the frame: dark paint over the ends would show, so
        # cover the edges with the frame again (a thicker chrome band).
        line(o, pr, 'front', gr + [gr[0]], 0.05, 'chrome', 0.018)
    # Side intakes low in the bumper with mesh, a black lip.
    for s in (1,):
        intake = rounded([(0.5, 0.3), (0.82, 0.32), (0.84, 0.46), (0.52, 0.44)], 1)
        flat(o, pr, 'front', intake, 'grille', 0.004, both=True, bezel=(0.014, 'chrome', 0.006), res=res)
    plate(o, pr, 'front', (0.0, 0.31))
    line(o, pr, 'front', [(-0.75, 0.24), (0.75, 0.24)], 0.03, 'black', 0.003)

    # Oval tail lamps, chrome along the boot lip, twin oval tailpipes, a black diffuser.
    tl = oval((0.66, 0.86), 0.17, 0.065, 18)
    lamp(o, pr, 'rear', tl, 'tail', res, 'chrome', 0.008, 0.006, bw=0.012)
    if res:
        line(o, pr, 'rear', oval((0.66, 0.86), 0.11, 0.035, 14), 0.01, 'red', 0.014, both=True, closed=True)
        line(o, pr, 'rear', [(-0.48, 0.9), (0.48, 0.9)], 0.014, 'chrome', 0.005)
    plate(o, pr, 'rear', (0.0, 0.62))
    line(o, pr, 'rear', [(-0.8, 0.33), (0.8, 0.33)], 0.09, 'black', 0.004)
    for s in (1, -1):
        o.body.extend(cyl((x0 + 0.08, s * 0.6, 0.33), (x0 - 0.04, s * 0.6, 0.33), 0.045, 'chrome', 14 if res else 6).transform(
            Matrix.Translation((0, s * 0.6, 0.33)) @ Matrix.Diagonal((1, 1.7, 1, 1)) @ Matrix.Translation((0, -s * 0.6, -0.33))))
        if res:
            o.body.extend(cyl((x0 - 0.03, s * 0.6, 0.33), (x0 - 0.045, s * 0.6, 0.33), 0.035, 'gap', 12).transform(
                Matrix.Translation((0, s * 0.6, 0.33)) @ Matrix.Diagonal((1, 1.7, 1, 1)) @ Matrix.Translation((0, -s * 0.6, -0.33))))

    if res:
        gaps(o, pr, [
            [(0.75, 0.94), (0.8, 0.7), (0.84, 0.36)],
            [(-0.58, 0.97), (-0.6, 0.62), (-0.62, 0.36)],
            [(0.84, 0.36), (-0.62, 0.36)],
        ])
        handle(o, pr, -0.38, 0.86, 'chrome', w=0.15)
        gaps(o, pr, [[(0.78, 0.74), (1.8, 0.72), (2.3, 0.6), (2.36, 0.4)]], frame='top')
        gaps(o, pr, [[(2.36, -0.4), (2.36, 0.4)]], frame='top', both=False)
        gaps(o, pr, [[(-1.82, 0.66), (-2.3, 0.62)]], frame='top')
        # Chrome round the side windows; the wing vent behind the front wheel.
        line(o, prg, 'side', along(p['shoulder'], 0.68, -1.25, 14, -0.003), 0.016, 'chrome', 0.004, both=True)
        vent = rounded([(xf - R - 0.12, 0.62), (xf - R - 0.32, 0.6), (xf - R - 0.34, 0.66), (xf - R - 0.14, 0.7)], 1)
        flat(o, pr, 'side', vent, 'grille', 0.003, both=True, bezel=(0.01, 'chrome', 0.004), res=res)
        line(o, pr, 'side', [(xf - R - 0.1, 0.33), (xr + R + 0.1, 0.33)], 0.025, 'chrome', 0.004, both=True)
    cx = p['ws_base'] - 0.035
    line(o, pr, 'top', [(cx, -0.78), (cx, 0.78)], 0.07, 'black', 0.003)
    if res:
        wipers(o, p, cx, ((0.5, -0.05), (-0.02, -0.6)))


@car
def bentley(res):
    return closed_car(res, bentley_params())


# ------------------------------------------------------------------ Coventry E-Type

def etype_params():
    L, W = 4.45, 1.66
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.3, -1.138
    R = 0.33
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.185, track=1.28, arch_gap=0.04, rim='mesh', spokes=18, rim_ratio=0.6, color=0x1a4a2e,
        bottom=C((x0, 0.38), (x0 + 0.15, 0.28), (x0 + 0.5, 0.2), (xr, 0.16), (xf, 0.15), (xf + 0.4, 0.17), (x1 - 0.15, 0.22), (x1, 0.3)),
        shoulder=C((x0, 0.6), (x0 + 0.05, 0.68), (x0 + 0.3, 0.78), (xr, 0.82), (-0.3, 0.8), (0.4, 0.78), (xf, 0.72), (x1 - 0.25, 0.62), (x1 - 0.06, 0.52), (x1, 0.45)),
        top=C((x0, 0.62), (x0 + 0.05, 0.7), (x0 + 0.3, 0.82), (-1.6, 0.86), (-1.2, 0.86), (0.2, 0.84), (xf, 0.79), (x1 - 0.25, 0.69), (x1 - 0.06, 0.56), (x1, 0.48)),
        width=C((x0, 0.76), (xr, 0.82), (0.0, 0.81), (xf, 0.82), (x1 - 0.4, 0.76), (x1, 0.62)),
        tuck=const(0.12), tumble=const(0.14), cfrac=const(0.42),
        rb=const(0.1), rs=const(0.12),
        front=(0.75, 2.0), rear=(0.55, 2.3),
        flares=[(xf, 0.5, 0.015, 0.55, 0.25), (xr, 0.6, 0.02, 0.6, 0.25)],
        open=[(-1.35, 0.15, 0.2)],
        bl_base=-1.8, ws_base=0.22, inset=0.03,
        roof_z=C((-1.8, 0.87), (-1.5, 0.98), (-1.15, 1.1), (-0.8, 1.19), (-0.5, 1.22), (-0.28, 1.205), (-0.05, 1.1), (0.22, 0.86)),
        rail_z=C((-1.8, 0.86), (-1.5, 0.96), (-1.15, 1.07), (-0.8, 1.15), (-0.5, 1.175), (-0.28, 1.16), (-0.05, 1.06), (0.22, 0.85)),
        rail_w=C((-1.8, 0.48), (-1.2, 0.56), (-0.5, 0.6), (0.0, 0.62), (0.22, 0.66)),
        corner=C((-1.0, 0.07), (-0.3, 0.06), (0.2, 0.04)),
        gh_rear=(0.55, 2.0),
        lines=[(-1.1, -0.98), (-0.95, -0.88), (-0.55, -0.6), (-0.52, -0.57), (-0.22, -0.26)],
        driver_y=0.33, hip_f=(-0.65, 0.33), benches=[], seats=2,
        dash=(0.2, -0.12, 0.62, 0.45, 0.76), wheel_c=(-0.22, 0.7), wheel_r=0.2, wheel_tilt=0.3, wheel_region='black',
        mirror=(0.12, 0.66, 0.82), mirror_region='chrome', mirror_out=0.12,
    )

    def glass_region(i):
        seg, xb, xr_ = i['seg'], i['xb'], i['xr']
        if seg == 'side':
            if i['zone'] == 'rear' or xb < -1.1:
                return 'paint'
            if i['zone'] == 'front' or xb > 0.1 or -0.55 < xb < -0.52:
                return 'chrome'
            return 'glass'
        if xr_ > -0.26 or xr_ < -0.88:
            return 'glass'
        return 'paint'

    p['glass_region'] = glass_region
    p['decor'] = etype_decor
    return p


def etype_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    # The power bulge down the middle of the bonnet.
    bulge = rounded([(0.35, 0.2), (1.2, 0.19), (1.85, 0.12), (2.05, 0.06), (2.05, -0.06), (1.85, -0.12), (1.2, -0.19), (0.35, -0.2)], 2)
    o.body.extend(patch(pr, 'top', ccw(bulge), 'paint', 0.002, 0.03 if res else 0.02, 5 if res else 2))
    if res:
        # Louvres either side of it.
        for k in range(7):
            x = 1.05 + k * 0.06
            line(o, pr, 'top', [(x, 0.34), (x - 0.02, 0.5)], 0.012, 'gap', 0.003, both=True)
    # The small oval mouth with a chrome bar across it.
    mouth = oval((0.0, 0.37), 0.2, 0.085, 18)
    flat(o, pr, 'front', mouth, 'grille', 0.004, bezel=(0.018, 'chrome', 0.008), res=res)
    if res:
        line(o, pr, 'front', [(-0.2, 0.37), (0.2, 0.37)], 0.016, 'chrome', 0.014)
        lamp(o, pr, 'front', oval((0.0, 0.37), 0.04, 0.03, 10), 'chrome', res, None, 0.004, 0.02, rings=1)
    # Covered round headlamps in scoops at the tips of the wings.
    hf = aim((x1 - 0.3, 0.5, 0.57), 0.35, 0.45)
    lamp(o, pr, hf, oval((0.0, 0.01), 0.1, 0.13, 18), 'gloss', res, 'chrome', 0.004, 0.004, bw=0.012)
    lamp(o, pr, hf, circle_pts((0.0, -0.02), 0.07, 16), 'head', res, 'chrome', 0.012, 0.01, bw=0.01)
    # Slim chrome blade bumpers either side of the mouth, little lamps above them.
    for sgn in (1, -1):
        surface_tube(o, pr, 'front', [(sgn * 0.12, 0.29), (sgn * 0.3, 0.3), (sgn * 0.45, 0.32), (sgn * 0.56, 0.36)], 0.018, 'chrome', 0.03, 8 if res else 4)
    lamp(o, pr, 'front', oval((0.42, 0.42), 0.04, 0.025, 10), 'amber', res, 'chrome', 0.005, 0.006, bw=0.008)

    # Tail: small lamps over slim wraparound bumpers, the plate between them, twin pipes.
    for sgn in (1, -1):
        surface_tube(o, pr, 'rear', [(sgn * 0.2, 0.4), (sgn * 0.4, 0.41), (sgn * 0.58, 0.44), (sgn * 0.68, 0.48)], 0.018, 'chrome', 0.03, 8 if res else 4)
    lamp(o, pr, 'rear', oval((0.5, 0.52), 0.05, 0.035, 12), 'tail', res, 'chrome', 0.006, 0.006, bw=0.01)
    if res:
        lamp(o, pr, 'rear', oval((0.5, 0.6), 0.04, 0.025, 10), 'amber', res, 'chrome', 0.005, 0.006, bw=0.008)
    plate(o, pr, 'rear', (0.0, 0.48), w=0.3, h=0.13)
    for s in (0.06, -0.06):
        o.body.extend(cyl((x0 + 0.3, s, 0.24), (x0 - 0.05, s, 0.24), 0.025, 'chrome', 10 if res else 5))

    if res:
        # The front-hinged bonnet's shut line in front of the door, the door, the hatch.
        gaps(o, pr, [
            [(0.36, 0.8), (0.4, 0.6), (0.42, 0.3)],
            [(0.2, 0.82), (0.25, 0.6), (0.28, 0.3)],
            [(-0.68, 0.84), (-0.72, 0.55), (-0.74, 0.3)],
            [(0.28, 0.3), (-0.74, 0.3)],
        ])
        gaps(o, pr, [[(0.38, -0.6), (0.38, 0.6)]], frame='top', both=False)
        gaps(o, pr, [[(-1.84, -0.42), (-1.84, 0.42)]], frame='top', both=False)
        handle(o, pr, -0.6, 0.74, 'chrome', w=0.08, h=0.025)
        # Chrome window frames.
        line(o, prg, 'side', along(p['shoulder'], 0.12, -1.1, 14, -0.003), 0.012, 'chrome', 0.004, both=True)
    cx = p['ws_base'] - 0.03
    line(o, pr, 'top', [(cx, -0.6), (cx, 0.6)], 0.05, 'chrome', 0.003)
    if res:
        wipers(o, p, cx, ((0.42, 0.12), (0.12, -0.18), (-0.18, -0.48)))


@car
def etype(res):
    return closed_car(res, etype_params())
