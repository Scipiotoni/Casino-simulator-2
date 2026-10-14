"""
The saloons: the Islander Sedan (a modern mid-size family saloon), the Island Cab (the same
car in taxi colours with a roof sign) and the Interceptor (a police saloon with a light bar
and a push bar).
"""
import math

from mathutils import Matrix, Vector

from carkit import C, const, rbox, cyl, tube, rrect_pts, circle_pts, ccw
from carbody import aim, patch, strip, Projector
import carparts as P
from carcommon import car, closed_car, lamp, flat, line, gaps, handle, plate, rounded, arch_pts, along


def sedan_params():
    L, W = 4.88, 1.84
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.46, -1.365
    R = 0.338
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.235, track=1.58, arch_gap=0.05, rim='twin', spokes=5, color=0xe8e8ea,
        bottom=C((x0, 0.4), (x0 + 0.1, 0.32), (x0 + 0.45, 0.235), (xr - 0.3, 0.18), (xr, 0.17), (xf, 0.17), (xf + 0.55, 0.2), (x1 - 0.1, 0.24), (x1, 0.29)),
        shoulder=C((x0, 0.9), (x0 + 0.06, 0.95), (x0 + 0.3, 0.985), (-1.4, 0.995), (-0.4, 0.97), (0.9, 0.935), (1.5, 0.875), (2.05, 0.8), (x1 - 0.05, 0.75), (x1, 0.7)),
        top=C((x0, 0.93), (x0 + 0.06, 0.985), (x0 + 0.3, 1.025), (-1.6, 1.03), (0.9, 0.955), (1.5, 0.895), (2.05, 0.825), (x1 - 0.05, 0.765), (x1, 0.715)),
        width=C((x0, 0.885), (-1.6, 0.915), (1.4, 0.92), (x1, 0.89)),
        tuck=const(0.075), tumble=const(0.06), cfrac=C((x0, 0.8), (-1.2, 0.79), (1.0, 0.75), (x1, 0.78)),
        rb=const(0.07), rs=C((x0, 0.035), (x0 + 0.3, 0.05), (1.2, 0.05), (x1 - 0.3, 0.035), (x1, 0.03)),
        front=(0.40, 2.6), rear=(0.30, 3.2),
        flares=[(xf, 0.55, 0.01, 0.62, 0.25), (xr, 0.6, 0.016, 0.66, 0.26)],
        open=[(-1.22, 0.90, 0.27)],
        bl_base=-1.62, ws_base=0.93, inset=0.03,
        roof_z=C((-1.62, 1.0), (-1.3, 1.17), (-0.95, 1.33), (-0.6, 1.415), (-0.25, 1.445), (0.1, 1.43), (0.4, 1.32), (0.7, 1.13), (0.93, 0.95)),
        rail_z=C((-1.62, 0.99), (-1.3, 1.14), (-0.95, 1.29), (-0.6, 1.365), (-0.25, 1.388), (0.1, 1.372), (0.4, 1.262), (0.7, 1.085), (0.93, 0.93)),
        rail_w=C((-1.62, 0.76), (-1.0, 0.72), (-0.3, 0.705), (0.3, 0.725), (0.93, 0.79)),
        corner=C((-1.0, 0.075), (0.1, 0.065), (0.6, 0.045)),
        lines=[(-1.13, -0.8), (-0.95, -0.62), (-0.17, -0.2), (-0.08, -0.11), (0.12, 0.08)],
        driver_y=0.37, hip_f=(-0.12, 0.53), benches=[(-0.98, 1.3, 0.56)], seats=4,
        dash=(0.9, 0.5, 0.74, 0.6, 0.93), wheel_c=(0.34, 0.86),
        mirror=(0.79, 0.855, 0.955),
        livery=None,
    )

    def glass_region(i):
        seg, xb, xr_ = i['seg'], i['xb'], i['xr']
        body = 'paint2' if p['livery'] == 'police' else 'paint'
        if seg == 'side':
            if i['zone'] == 'front' or xb > 0.76:
                return 'black'
            if -0.17 < xb < -0.08:
                return 'gloss'
            if xb < -1.13:
                return body
            return 'glass'
        if seg == 'corner':
            return 'paint'
        if xr_ > 0.08 or xr_ < -0.62:
            return 'glass'
        return 'paint'

    def hull_region(i, hull):
        if p['livery'] != 'police' or i['seg'] in ('bot', 'in', 'cap'):
            return None
        # Black and white: white doors, the rest black.
        if 0.86 > i['x'] > -1.06 and i['seg'] in ('low', 'up', 'sill', 'sh') and i['c'].z > 0.3:
            return 'paint'
        return 'paint2'

    p['glass_region'] = glass_region
    p['hull_region'] = hull_region
    p['decor'] = sedan_decor
    return p


def sedan_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    # Headlights: swept back round the corners, with projector lenses and a light strip.
    hf = aim((x1 - 0.17, 0.62, 0.705), 0.78, 0.12)
    head = rounded([(-0.25, -0.04), (0.16, -0.022), (0.27, 0.012), (0.3, 0.05), (0.22, 0.06), (-0.26, 0.04)], 2)
    lamp(o, pr, hf, head, 'head', res, 'gloss', 0.01, 0.006, bw=0.012)
    if res:
        for (s, t) in ((-0.15, 0.005), (-0.06, 0.008)):
            lamp(o, pr, hf, circle_pts((s, t), 0.026, 10), 'chrome', res, 'gloss', 0.004, 0.02, bw=0.006, rings=2)
        line(o, pr, hf, [(-0.23, -0.028), (0.15, -0.012), (0.25, 0.018), (0.27, 0.042)], 0.011, 'white', 0.02, both=True)
    # Slim upper grille joining the headlights, a chrome bar along its top.
    up = rounded([(-0.47, 0.672), (-0.4, 0.642), (0.4, 0.642), (0.47, 0.672), (0.42, 0.7), (-0.42, 0.7)], 1)
    flat(o, pr, 'front', up, 'grille', 0.004, bezel=(0.008, 'gloss', 0.003), res=res)
    if res:
        line(o, pr, 'front', [(-0.42, 0.703), (0.42, 0.703)], 0.012, 'chrome', 0.006)
    # The big lower grille, with bars, and the plate on it.
    low = rounded([(-0.56, 0.5), (0.56, 0.5), (0.7, 0.29), (-0.7, 0.29)], 2)
    flat(o, pr, 'front', low, 'grille', 0.004, bezel=(0.014, 'gloss', 0.003), res=res)
    if res:
        for z, w in ((0.46, 0.55), (0.415, 0.585), (0.37, 0.62), (0.325, 0.655)):
            line(o, pr, 'front', [(-w, z), (w, z)], 0.012, 'gloss', 0.007)
    plate(o, pr, 'front', (0.0, 0.405))
    # Corner vents with fog lamps.
    fv = aim((x1 - 0.17, 0.7, 0.38), 0.55, 0.0)
    flat(o, pr, fv, rounded([(-0.06, -0.075), (0.06, -0.06), (0.07, 0.07), (-0.05, 0.085)], 1), 'grille', 0.004, both=True, bezel=(0.01, 'gloss', 0.003), res=res)
    if res:
        lamp(o, pr, fv, circle_pts((0.0, 0.0), 0.03, 10), 'head', res, 'chrome', 0.004, 0.009, bw=0.006, rings=2)
    # A black lip under the front.
    line(o, pr, 'front', [(-0.72, 0.275), (0.72, 0.275)], 0.03, 'black', 0.003)

    # Tail lights wrapping round the corners, reversing lamps inside, chrome across the boot.
    tf = aim((x0 + 0.13, 0.64, 0.905), math.pi - 0.82, 0.04)
    tail = rounded([(0.27, -0.05), (0.27, 0.042), (-0.08, 0.05), (-0.27, 0.035), (-0.31, 0.005), (-0.2, -0.03), (0.0, -0.045)], 2)
    lamp(o, pr, tf, tail, 'tail', res, 'gloss', 0.006, 0.006, bw=0.008)
    if res:
        lamp(o, pr, tf, rounded(rrect_pts((0.19, -0.004), 0.08, 0.05, 0.01, 1), 1), 'white', res, None, 0.002, 0.014)
        line(o, pr, tf, [(0.1, 0.03), (-0.2, 0.026)], 0.008, 'red', 0.016, both=True)
        line(o, pr, 'rear', [(-0.47, 0.915), (0.47, 0.915)], 0.022, 'chrome', 0.006)
    plate(o, pr, 'rear', (0.0, 0.69))
    line(o, pr, 'rear', [(-0.74, 0.355), (0.74, 0.355)], 0.075, 'black', 0.003)
    if res:
        for s in (1, -1):
            o.body.extend(rbox((x0 + 0.06, s * 0.56, 0.345), (0.06, 0.07, 0.022), 0.015, 'chrome', 1))
            o.body.extend(rbox((x0 + 0.02, s * 0.56, 0.345), (0.03, 0.058, 0.014), 0.008, 'gap', 1))

    if res:
        # Panel gaps: front door, B-pillar, rear door round the arch, the sills; bonnet and boot.
        rear_arch = arch_pts(xr, R, R + 0.1, 58, 4, 6)
        gaps(o, pr, [
            [(0.88, 0.97), (0.9, 0.78), (0.87, 0.52), (0.84, 0.33)],
            [(-0.12, 0.98), (-0.12, 0.33)],
            [(-1.1, 0.99), (-1.1, 0.74)] + rear_arch + [(xr + R + 0.1, 0.33)],
            [(0.84, 0.33), (xr + R + 0.1, 0.33)],
        ])
        gaps(o, pr, [[(0.93, 0.74), (1.6, 0.715), (2.15, 0.64), (2.3, 0.5)]], frame='top')
        gaps(o, pr, [[(-1.64, 0.72), (-2.3, 0.7)]], frame='top')
        gaps(o, pr, [[(-0.6, 0.86), (-0.6, 0.57), (0.6, 0.57), (0.6, 0.86)]], frame='rear', both=False)
        line(o, pr, 'side', rounded(rrect_pts((-1.72, 0.84), 0.17, 0.12, 0.03, 2), 1), 0.006, 'gap', 0.0015, closed=True)
        for (x, z) in ((0.16, 0.875), (-0.9, 0.895)):
            handle(o, pr, x, z, 'paint' if p['livery'] != 'police' else 'chrome')
        # Chrome along the bottom of the side windows.
        line(o, prg, 'side', along(p['shoulder'], 0.74, -1.12, 12, -0.004), 0.016, 'chrome', 0.004, both=True)
        # Side mouldings low on the doors.
        line(o, pr, 'side', [(0.8, 0.37), (-0.92, 0.37)], 0.02, 'black', 0.004, both=True)
    # Black cowl under the windscreen, wipers on it.
    cx = p['ws_base'] - 0.035
    line(o, pr, 'top', [(cx, -0.74), (cx, 0.74)], 0.08, 'black', 0.003)
    if res:
        for (a, b) in ((0.52, -0.06), (-0.02, -0.6)):
            o.body.extend(tube([Vector((cx - 0.03, a, p['roof_z'](cx - 0.03) + 0.01)), Vector((cx - 0.075, b, p['roof_z'](cx - 0.075) + 0.012))], 0.007, 'black', 4))
        # Shark-fin aerial at the back of the roof.
        o.body.extend(rbox((-0.55, 0, p['roof_z'](-0.55) + 0.012), (0.075, 0.022, 0.028), 0.018, 'paint' if p['livery'] != 'police' else 'paint2', 1))
    if p.get('extra'):
        p['extra'](o, res, pr, prg, hull, p)


@car
def sedan(res):
    return closed_car(res, sedan_params())


def taxi_extra(o, res, pr, prg, hull, p):
    """The roof sign (it lights up at night) and a chequered band along the doors."""
    z = p['roof_z'](-0.35) - 0.005
    sx = -0.35
    o.body.extend(rbox((sx, 0, z + 0.02), (0.1, 0.32, 0.02), 0.01, 'black', 1))
    sign_box = rbox((sx, 0, z + 0.13), (0.085, 0.4, 0.1), 0.045, 'sign', 2 if res else 1)
    o.body.extend(sign_box)
    if res:
        # TAXI in black on the front and the back of the sign.
        ps = Projector(sign_box)
        for frame, sg in (('front', -1), ('rear', 1)):
            for r in P.letters('TAXI', 0.0, z + 0.085, 0.09, sign=sg):
                flat(o, ps, frame, r, 'gap', 0.003, rings=1)
        # Chequers: two rows along the doors.
        sq = 0.06
        n = int(1.9 / sq)
        for k in range(n):
            for row in (0, 1):
                if (k + row) % 2:
                    continue
                xs = 0.82 - k * sq
                zs = 0.73 - row * sq
                flat(o, pr, 'side', [(xs, zs), (xs, zs - sq), (xs - sq, zs - sq), (xs - sq, zs)], 'gap', 0.003, both=True, rings=1)


@car
def taxi(res):
    p = sedan_params()
    p['color'] = 0xffcc1f
    p['rim'] = 'steel'
    p['extra'] = taxi_extra
    return closed_car(res, p)


def police_extra(o, res, pr, prg, hull, p):
    """Light bar, push bar, a spotlight by the windscreen and POLICE on the doors."""
    z = p['roof_z'](-0.15)
    o.body.extend(P.lightbar(-0.15, z - 0.01, 0.62, res=res))
    x1 = p['L'] / 2
    # Push bar: two uprights and rails in front of the grille.
    pb = []
    for s in (1, -1):
        pb.append(tube([Vector((x1 - 0.1, s * 0.32, 0.3)), Vector((x1 + 0.1, s * 0.32, 0.32)), Vector((x1 + 0.12, s * 0.3, 0.72)), Vector((x1 - 0.02, s * 0.28, 0.76))], 0.022, 'black', 6 if res else 4))
    for zz in (0.42, 0.62):
        pb.append(rbox((x1 + 0.12, 0, zz), (0.025, 0.36, 0.035), 0.012, 'black', 1))
    for m in pb:
        o.body.extend(m)
    if res:
        # A-pillar spotlight.
        o.body.extend(cyl((0.72, 0.8, 1.07), (0.8, 0.8, 1.07), 0.05, 'chrome', 10))
        o.body.extend(cyl((0.8, 0.8, 1.07), (0.805, 0.8, 1.07), 0.044, 'head', 10))
        # POLICE along the doors, reading front to back on the left and back to front on the right.
        for r in P.letters('POLICE', -0.1, 0.6, 0.1, sign=-1):
            flat(o, pr, 'side', r, 'gap', 0.003, rings=1)
        for r in P.letters('POLICE', -0.1, 0.6, 0.1, sign=1):
            o.body.extend(patch(pr, 'side', ccw(r), 'gap', 0.003, 0.0, 1).mirrored())
        # Antennas on the boot.
        for s in (0.3, -0.3):
            o.body.extend(cyl((-2.0, s, 1.02), (-2.0, s, 1.32), 0.004, 'black', 4))


@car
def police(res):
    p = sedan_params()
    p['color'] = 0xf4f4f6
    p['livery'] = 'police'
    p['rim'] = 'steel'
    p['extra'] = police_extra
    p['mirror_region'] = 'paint2'
    return closed_car(res, p)
