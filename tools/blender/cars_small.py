"""
The small and the open cars: the Bubble Hatch (a small, tall, round retro city car), the
Riviera Convertible (a long, low 1960s American cruiser with the top down) and the Dune
Buggy (a fibreglass buggy on balloon tyres with a roll cage and its engine out at the back).
"""
import math

from mathutils import Matrix, Vector

from carkit import C, const, rbox, cyl, tube, torus, lathe, rrect_pts, circle_pts, ccw
from carbody import aim, patch, Projector
import carparts as P
from carcommon import car, closed_car, lamp, flat, line, gaps, handle, plate, rounded, arch_pts, along


# ------------------------------------------------------------------ the Bubble Hatch

def hatch_params():
    L, W = 3.58, 1.66
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.07, -1.25
    R = 0.3
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.185, track=1.42, arch_gap=0.045, rim='retro', spokes=5, color=0x4fc3f7,
        bottom=C((x0, 0.44), (x0 + 0.08, 0.34), (x0 + 0.32, 0.24), (xr - 0.25, 0.185), (xr, 0.175), (xf, 0.175), (xf + 0.3, 0.2), (x1 - 0.25, 0.25), (x1 - 0.06, 0.33), (x1, 0.4)),
        shoulder=C((x0, 0.87), (x0 + 0.06, 0.935), (x0 + 0.25, 0.97), (-1.0, 0.965), (-0.2, 0.93), (0.7, 0.905), (1.1, 0.865), (1.45, 0.815), (1.65, 0.75), (x1 - 0.03, 0.69), (x1, 0.665)),
        top=C((x0, 0.89), (x0 + 0.06, 0.955), (x0 + 0.25, 0.995), (-1.0, 0.99), (0.7, 0.95), (1.1, 0.915), (1.45, 0.865), (1.65, 0.795), (x1 - 0.03, 0.715), (x1, 0.69)),
        width=C((x0, 0.79), (x0 + 0.45, 0.825), (0.0, 0.83), (x1 - 0.45, 0.82), (x1, 0.79)),
        tuck=const(0.06), tumble=const(0.05), cfrac=const(0.72),
        rb=const(0.08), rs=const(0.07),
        front=(0.55, 2.25), rear=(0.34, 2.8),
        flares=[(xf, 0.5, 0.012, 0.6, 0.25), (xr, 0.5, 0.014, 0.62, 0.25)],
        open=[(-1.15, 0.68, 0.26)],
        bl_base=-1.6, ws_base=0.7, inset=0.03, between=2,
        roof_z=C((-1.6, 0.97), (-1.55, 1.07), (-1.45, 1.23), (-1.32, 1.35), (-1.1, 1.43), (-0.75, 1.47), (-0.35, 1.48), (-0.05, 1.45), (0.2, 1.34), (0.45, 1.16), (0.7, 0.94)),
        rail_z=C((-1.6, 0.96), (-1.55, 1.05), (-1.45, 1.19), (-1.32, 1.3), (-1.1, 1.38), (-0.75, 1.42), (-0.35, 1.43), (-0.05, 1.405), (0.2, 1.3), (0.45, 1.13), (0.7, 0.925)),
        rail_w=C((-1.6, 0.62), (-1.2, 0.58), (-0.5, 0.57), (0.1, 0.58), (0.7, 0.66)),
        corner=C((-1.0, 0.12), (0.0, 0.11), (0.45, 0.06)),
        lines=[(-1.55, -1.55), (-1.48, -1.48), (-1.4, -1.36), (-1.24, -1.1), (-0.56, -0.52), (-0.49, -0.46), (0.06, 0.03), (0.58, 0.42)],
        driver_y=0.33, hip_f=(-0.1, 0.5), benches=[(-0.8, 1.08, 0.53)], seats=4,
        dash=(0.7, 0.45, 0.64, 0.6, 0.91), wheel_c=(0.3, 0.84),
        mirror=(0.6, 0.66, 0.935), mirror_out=0.15,
        seat_w=0.46,
    )

    def glass_region(i):
        seg, xb, xr_ = i['seg'], i['xb'], i['xr']
        if seg == 'side':
            if i['zone'] == 'front' or xb > 0.58:
                return 'black'
            if -0.56 < xb < -0.49:
                return 'gloss'
            if xb < -1.24:
                return 'paint'
            return 'glass'
        if seg == 'corner':
            return 'paint'
        if xr_ > 0.03 or xr_ < -1.36:
            return 'glass'
        return 'paint'

    p['glass_region'] = glass_region
    p['decor'] = hatch_decor
    return p


def hatch_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    xf, xr, R = p['xf'], p['xr'], p['R']
    # Big round headlamps on the front corners in chrome rings, a small lamp above each.
    hf = aim((x1 - 0.2, 0.54, 0.6), 0.5, 0.04)
    lamp(o, pr, hf, circle_pts((0, 0), 0.108, 20 if res else 10), 'head', res, 'chrome', 0.018, 0.006, bw=0.02)
    if res:
        lamp(o, pr, hf, circle_pts((0, 0), 0.066, 16), 'chrome', res, None, 0.004, 0.02, rings=2)
        lamp(o, pr, hf, circle_pts((0, 0), 0.03, 10), 'head', res, None, 0.004, 0.026, rings=2)
    sf = aim((x1 - 0.12, 0.47, 0.745), 0.35, 0.2)
    lamp(o, pr, sf, rounded(rrect_pts((0, 0), 0.11, 0.05, 0.024, 2), 1), 'head', res, 'chrome', 0.006, 0.006, bw=0.008)
    # The chrome whiskers across the nose, swept up to the lamps.
    whisk = [(-0.36, 0.665), (-0.24, 0.69), (-0.1, 0.7), (0.1, 0.7), (0.24, 0.69), (0.36, 0.665)]
    line(o, pr, 'front', whisk, 0.022 if res else 0.03, 'chrome', 0.006)
    # The lower intake under the plate, with bars, round fog lamps in the corners.
    low = rounded([(-0.34, 0.39), (0.34, 0.39), (0.4, 0.27), (-0.4, 0.27)], 2)
    flat(o, pr, 'front', low, 'grille', 0.004, bezel=(0.012, 'gloss', 0.003), res=res)
    if res:
        for z, w in ((0.355, 0.36), (0.315, 0.38)):
            line(o, pr, 'front', [(-w, z), (w, z)], 0.012, 'gloss', 0.007)
    plate(o, pr, 'front', (0.0, 0.47), 0.3, 0.12)
    ff = aim((x1 - 0.25, 0.6, 0.33), 0.55, 0.0)
    flat(o, pr, ff, rounded(rrect_pts((0, 0), 0.13, 0.08, 0.035, 2), 1), 'grille', 0.004, both=True, bezel=(0.01, 'gloss', 0.003), res=res)
    if res:
        lamp(o, pr, ff, circle_pts((0.0, 0.0), 0.03, 10), 'head', res, 'chrome', 0.004, 0.009, bw=0.006, rings=2)
    line(o, pr, 'front', [(-0.66, 0.255), (0.66, 0.255)], 0.03, 'black', 0.003)
    # Indicators low on the front wings.
    if res:
        lamp(o, pr, 'side', rounded(rrect_pts((1.36, 0.6), 0.05, 0.022, 0.01, 2), 1), 'amber', res, 'gloss', 0.003, 0.004, bw=0.004, rings=2)

    # Tail lamps: tall rounded rings on the back corners with a body-coloured centre.
    tf = aim((x0 + 0.12, 0.66, 0.79), math.pi - 0.62, 0.02)
    tail = rounded(rrect_pts((0, 0), 0.13, 0.27, 0.06, 3), 1)
    lamp(o, pr, tf, tail, 'tail', res, 'chrome', 0.006, 0.006, bw=0.01)
    if res:
        lamp(o, pr, tf, circle_pts((0.0, 0.035), 0.04, 14), 'paint', res, 'chrome', 0.003, 0.014, bw=0.008, rings=2)
        lamp(o, pr, tf, rounded(rrect_pts((0.0, -0.085), 0.07, 0.035, 0.015, 2), 1), 'white', res, None, 0.002, 0.012, rings=2)
    # The tailgate: plate in the middle, a chrome handle bar over it, the bumper and its reflectors.
    plate(o, pr, 'rear', (0.0, 0.69), 0.3, 0.13)
    if res:
        line(o, pr, 'rear', [(-0.22, 0.79), (0.22, 0.79)], 0.035, 'chrome', 0.007)
        gaps(o, pr, [[(-0.52, 0.95), (-0.56, 0.62), (-0.5, 0.55), (0.5, 0.55), (0.56, 0.62), (0.52, 0.95)]], frame='rear', both=False)
    line(o, pr, 'rear', [(-0.68, 0.33), (0.68, 0.33)], 0.13, 'black', 0.003)
    if res:
        for s in (1, -1):
            flat(o, pr, 'rear', rrect_pts((s * 0.48, 0.33), 0.1, 0.025, 0.01, 2), 'tail', 0.006, rings=1)
        o.body.extend(cyl((x0 + 0.12, -0.42, 0.25), (x0 - 0.02, -0.42, 0.25), 0.026, 'chrome', 10, caps=False))
        o.body.extend(cyl((x0 + 0.0, -0.42, 0.25), (x0 - 0.019, -0.42, 0.25), 0.02, 'gap', 10))

    if res:
        # Panel gaps: the long door, the sill; the clamshell bonnet; the fuel flap.
        rear_arch = arch_pts(xr, R, R + 0.09, 70, 8, 6)
        gaps(o, pr, [
            [(0.66, 0.9), (0.68, 0.7), (0.65, 0.5), (0.6, 0.29)],
            [(-0.52, 0.91), (-0.54, 0.6), (-0.52, 0.29)],
            [(0.6, 0.29), (-0.52, 0.29)],
        ])
        gaps(o, pr, [[(0.72, 0.68), (1.1, 0.67), (1.38, 0.62), (1.5, 0.58)]], frame='top')
        line(o, pr, 'side', circle_pts((-1.36, 0.8), 0.055, 14), 0.006, 'gap', 0.0015, closed=True)
        handle(o, pr, -0.38, 0.82, 'chrome', 0.12, 0.028)
        # Chrome along the bottom of the side windows, a rubbing strip low on the doors.
        line(o, prg, 'side', along(p['shoulder'], 0.56, -1.2, 12, -0.004), 0.014, 'chrome', 0.004, both=True)
        line(o, pr, 'side', [(0.58, 0.42), (-0.48, 0.42)], 0.03, 'black', 0.004, both=True)
        # Wheel-arch lips.
        for (xc, a0, a1) in ((xf, 8, 172), (xr, 8, 172)):
            line(o, pr, 'side', arch_pts(xc, R, R + 0.06, a0, a1, 14), 0.018, 'black', 0.003, both=True)
    # Cowl and wipers under the windscreen, a rear wiper, an aerial on the roof.
    cx = p['ws_base'] - 0.03
    line(o, pr, 'top', [(cx, -0.6), (cx, 0.6)], 0.06, 'black', 0.003)
    if res:
        for (a, b) in ((0.45, -0.05), (-0.05, -0.55)):
            o.body.extend(tube([Vector((cx - 0.02, a, p['roof_z'](cx - 0.02) + 0.01)), Vector((cx - 0.12, b, p['roof_z'](cx - 0.12) + 0.012))], 0.007, 'black', 4))
        o.body.extend(tube([Vector((-1.555, 0.0, 1.02)), Vector((-1.47, 0.22, 1.27))], 0.007, 'black', 4))
        o.body.extend(cyl((-0.15, 0.0, p['roof_z'](-0.15) - 0.005), (-0.3, 0.0, p['roof_z'](-0.15) + 0.3), 0.004, 'black', 4))
        o.body.extend(cyl((-0.15, 0.0, p['roof_z'](-0.15) - 0.01), (-0.15, 0.0, p['roof_z'](-0.15) + 0.02), 0.018, 'black', 8))
        # A body-coloured band across the dashboard.
        d = p['dash']
        o.body.extend(rbox((d[1] - 0.008, 0.0, (d[3] + d[4]) / 2 + 0.06), (0.012, d[2] - 0.04, 0.07), 0.01, 'paint', 1))


@car
def hatch(res):
    return closed_car(res, hatch_params())
