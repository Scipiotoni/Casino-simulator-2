"""
The big ones: the Jackpot Limo (a stretched American luxury saloon with a chrome grille and
an extra door and windows in the stretch).
"""
import math

from mathutils import Matrix, Vector

from carkit import C, const, rbox, cyl, tube, rrect_pts, circle_pts, ccw
from carbody import aim, patch, strip, Projector
import carparts as P
from carcommon import car, closed_car, lamp, flat, line, gaps, handle, plate, rounded, arch_pts, along


# ------------------------------------------------------------------ the limo

def limo_params():
    L, W = 7.6, 1.96
    x0, x1 = -L / 2, L / 2
    xf, xr = 2.82, -2.47
    R = 0.36
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.235, track=1.63, arch_gap=0.055, rim='multi', spokes=7, color=0xf4f4f6,
        bottom=C((x0, 0.37), (x0 + 0.12, 0.3), (x0 + 0.5, 0.245), (xr - 0.4, 0.19), (xr, 0.18), (xf, 0.18), (xf + 0.5, 0.21), (x1 - 0.12, 0.27), (x1, 0.33)),
        shoulder=C((x0, 0.86), (x0 + 0.05, 0.93), (x0 + 0.25, 0.97), (-2.6, 0.98), (0.0, 0.972), (1.9, 0.95), (2.7, 0.928), (x1 - 0.25, 0.9), (x1 - 0.05, 0.875), (x1, 0.84)),
        top=C((x0, 0.88), (x0 + 0.05, 0.955), (x0 + 0.25, 0.995), (-2.7, 1.005), (1.9, 0.99), (2.7, 0.958), (x1 - 0.25, 0.928), (x1 - 0.05, 0.9), (x1, 0.86)),
        width=C((x0, 0.955), (-2.6, 0.975), (2.6, 0.98), (x1, 0.965)),
        tuck=const(0.07), tumble=const(0.05), cfrac=C((x0, 0.74), (0.0, 0.72), (x1, 0.74)),
        rb=const(0.06), rs=C((x0, 0.03), (x0 + 0.3, 0.04), (x1 - 0.3, 0.04), (x1, 0.03)),
        front=(0.24, 3.4), rear=(0.24, 3.4),
        flares=[(xf, 0.55, 0.006, 0.6, 0.25), (xr, 0.55, 0.008, 0.62, 0.25)],
        open=[(-2.36, 1.96, 0.27)],
        bl_base=-2.74, ws_base=2.0, inset=0.035,
        roof_z=C((-2.74, 1.0), (-2.56, 1.2), (-2.36, 1.37), (-2.16, 1.44), (-1.8, 1.462), (0.6, 1.468), (1.15, 1.455), (1.42, 1.38), (1.72, 1.18), (2.0, 0.975)),
        rail_z=C((-2.74, 0.99), (-2.56, 1.17), (-2.36, 1.33), (-2.16, 1.393), (-1.8, 1.413), (0.6, 1.418), (1.15, 1.405), (1.42, 1.33), (1.72, 1.14), (2.0, 0.96)),
        rail_w=C((-2.74, 0.8), (-2.2, 0.775), (0.0, 0.768), (1.3, 0.778), (2.0, 0.84)),
        corner=C((-2.3, 0.065), (1.2, 0.06), (1.7, 0.045)),
        lines=[(-2.62, -2.2), (-1.98, -1.88), (-1.29, -1.29), (-1.19, -1.19), (-0.27, -0.27), (-0.17, -0.17),
               (0.82, 0.82), (0.92, 0.92), (1.62, 1.17)],
        driver_y=0.39, hip_f=(0.8, 0.53), seats=8,
        dash=(1.96, 1.5, 0.78, 0.6, 0.95), wheel_c=(1.27, 0.87),
        mirror=(1.8, 0.905, 0.985),
        benches=[(-1.78, 1.36, 0.53)],
    )

    def glass_region(i):
        seg, xb, xr_ = i['seg'], i['xb'], i['xr']
        if seg == 'side':
            if i['zone'] == 'front' or xb > 1.7:
                return 'black'
            # Black pillars between the windows, body colour behind the rear door.
            for (a, b) in ((0.82, 0.92), (-0.27, -0.17), (-1.29, -1.19)):
                if a < xb < b:
                    return 'gloss'
            if xb < -1.98:
                return 'paint'
            return 'glass'
        if seg == 'corner':
            return 'paint'
        if xr_ > 1.17 or xr_ < -2.2:
            return 'glass'
        return 'paint'

    p['glass_region'] = glass_region
    p['decor'] = limo_decor
    # Rear compartment: a forward-facing bench at the back, a side bench along the right.
    p['more_seats'] = [(-0.3, -0.6, 0.53), (-0.9, -0.6, 0.53), (-1.78, 0.0, 0.53), (0.2, 0.3, 0.53)]
    return p


def limo_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    # The chrome grille: an upright frame full of vertical bars, standing proud of the nose.
    gr = rounded(rrect_pts((0.0, 0.69), 0.78, 0.29, 0.03, 2), 1)
    flat(o, pr, 'front', gr, 'grille', 0.012, bezel=(0.03, 'chrome', 0.016), res=res, rings=1)
    if res:
        n = 15
        for k in range(n):
            s = -0.36 + 0.72 * k / (n - 1)
            line(o, pr, 'front', [(s, 0.56), (s, 0.82)], 0.014, 'chrome', 0.02)
        line(o, pr, 'front', [(-0.37, 0.69), (0.37, 0.69)], 0.012, 'chrome', 0.02)
    # Headlamps: wide rectangles either side, wrapping onto the wings, an amber corner lamp outboard.
    hf = aim((x1 - 0.05, 0.62, 0.72), 0.22, 0.04)
    head = rounded([(-0.21, -0.07), (0.17, -0.07), (0.25, -0.05), (0.26, 0.06), (0.17, 0.075), (-0.21, 0.075)], 1)
    lamp(o, pr, hf, head, 'head', res, 'chrome', 0.008, 0.008, bw=0.014)
    if res:
        for s in (-0.11, 0.03):
            lamp(o, pr, hf, circle_pts((s, 0.0), 0.045, 12), 'chrome', res, 'gloss', 0.006, 0.02, bw=0.008, rings=2)
        line(o, pr, hf, [(-0.2, -0.055), (0.24, -0.04)], 0.01, 'white', 0.02, both=True)
    cf = aim((x1 - 0.2, 0.9, 0.72), 0.95, 0.0)
    lamp(o, pr, cf, rounded(rrect_pts((0.0, 0.0), 0.16, 0.12, 0.02, 1), 1), 'amber', res, 'chrome', 0.004, 0.008, bw=0.008)
    # A chrome strip across the bumper, the plate, the lower intake with round fog lamps.
    line(o, pr, 'front', [(-0.86, 0.5), (0.86, 0.5)], 0.03, 'chrome', 0.008)
    plate(o, pr, 'front', (0.0, 0.42))
    low = rounded([(-0.62, 0.36), (0.62, 0.36), (0.66, 0.29), (-0.66, 0.29)], 1)
    flat(o, pr, 'front', low, 'grille', 0.004, bezel=(0.01, 'gloss', 0.003), res=res, rings=1)
    for s in (1, -1):
        lamp(o, pr, 'front', circle_pts((s * 0.72, 0.36), 0.05, 12), 'head', res, 'chrome', 0.006, 0.008, bw=0.01, both=False)
    line(o, pr, 'front', [(-0.8, 0.28), (0.8, 0.28)], 0.025, 'black', 0.003)

    # Tail lamps: tall red blocks wrapping round the corners, a chrome panel across the boot lid.
    tf = aim((x0 + 0.1, 0.76, 0.78), math.pi - 0.5, 0.0)
    tail = rounded(rrect_pts((0.0, 0.0), 0.3, 0.2, 0.025, 2), 1)
    lamp(o, pr, tf, tail, 'tail', res, 'chrome', 0.006, 0.008, bw=0.012)
    if res:
        lamp(o, pr, tf, rrect_pts((0.07, -0.05), 0.1, 0.05, 0.01, 1), 'white', res, None, 0.002, 0.016)
        for t in (-0.02, 0.04):
            line(o, pr, tf, [(-0.13, t), (0.13, t)], 0.006, 'red', 0.016, both=True)
    panel = rrect_pts((0.0, 0.83), 1.0, 0.085, 0.02, 2)
    flat(o, pr, 'rear', panel, 'chrome', 0.006, res=res)
    if res:
        line(o, pr, 'rear', [(-0.46, 0.83), (0.46, 0.83)], 0.03, 'red', 0.009)
    plate(o, pr, 'rear', (0.0, 0.66))
    line(o, pr, 'rear', [(-0.9, 0.5), (0.9, 0.5)], 0.03, 'chrome', 0.008)
    line(o, pr, 'rear', [(-0.86, 0.38), (0.86, 0.38)], 0.08, 'black', 0.003)
    if res:
        for s in (1, -1):
            o.body.extend(cyl((x0 + 0.08, s * 0.55, 0.3), (x0 - 0.04, s * 0.55, 0.3), 0.035, 'chrome', 10))
            o.body.extend(cyl((x0 - 0.035, s * 0.55, 0.3), (x0 - 0.04, s * 0.55, 0.3), 0.026, 'gap', 10))

    if res:
        # Doors: the front one, one in the stretch, the rear one round the arch; sills; bonnet, boot.
        rear_arch = arch_pts(xr, R, R + 0.1, 62, 6, 6)
        gaps(o, pr, [
            [(1.78, 0.97), (1.8, 0.75), (1.77, 0.5), (1.74, 0.33)],
            [(0.87, 0.98), (0.87, 0.33)],
            [(0.78, 0.98), (0.78, 0.33)],
            [(-0.22, 0.98), (-0.22, 0.33)],
            [(-1.24, 0.98), (-1.24, 0.33)],
            [(-2.0, 0.99), (-2.0, 0.76)] + rear_arch + [(xr + R + 0.1, 0.33)],
            [(1.74, 0.33), (xr + R + 0.1, 0.33)],
        ])
        gaps(o, pr, [[(2.0, 0.78), (2.6, 0.77), (3.3, 0.72), (3.62, 0.6)]], frame='top')
        gaps(o, pr, [[(-2.76, 0.72), (-3.6, 0.7)]], frame='top')
        gaps(o, pr, [[(-0.72, 0.95), (-0.72, 0.6), (0.72, 0.6), (0.72, 0.95)]], frame='rear', both=False)
        line(o, pr, 'side', rounded(rrect_pts((-2.95, 0.85), 0.17, 0.12, 0.03, 2), 1), 0.006, 'gap', 0.0015, closed=True)
        for x in (1.0, -0.05, -1.4):
            handle(o, pr, x, 0.88, 'chrome')
        # Chrome along the bottom and the top of the side glass, round the windows.
        line(o, prg, 'side', along(p['shoulder'], 1.7, -1.98, 24, -0.004), 0.018, 'chrome', 0.004, both=True)
        line(o, prg, 'side', along(p['rail_z'], 1.6, -1.88, 24, -0.012), 0.014, 'chrome', 0.006, both=True)
        # A chrome rocker strip and a body-side moulding.
        line(o, pr, 'side', [(xf - R - 0.12, 0.27), (xr + R + 0.12, 0.27)], 0.05, 'chrome', 0.004, both=True)
        line(o, pr, 'side', [(xf - R - 0.1, 0.6), (xr + R + 0.1, 0.6)], 0.035, 'black', 0.005, both=True)
        line(o, pr, 'side', [(xf - R - 0.1, 0.6), (xr + R + 0.1, 0.6)], 0.008, 'chrome', 0.008, both=True)
        for xx in (x1 - 0.55, x0 + 0.6):
            line(o, pr, 'side', [(xx + 0.25, 0.6), (xx - 0.25, 0.6)], 0.03, 'black', 0.005, both=True)

    # Black cowl, wipers.
    cx = p['ws_base'] - 0.035
    line(o, pr, 'top', [(cx, -0.78), (cx, 0.78)], 0.08, 'black', 0.003)
    if res:
        for (a, b) in ((0.56, -0.06), (-0.02, -0.62)):
            o.body.extend(tube([Vector((cx - 0.03, a, p['roof_z'](cx - 0.03) + 0.01)), Vector((cx - 0.08, b, p['roof_z'](cx - 0.08) + 0.012))], 0.007, 'black', 4))
        o.body.extend(rbox((-1.9, 0, p['roof_z'](-1.9) + 0.012), (0.075, 0.022, 0.028), 0.018, 'paint', 1))
        limo_cabin(o, p)


def limo_cabin(o, p):
    """The rear compartment: a partition behind the driver, a side bench, a bar, the roof console."""
    fl = 0.27
    # The partition: a low wall with a glass screen above it.
    o.body.extend(rbox((0.5, 0, 0.62), (0.04, 0.76, 0.33), 0.02, 'interior', 1))
    o.body.extend(rbox((0.5, 0, 1.12), (0.012, 0.72, 0.18), 0.01, 'glass', 1))
    # A bench along the right-hand side, facing across the car.
    sb = P.seat(0.0, 0.0, 0.0, 1.5, 0.48, 0.5, 0.25, 'seat', res=0, head=False, bolster=False)
    sb.transform(Matrix.Translation((-0.6, -0.56, 0.44)) @ Matrix.Rotation(math.pi / 2, 4, 'Z'))
    o.body.extend(sb)
    # The bar along the left with a lit strip and some glasses on it.
    o.body.extend(rbox((-0.55, 0.66, 0.5), (0.65, 0.13, 0.23), 0.02, 'gloss', 1))
    o.body.extend(rbox((-0.55, 0.66, 0.735), (0.66, 0.14, 0.012), 0.006, 'chrome', 1))
    o.body.extend(rbox((-0.55, 0.535, 0.58), (0.6, 0.004, 0.01), 0.002, 'sign', 1))
    for k in range(4):
        x = -0.95 + 0.25 * k
        o.body.extend(cyl((x, 0.66, 0.747), (x, 0.66, 0.82), 0.025, 'glass', 8, r1=0.032))
    # Floor, and the roof console with a light strip.
    o.body.extend(rbox((-0.6, 0, fl + 0.01), (1.75, 0.8, 0.01), 0.005, 'interior', 1))
    o.body.extend(rbox((-0.6, 0, 1.40), (1.2, 0.18, 0.02), 0.01, 'interior', 1))
    o.body.extend(rbox((-0.6, 0, 1.378), (1.1, 0.012, 0.004), 0.002, 'sign', 1))


@car
def limo(res):
    return closed_car(res, limo_params())
