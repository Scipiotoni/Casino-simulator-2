"""
The everyday city cars: the Sakura Civica (an 11th-generation Civic-style five-door hatch),
the Wolfburg Gulf (a Golf Mk7-style hatch), the Edison Volt 3 (a Model 3-style electric
saloon), the Kaido Prism (a wedge-shaped Prius-style hybrid), the Svea 240 Wagon (a boxy
1980s Swedish estate) and the Kaido Trail4 (a fifth-generation RAV4-style crossover).

Each car is a parameter dict for carcommon.closed_car plus a decor function; the helpers at
the top (window regions, cabin, door gaps, cowl) are shared between them.
"""
import math

from mathutils import Vector

from carkit import C, const, rbox, cyl, tube, rrect_pts, circle_pts
from carbody import aim
from carcommon import car, closed_car, lamp, flat, line, gaps, handle, plate, rounded, arch_pts, along


# ------------------------------------------------------------------ shared helpers

def windows(p, ws_top, bl_top, side, corner=None, front_black=None):
    """
    A glass_region: the windscreen above xr > ws_top, the back window below xr < bl_top, the
    side seg by `side` = [(xb_lo, xb_hi, region)] ranges (first match wins, glass otherwise),
    the roof corner by corner(xr) (paint by default).
    """
    def glass_region(i):
        seg, xb, xr = i['seg'], i['xb'], i['xr']
        if seg == 'side':
            if i['zone'] == 'front':
                return 'black'
            if i['zone'] == 'rear':
                return p.get('rear_side', 'paint')
            for (a, b, r) in side:
                if a < xb < b:
                    return r
            return 'glass'
        if seg == 'corner':
            return corner(xr) if corner else 'paint'
        if xr > ws_top or xr < bl_top:
            return 'glass'
        return p.get('roof_region', 'paint')
    return glass_region


def cabin(p, ws, rear=True, seats=4, hip_dx=0.0, z=0.0, bench_w=1.28):
    """Dash, steering wheel, driver's hip and the rear bench placed from the windscreen base `ws`."""
    d = ws - 0.93
    p.update(
        driver_y=0.36, hip_f=(-0.12 + d + hip_dx, 0.53 + z),
        dash=(0.9 + d, 0.5 + d, 0.72, 0.6 + z, 0.92 + z), wheel_c=(0.34 + d + hip_dx, 0.86 + z),
        benches=[(-0.98 + d + hip_dx * 1.5, bench_w, 0.56 + z)] if rear else [], seats=seats,
    )


def cowl(o, res, pr, p, w=0.72, wipers=True):
    """Black cowl under the windscreen, wipers on it."""
    cx = p['ws_base'] - 0.035
    line(o, pr, 'top', [(cx, -w), (cx, w)], 0.08, 'black', 0.003)
    if res and wipers:
        for (a, b) in ((0.52, -0.06), (-0.02, -0.6)):
            o.body.extend(tube([Vector((cx - 0.03, a, p['roof_z'](cx - 0.03) + 0.01)), Vector((cx - 0.075, b, p['roof_z'](cx - 0.075) + 0.012))], 0.007, 'black', 4))


def doors(o, pr, p, fd, bp, rd, sill=0.33, top=None):
    """
    Door gaps on the side: the front door's leading edge `fd` (polyline from the top down), the
    B-pillar at x = bp, the rear door's trailing edge from x = rd round the rear arch, the sill.
    """
    xr, R = p['xr'], p['R']
    sh = p['shoulder']
    t = top or (lambda x: sh(x) + 0.03)
    ra = p['R'] + p['arch_gap'] + 0.05
    rear_arch = arch_pts(xr, R, ra, 70, 6, 6)
    gaps(o, pr, [
        fd,
        [(bp, t(bp)), (bp, sill)],
        [(rd, t(rd)), (rd, R + ra * math.sin(math.radians(70)) + 0.02)] + rear_arch + [(xr + ra, sill)],
        [(fd[-1][0], sill), (xr + ra, sill)],
    ])


def tailgate(o, pr, z0, z1, w0, w1, r=0.04):
    """The tailgate's cut line seen from behind: up both sides from the bottom edge."""
    gaps(o, pr, [[(-w1, z1), (-w0, z0 + r), (-w0 + r, z0), (w0 - r, z0), (w0, z0 + r), (w1, z1)]], frame='rear', both=False)


def rails(o, res, p, x0, x1, y, h=0.045, region='black'):
    """Roof rails along the roof edges, on short feet."""
    rz = p['roof_z']
    rw = p['rail_w']
    for s in (1, -1):
        pts = []
        n = 8
        for k in range(n + 1):
            x = x0 + (x1 - x0) * k / n
            pts.append(Vector((x, s * (rw(x) - y), rz(x) - 0.035 + h)))
        o.body.extend(tube(pts, 0.016, region, 6 if res else 4))
        for x in (x0 + 0.04, x1 - 0.04):
            o.body.extend(rbox((x, s * (rw(x) - y), rz(x) - 0.03 + h / 2), (0.05, 0.018, h / 2 + 0.01), 0.008, region, 1))


# ------------------------------------------------------------------ Sakura Civica (Civic hatch)

def civic_params():
    L, W = 4.55, 1.8
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.33, -1.405
    R = 0.33
    ws, bl = 0.8, x0 + 0.2
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.235, track=1.55, arch_gap=0.05, rim='twin', spokes=5, color=0xc8202f,
        rim_ratio=0.7,
        bottom=C((x0, 0.38), (x0 + 0.1, 0.3), (x0 + 0.4, 0.22), (xr - 0.3, 0.17), (xr, 0.16), (xf, 0.16), (xf + 0.5, 0.19), (x1 - 0.1, 0.22), (x1, 0.27)),
        shoulder=C((x0, 0.97), (x0 + 0.06, 1.0), (x0 + 0.3, 1.02), (-1.6, 1.0), (-0.6, 0.95), (0.8, 0.9), (1.4, 0.84), (2.0, 0.76), (x1 - 0.05, 0.7), (x1, 0.66)),
        top=C((x0, 1.0), (x0 + 0.06, 1.035), (x0 + 0.3, 1.055), (-1.7, 1.05), (0.8, 0.915), (1.4, 0.865), (2.0, 0.785), (x1 - 0.05, 0.72), (x1, 0.68)),
        width=C((x0, 0.87), (-1.6, 0.9), (1.4, 0.9), (x1, 0.87)),
        tuck=const(0.075), tumble=const(0.065), cfrac=C((x0, 0.78), (-1.2, 0.8), (1.0, 0.76), (x1, 0.8)),
        rb=const(0.07), rs=C((x0, 0.035), (x0 + 0.3, 0.05), (1.2, 0.05), (x1 - 0.3, 0.035), (x1, 0.03)),
        front=(0.42, 2.6), rear=(0.28, 3.0),
        flares=[(xf, 0.55, 0.012, 0.62, 0.25), (xr, 0.6, 0.018, 0.66, 0.26)],
        open=[(-1.35, ws - 0.02, 0.26)],
        bl_base=bl, ws_base=ws, inset=0.03,
        roof_z=C((bl, 1.03), (-1.9, 1.1), (-1.6, 1.2), (-1.25, 1.3), (-0.9, 1.37), (-0.5, 1.405), (-0.15, 1.415), (0.1, 1.37), (0.35, 1.23), (0.6, 1.06), (ws, 0.91)),
        rail_z=C((bl, 1.02), (-1.9, 1.08), (-1.6, 1.17), (-1.25, 1.26), (-0.9, 1.325), (-0.5, 1.36), (-0.15, 1.368), (0.1, 1.325), (0.35, 1.19), (0.6, 1.03), (ws, 0.89)),
        rail_w=C((bl, 0.7), (-1.5, 0.69), (-0.5, 0.68), (0.3, 0.7), (ws, 0.78)),
        corner=C((-1.0, 0.07), (0.1, 0.06), (0.6, 0.045)),
        lines=[(-1.66, -1.36), (-1.32, -1.14), (-1.25, -1.1), (-0.36, -0.3), (-0.26, -0.2), (0.6, 0.5)],
        mirror=(0.66, 0.84, 0.935),
        keys=[-1.9],
    )
    cabin(p, ws)
    p['glass_region'] = windows(p, 0.06, -1.3,
                                [(0.6, 9, 'black'), (-0.36, -0.26, 'gloss'), (-1.32, -1.25, 'gloss'), (-9, -1.66, 'paint')])
    p['decor'] = civic_decor
    return p


def civic_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    # Slim headlights swept back into the wings, an LED strip along the top of each.
    hf = aim((x1 - 0.2, 0.6, 0.69), 0.82, 0.12)
    head = rounded([(-0.24, -0.03), (0.12, -0.022), (0.28, 0.006), (0.32, 0.034), (0.22, 0.04), (-0.25, 0.022)], 2)
    lamp(o, pr, hf, head, 'head', res, 'gloss', 0.008, 0.006, bw=0.012)
    if res:
        line(o, pr, hf, [(-0.22, 0.012), (0.12, 0.018), (0.26, 0.03)], 0.009, 'white', 0.016, both=True)
        for s in (-0.13, -0.02):
            lamp(o, pr, hf, circle_pts((s, -0.006), 0.02, 10), 'chrome', res, 'gloss', 0.004, 0.016, bw=0.005, rings=2)
    # A black honeycomb band joining the headlights.
    up = rounded([(-0.46, 0.66), (-0.38, 0.632), (0.38, 0.632), (0.46, 0.66), (0.42, 0.69), (-0.42, 0.69)], 1)
    flat(o, pr, 'front', up, 'grille', 0.004, bezel=(0.008, 'gloss', 0.003), res=res)
    # The wide lower grille, a honeycomb of dots on it, the plate in the middle.
    low = rounded([(-0.5, 0.5), (0.5, 0.5), (0.62, 0.3), (-0.62, 0.3)], 2)
    flat(o, pr, 'front', low, 'grille', 0.004, bezel=(0.016, 'gloss', 0.003), res=res)
    if res:
        for k, z in enumerate((0.47, 0.43, 0.39, 0.35, 0.32)):
            w = 0.5 + (0.5 - z) * 0.55
            line(o, pr, 'front', [(-w, z), (w, z)], 0.006, 'gloss', 0.006)
    plate(o, pr, 'front', (0.0, 0.4))
    # Corner intakes: black triangles low on the bumper.
    fv = aim((x1 - 0.2, 0.68, 0.38), 0.6, 0.0)
    flat(o, pr, fv, rounded([(-0.08, -0.08), (0.08, -0.07), (0.07, 0.07)], 1), 'grille', 0.004, both=True, bezel=(0.012, 'gloss', 0.003), res=res)
    line(o, pr, 'front', [(-0.7, 0.26), (0.7, 0.26)], 0.035, 'black', 0.003)

    # Boomerang tail lamps wrapping round the corners, a light bar across the tailgate.
    tf = aim((x0 + 0.12, 0.66, 0.96), math.pi - 0.85, 0.04)
    tail = rounded([(0.26, -0.03), (0.26, 0.035), (-0.05, 0.045), (-0.26, 0.03), (-0.3, 0.0), (-0.2, -0.02), (0.05, -0.028)], 2)
    lamp(o, pr, tf, tail, 'tail', res, 'gloss', 0.006, 0.006, bw=0.008)
    line(o, pr, 'rear', [(-0.5, 0.965), (0.5, 0.965)], 0.03, 'tail', 0.008)
    if res:
        line(o, pr, 'rear', [(-0.5, 0.94), (0.5, 0.94)], 0.012, 'gloss', 0.008)
        line(o, pr, tf, [(0.1, 0.022), (-0.22, 0.016)], 0.007, 'red', 0.013, both=True)
    # Body-colour lip spoiler at the foot of the back window.
    line(o, pr, 'rear', [(-0.6, 1.025), (0.6, 1.025)], 0.03, 'gloss', 0.01)
    plate(o, pr, 'rear', (0.0, 0.76))
    # Black diffuser with the twin centre exhausts.
    flat(o, pr, 'rear', rounded([(-0.7, 0.36), (0.7, 0.36), (0.66, 0.46), (-0.66, 0.46)], 1), 'black', 0.004, res=res)
    if res:
        for s in (0.09, -0.09):
            o.body.extend(cyl((x0 + 0.12, s, 0.4), (x0 - 0.015, s, 0.4), 0.04, 'chrome', 12))
            o.body.extend(cyl((x0 - 0.01, s, 0.4), (x0 - 0.016, s, 0.4), 0.03, 'gap', 12))
        tailgate(o, pr, 0.6, 1.0, 0.58, 0.62)
        doors(o, pr, p, [(0.7, 0.97), (0.72, 0.78), (0.69, 0.52), (0.66, 0.33)], -0.3, -1.2)
        gaps(o, pr, [[(0.8, 0.74), (1.5, 0.71), (2.05, 0.63), (2.2, 0.5)]], frame='top')
        line(o, pr, 'side', rounded(rrect_pts((-1.82, 0.88), 0.16, 0.11, 0.03, 2), 1), 0.006, 'gap', 0.0015, closed=True)
        for (x, z) in ((0.06, 0.875), (-0.98, 0.905)):
            handle(o, pr, x, z, 'paint')
        # A black sill along the bottom of the doors.
        line(o, pr, 'side', [(0.85, 0.27), (-1.0, 0.27)], 0.06, 'black', 0.004, both=True)
        # Shark-fin aerial.
        o.body.extend(rbox((-0.95, 0, p['roof_z'](-0.95) + 0.012), (0.075, 0.022, 0.028), 0.018, 'black', 1))
    cowl(o, res, pr, p)


@car
def civic(res):
    return closed_car(res, civic_params())


# ------------------------------------------------------------------ Wolfburg Gulf (Golf Mk7)

def golf_params():
    L, W = 4.28, 1.79
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.26, -1.377
    R = 0.32
    ws, bl = 0.62, x0 + 0.14
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.225, track=1.54, arch_gap=0.05, rim='multi', spokes=5, color=0x1e6bff,
        bottom=C((x0, 0.4), (x0 + 0.1, 0.32), (x0 + 0.35, 0.22), (xr - 0.3, 0.17), (xr, 0.16), (xf, 0.16), (xf + 0.45, 0.19), (x1 - 0.1, 0.24), (x1, 0.3)),
        shoulder=C((x0, 0.98), (x0 + 0.05, 1.0), (x0 + 0.25, 1.005), (-1.4, 0.985), (-0.4, 0.96), (0.6, 0.925), (1.2, 0.875), (1.8, 0.82), (x1 - 0.05, 0.775), (x1, 0.74)),
        top=C((x0, 1.0), (x0 + 0.05, 1.02), (x0 + 0.25, 1.03), (-1.6, 1.03), (0.6, 0.94), (1.2, 0.895), (1.8, 0.84), (x1 - 0.05, 0.79), (x1, 0.755)),
        width=C((x0, 0.87), (-1.5, 0.895), (1.3, 0.895), (x1, 0.87)),
        tuck=const(0.07), tumble=const(0.07), cfrac=const(0.84),
        rb=const(0.07), rs=C((x0, 0.03), (x0 + 0.3, 0.045), (1.2, 0.045), (x1 - 0.3, 0.03), (x1, 0.03)),
        front=(0.38, 2.6), rear=(0.22, 3.4),
        flares=[(xf, 0.5, 0.008, 0.62, 0.25), (xr, 0.55, 0.012, 0.66, 0.26)],
        open=[(-1.45, ws - 0.02, 0.26)],
        bl_base=bl, ws_base=ws, inset=0.03,
        roof_z=C((bl, 1.01), (-1.9, 1.17), (-1.75, 1.31), (-1.6, 1.405), (-1.4, 1.445), (-0.9, 1.46), (-0.3, 1.46), (0.0, 1.43), (0.2, 1.33), (0.42, 1.15), (ws, 0.96)),
        rail_z=C((bl, 1.0), (-1.9, 1.15), (-1.75, 1.28), (-1.6, 1.365), (-1.4, 1.4), (-0.9, 1.415), (-0.3, 1.415), (0.0, 1.385), (0.2, 1.29), (0.42, 1.12), (ws, 0.94)),
        rail_w=C((bl, 0.72), (-1.6, 0.7), (-0.5, 0.69), (0.2, 0.7), (ws, 0.78)),
        corner=C((-1.0, 0.07), (0.1, 0.06), (0.5, 0.045)),
        lines=[(-1.9, -1.9), (-1.8, -1.8), (-1.65, -1.65), (-1.34, -1.1), (-0.44, -0.4), (-0.32, -0.28), (0.46, 0.36)],
        mirror=(0.5, 0.84, 0.95),
    )
    cabin(p, ws, hip_dx=0.08)
    p['glass_region'] = windows(p, -0.02, -1.56, [(0.46, 9, 'black'), (-0.44, -0.32, 'gloss'), (-9, -1.34, 'paint')])
    p['decor'] = golf_decor
    return p


def golf_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    # Slim headlights, kinked down at the inner end, joined by a narrow grille with a chrome bar.
    hf = aim((x1 - 0.16, 0.58, 0.745), 0.75, 0.1)
    head = rounded([(-0.22, -0.05), (0.2, -0.035), (0.29, 0.0), (0.28, 0.045), (-0.12, 0.045), (-0.2, 0.03)], 1)
    lamp(o, pr, hf, head, 'head', res, 'gloss', 0.008, 0.006, bw=0.012)
    if res:
        for s in (-0.1, 0.05):
            lamp(o, pr, hf, circle_pts((s, -0.002), 0.03, 10), 'chrome', res, 'gloss', 0.004, 0.016, bw=0.005, rings=2)
        line(o, pr, hf, [(-0.19, -0.04), (0.2, -0.026), (0.27, 0.0)], 0.009, 'white', 0.016, both=True)
    up = [(-0.4, 0.675), (0.4, 0.675), (0.42, 0.74), (-0.42, 0.74)]
    flat(o, pr, 'front', up, 'grille', 0.004, bezel=(0.006, 'gloss', 0.003), res=res)
    line(o, pr, 'front', [(-0.48, 0.708), (0.48, 0.708)], 0.014, 'chrome', 0.008)
    # Bumper: the lower grille with slats, the plate above it, fog lamps in the corners.
    low = rounded([(-0.42, 0.45), (0.42, 0.45), (0.5, 0.3), (-0.5, 0.3)], 1)
    flat(o, pr, 'front', low, 'grille', 0.004, bezel=(0.014, 'gloss', 0.003), res=res)
    if res:
        for z in (0.41, 0.37, 0.33):
            w = 0.42 + (0.45 - z) * 0.53
            line(o, pr, 'front', [(-w, z), (w, z)], 0.01, 'gloss', 0.006)
    plate(o, pr, 'front', (0.0, 0.56), w=0.36, h=0.11)
    fv = aim((x1 - 0.17, 0.66, 0.38), 0.55, 0.0)
    flat(o, pr, fv, rounded(rrect_pts((0.0, 0.0), 0.2, 0.09, 0.03, 2), 1), 'grille', 0.004, both=True, bezel=(0.01, 'gloss', 0.003), res=res)
    if res:
        lamp(o, pr, fv, circle_pts((0.04, 0.0), 0.03, 10), 'head', res, 'chrome', 0.004, 0.009, bw=0.006, rings=2)
    line(o, pr, 'front', [(-0.7, 0.28), (0.7, 0.28)], 0.03, 'black', 0.003)

    # Horizontal two-part tail lamps: the outer half on the body, the inner on the tailgate.
    tf = aim((x0 + 0.1, 0.62, 0.92), math.pi - 0.75, 0.03)
    tail = rounded([(-0.26, -0.035), (0.24, -0.06), (0.28, -0.02), (0.27, 0.05), (-0.1, 0.06), (-0.27, 0.04)], 1)
    lamp(o, pr, tf, tail, 'tail', res, 'gloss', 0.006, 0.006, bw=0.008)
    if res:
        line(o, pr, tf, [(-0.24, 0.0), (0.24, -0.02)], 0.012, 'red', 0.014, both=True)
        line(o, pr, tf, [(0.07, 0.06), (0.07, -0.055)], 0.006, 'gap', 0.016, both=True)
        lamp(o, pr, tf, rounded(rrect_pts((-0.17, 0.03), 0.1, 0.025, 0.008, 1), 1), 'white', res, None, 0.002, 0.016)
    plate(o, pr, 'rear', (0.0, 0.73))
    # Roof spoiler over the back window, body colour.
    sx = -1.6
    o.body.extend(rbox((sx, 0, p['roof_z'](sx) - 0.01), (0.07, 0.6, 0.02), 0.016, 'paint', 2 if res else 1))
    flat(o, pr, 'rear', rounded([(-0.68, 0.36), (0.68, 0.36), (0.64, 0.46), (-0.64, 0.46)], 1), 'black', 0.004, res=res)
    if res:
        o.body.extend(cyl((x0 + 0.15, -0.5, 0.37), (x0 + 0.01, -0.5, 0.37), 0.035, 'chrome', 12))
        tailgate(o, pr, 0.6, 1.0, 0.56, 0.6)
        doors(o, pr, p, [(0.52, 0.98), (0.55, 0.8), (0.53, 0.52), (0.5, 0.33)], -0.38, -1.25)
        gaps(o, pr, [[(0.6, 0.74), (1.3, 0.72), (1.9, 0.65), (2.05, 0.5)]], frame='top')
        line(o, pr, 'side', rounded(rrect_pts((-1.72, 0.87), 0.15, 0.11, 0.03, 2), 1), 0.006, 'gap', 0.0015, closed=True)
        for (x, z) in ((-0.05, 0.875), (-1.05, 0.9)):
            handle(o, pr, x, z, 'paint')
        line(o, prg, 'side', along(p['shoulder'], 0.46, -1.3, 12, -0.004), 0.012, 'chrome', 0.004, both=True)
        o.body.extend(rbox((-1.3, 0, p['roof_z'](-1.3) + 0.012), (0.07, 0.022, 0.026), 0.018, 'paint', 1))
    cowl(o, res, pr, p)


@car
def golf(res):
    return closed_car(res, golf_params())


# ------------------------------------------------------------------ Edison Volt 3 (Model 3)

def model3_params():
    L, W = 4.7, 1.85
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.51, -1.365
    R = 0.34
    ws, bl = 1.0, -1.78
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.235, track=1.58, arch_gap=0.05, rim='turbine', spokes=5, color=0xf4f4f6,
        bottom=C((x0, 0.42), (x0 + 0.12, 0.32), (x0 + 0.45, 0.22), (xr - 0.3, 0.16), (xr, 0.15), (xf, 0.15), (xf + 0.45, 0.18), (x1 - 0.12, 0.23), (x1, 0.3)),
        shoulder=C((x0, 0.95), (x0 + 0.06, 0.99), (x0 + 0.3, 1.01), (-1.5, 1.0), (-0.5, 0.96), (0.6, 0.92), (1.1, 0.88), (1.6, 0.82), (2.0, 0.76), (x1 - 0.06, 0.69), (x1, 0.64)),
        top=C((x0, 0.98), (x0 + 0.06, 1.02), (x0 + 0.3, 1.04), (-1.8, 1.045), (1.0, 0.925), (1.4, 0.875), (1.8, 0.815), (2.1, 0.755), (x1 - 0.06, 0.7), (x1, 0.66)),
        width=C((x0, 0.89), (-1.5, 0.925), (1.4, 0.925), (x1, 0.89)),
        tuck=const(0.07), tumble=const(0.08), cfrac=const(0.72),
        rb=const(0.08), rs=C((x0, 0.05), (x0 + 0.3, 0.07), (1.2, 0.07), (x1 - 0.3, 0.05), (x1, 0.04)),
        front=(0.5, 2.3), rear=(0.34, 2.8),
        flares=[(xf, 0.55, 0.012, 0.6, 0.25), (xr, 0.6, 0.018, 0.66, 0.26)],
        open=[(-1.3, ws - 0.02, 0.26)],
        bl_base=bl, ws_base=ws, inset=0.03,
        roof_z=C((bl, 1.03), (-1.6, 1.13), (-1.3, 1.27), (-1.0, 1.36), (-0.6, 1.42), (-0.2, 1.443), (0.15, 1.42), (0.4, 1.33), (0.6, 1.21), (0.8, 1.07), (ws, 0.935)),
        rail_z=C((bl, 1.02), (-1.6, 1.11), (-1.3, 1.235), (-1.0, 1.32), (-0.6, 1.375), (-0.2, 1.396), (0.15, 1.375), (0.4, 1.29), (0.6, 1.175), (0.8, 1.045), (ws, 0.915)),
        rail_w=C((bl, 0.72), (-1.2, 0.7), (-0.4, 0.69), (0.4, 0.71), (ws, 0.79)),
        corner=C((-1.0, 0.07), (0.1, 0.06), (0.6, 0.045)),
        lines=[(-1.58, -1.3), (-1.3, -1.12), (-1.24, -1.07), (-0.33, -0.27), (-0.22, -0.16), (0.78, 0.62)],
        mirror=(0.84, 0.865, 0.95),
        keys=[-1.9],
    )
    cabin(p, ws, hip_dx=-0.12)
    side = [(0.78, 9, 'black'), (-0.33, -0.22, 'gloss'), (-1.3, -1.24, 'gloss'), (-9, -1.58, 'paint')]
    p['glass_region'] = windows(p, -0.17, -0.25, side)
    p['decor'] = model3_decor
    return p


def model3_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    # Slim almond headlights on the corners of the smooth nose.
    hf = aim((x1 - 0.24, 0.6, 0.7), 0.82, 0.22)
    head = rounded([(-0.2, -0.025), (0.08, -0.035), (0.24, -0.012), (0.28, 0.02), (0.12, 0.034), (-0.2, 0.014)], 2)
    lamp(o, pr, hf, head, 'head', res, 'gloss', 0.008, 0.006, bw=0.01)
    if res:
        lamp(o, pr, hf, circle_pts((-0.02, 0.0), 0.024, 10), 'chrome', res, 'gloss', 0.004, 0.016, bw=0.005, rings=2)
        line(o, pr, hf, [(-0.18, 0.006), (0.08, 0.016), (0.23, 0.012)], 0.006, 'white', 0.016, both=True)
    # No grille: just a low black lip intake and small corner slots.
    flat(o, pr, 'front', rounded([(-0.56, 0.27), (0.56, 0.27), (0.5, 0.34), (-0.5, 0.34)], 1), 'grille', 0.004, bezel=(0.008, 'gloss', 0.003), res=res)
    fv = aim((x1 - 0.2, 0.66, 0.36), 0.6, 0.0)
    flat(o, pr, fv, rounded(rrect_pts((0.0, 0.0), 0.12, 0.05, 0.02, 2), 1), 'grille', 0.004, both=True, res=res)

    # Slim wrap-around tail lamps split by the boot lid.
    tf = aim((x0 + 0.16, 0.62, 0.93), math.pi - 0.85, 0.06)
    tail = rounded([(0.26, -0.022), (0.27, 0.036), (-0.1, 0.045), (-0.29, 0.02), (-0.2, -0.018)], 2)
    lamp(o, pr, tf, tail, 'tail', res, 'gloss', 0.006, 0.006, bw=0.008)
    if res:
        line(o, pr, tf, [(0.2, 0.012), (-0.22, 0.016)], 0.007, 'red', 0.013, both=True)
        lamp(o, pr, tf, rounded(rrect_pts((0.12, -0.002), 0.07, 0.02, 0.008, 1), 1), 'white', res, None, 0.002, 0.014)
    plate(o, pr, 'rear', (0.0, 0.73))
    flat(o, pr, 'rear', rounded([(-0.72, 0.36), (0.72, 0.36), (0.68, 0.46), (-0.68, 0.46)], 1), 'black', 0.004, res=res)
    if res:
        # The boot lid: a short deck and the face behind it.
        tailgate(o, pr, 0.62, 1.0, 0.58, 0.62)
        gaps(o, pr, [[(-1.8, 0.62), (-2.12, 0.62)]], frame='top')
        doors(o, pr, p, [(0.86, 0.97), (0.88, 0.78), (0.86, 0.52), (0.83, 0.33)], -0.27, -1.18)
        gaps(o, pr, [[(1.0, 0.74), (1.6, 0.72), (2.1, 0.64), (2.25, 0.5)]], frame='top')
        # Flush door handles.
        for (x, z) in ((0.15, 0.885), (-0.85, 0.905)):
            handle(o, pr, x, z, 'paint', w=0.15, h=0.026)
        # Black trim round the bottom of the side windows.
        line(o, prg, 'side', along(p['shoulder'], 0.78, -1.56, 14, -0.004), 0.014, 'gloss', 0.004, both=True)
    # A black bar across the glass roof above the B-pillars.
    line(o, prg, 'top', [(-0.21, -0.6), (-0.21, 0.6)], 0.09, 'gloss', 0.004)
    cowl(o, res, pr, p, wipers=True)


@car
def model3(res):
    return closed_car(res, model3_params())


# ------------------------------------------------------------------ Kaido Prism (Prius)

def prius_params():
    L, W = 4.54, 1.76
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.34, -1.36
    R = 0.32
    ws, bl = 0.95, x0 + 0.18
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.215, track=1.52, arch_gap=0.05, rim='turbine', spokes=5, color=0x5fa0c8,
        bottom=C((x0, 0.4), (x0 + 0.1, 0.3), (x0 + 0.4, 0.22), (xr - 0.3, 0.16), (xr, 0.15), (xf, 0.15), (xf + 0.5, 0.18), (x1 - 0.1, 0.22), (x1, 0.28)),
        shoulder=C((x0, 1.0), (x0 + 0.04, 1.05), (x0 + 0.2, 1.07), (-1.6, 1.03), (-0.6, 0.96), (0.5, 0.9), (1.0, 0.86), (1.5, 0.79), (2.0, 0.71), (x1 - 0.05, 0.65), (x1, 0.61)),
        top=C((x0, 1.03), (x0 + 0.04, 1.08), (x0 + 0.2, 1.1), (-1.9, 1.1), (0.95, 0.885), (1.5, 0.815), (2.0, 0.735), (x1 - 0.05, 0.67), (x1, 0.63)),
        width=C((x0, 0.85), (-1.5, 0.88), (1.3, 0.88), (x1, 0.85)),
        tuck=const(0.07), tumble=const(0.07), cfrac=C((x0, 0.82), (0.0, 0.76), (x1, 0.74)),
        rb=const(0.07), rs=C((x0, 0.03), (x0 + 0.3, 0.05), (1.2, 0.05), (x1 - 0.3, 0.035), (x1, 0.03)),
        front=(0.45, 2.4), rear=(0.22, 3.4),
        flares=[(xf, 0.5, 0.008, 0.6, 0.25), (xr, 0.55, 0.012, 0.66, 0.26)],
        open=[(-1.35, ws - 0.02, 0.26)],
        bl_base=bl, ws_base=ws, inset=0.03,
        roof_z=C((bl, 1.09), (-1.9, 1.15), (-1.6, 1.24), (-1.2, 1.33), (-0.8, 1.4), (-0.4, 1.455), (-0.15, 1.47), (0.1, 1.44), (0.35, 1.32), (0.6, 1.16), (0.8, 1.03), (ws, 0.93)),
        rail_z=C((bl, 1.08), (-1.9, 1.135), (-1.6, 1.215), (-1.2, 1.295), (-0.8, 1.36), (-0.4, 1.41), (-0.15, 1.424), (0.1, 1.4), (0.35, 1.285), (0.6, 1.13), (0.8, 1.01), (ws, 0.915)),
        rail_w=C((bl, 0.69), (-1.4, 0.68), (-0.4, 0.67), (0.4, 0.69), (ws, 0.77)),
        corner=C((-1.0, 0.07), (0.1, 0.06), (0.6, 0.045)),
        lines=[(-1.75, -1.45), (-1.22, -1.1), (-1.16, -1.05), (-0.4, -0.33), (-0.3, -0.23), (0.75, 0.6)],
        mirror=(0.8, 0.84, 0.93),
        keys=[-1.9],
    )
    cabin(p, ws, hip_dx=-0.12)
    p['glass_region'] = windows(p, -0.02, -1.25, [(0.75, 9, 'black'), (-0.4, -0.3, 'gloss'), (-1.22, -1.16, 'gloss'), (-9, -1.75, 'paint')])
    p['decor'] = prius_decor
    return p


def prius_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    # Thin LED headlights stretched along the edges of the bonnet.
    hf = aim((x1 - 0.26, 0.56, 0.69), 0.8, 0.3)
    head = rounded([(-0.26, -0.014), (0.14, -0.018), (0.31, 0.004), (0.34, 0.026), (0.15, 0.022), (-0.27, 0.01)], 2)
    lamp(o, pr, hf, head, 'head', res, 'gloss', 0.006, 0.006, bw=0.01)
    if res:
        line(o, pr, hf, [(-0.24, 0.0), (0.14, 0.0), (0.3, 0.014)], 0.006, 'white', 0.014, both=True)
    # A wide black lower intake, the plate on it, sharp black fangs in the corners.
    low = rounded([(-0.5, 0.46), (0.5, 0.46), (0.6, 0.29), (-0.6, 0.29)], 1)
    flat(o, pr, 'front', low, 'grille', 0.004, bezel=(0.012, 'gloss', 0.003), res=res)
    if res:
        for z in (0.42, 0.37, 0.32):
            w = 0.5 + (0.46 - z) * 0.6
            line(o, pr, 'front', [(-w, z), (w, z)], 0.008, 'gloss', 0.006)
    plate(o, pr, 'front', (0.0, 0.39))
    fv = aim((x1 - 0.22, 0.64, 0.42), 0.6, 0.0)
    flat(o, pr, fv, [(-0.03, 0.12), (0.05, 0.1), (0.04, -0.12), (-0.02, -0.08)], 'gloss', 0.004, both=True, res=res)
    if res:
        lamp(o, pr, fv, rounded(rrect_pts((0.01, 0.05), 0.04, 0.06, 0.012, 1), 1), 'head', res, None, 0.003, 0.008)
    line(o, pr, 'front', [(-0.66, 0.26), (0.66, 0.26)], 0.03, 'black', 0.003)

    # Kamm tail: the spoiler bar across the back with the lower glass under it.
    sz = p['top'](x0 + 0.1) - 0.02
    o.body.extend(rbox((x0 + 0.1, 0, sz), (0.07, 0.6, 0.028), 0.02, 'paint', 2 if res else 1))
    flat(o, pr, 'rear', rounded([(-0.56, 0.92), (0.56, 0.92), (0.6, 1.04), (-0.6, 1.04)], 1), 'glass', 0.006, bezel=(0.01, 'gloss', 0.004), res=res)
    # Sharp, tall tail lamps down the corners.
    tf = aim((x0 + 0.1, 0.66, 0.9), math.pi - 0.95, 0.0)
    tail = [(-0.06, 0.15), (0.08, 0.16), (0.12, 0.05), (0.05, -0.17), (-0.02, -0.15), (0.0, 0.02), (-0.08, 0.06)]
    lamp(o, pr, tf, rounded(tail, 1), 'tail', res, 'gloss', 0.006, 0.006, bw=0.008)
    if res:
        line(o, pr, tf, [(-0.04, 0.12), (0.07, 0.12), (0.08, 0.04), (0.04, -0.12)], 0.01, 'red', 0.013, both=True)
    plate(o, pr, 'rear', (0.0, 0.72))
    flat(o, pr, 'rear', rounded([(-0.68, 0.36), (0.68, 0.36), (0.64, 0.46), (-0.64, 0.46)], 1), 'black', 0.004, res=res)
    if res:
        tailgate(o, pr, 0.6, 1.05, 0.55, 0.58)
        doors(o, pr, p, [(0.82, 0.95), (0.84, 0.78), (0.82, 0.52), (0.79, 0.33)], -0.33, -1.18)
        gaps(o, pr, [[(0.95, 0.72), (1.5, 0.7), (2.0, 0.62), (2.15, 0.5)]], frame='top')
        line(o, pr, 'side', rounded(rrect_pts((-1.78, 0.9), 0.15, 0.11, 0.03, 2), 1), 0.006, 'gap', 0.0015, closed=True)
        for (x, z) in ((0.1, 0.87), (-0.9, 0.9)):
            handle(o, pr, x, z, 'chrome')
        line(o, pr, 'side', [(0.85, 0.28), (-1.0, 0.28)], 0.05, 'black', 0.004, both=True)
        o.body.extend(rbox((-1.0, 0, p['roof_z'](-1.0) + 0.012), (0.07, 0.022, 0.026), 0.018, 'black', 1))
    cowl(o, res, pr, p)


@car
def prius(res):
    return closed_car(res, prius_params())


# ------------------------------------------------------------------ Svea 240 Wagon (Volvo 240 estate)

def wagon240_params():
    L, W = 4.79, 1.71
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.445, -1.195
    R = 0.315
    ws, bl = 0.8, x0 + 0.06
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.195, track=1.45, arch_gap=0.05, rim='slot', spokes=5, color=0x5a1f22,
        rim_ratio=0.62,
        bottom=C((x0, 0.42), (x0 + 0.05, 0.33), (x0 + 0.2, 0.25), (xr - 0.4, 0.2), (xr, 0.19), (xf, 0.19), (xf + 0.4, 0.21), (x1 - 0.05, 0.3), (x1, 0.36)),
        shoulder=C((x0, 0.96), (x0 + 0.04, 0.98), (x0 + 0.15, 0.985), (-1.0, 0.975), (0.8, 0.93), (1.5, 0.885), (x1 - 0.08, 0.86), (x1 - 0.02, 0.835), (x1, 0.8)),
        top=C((x0, 0.985), (x0 + 0.04, 1.0), (x0 + 0.15, 1.0), (-1.5, 1.0), (0.8, 0.94), (1.5, 0.9), (x1 - 0.08, 0.875), (x1 - 0.02, 0.855), (x1, 0.82)),
        width=C((x0, 0.845), (x0 + 0.3, 0.855), (x1 - 0.3, 0.855), (x1, 0.845)),
        tuck=const(0.03), tumble=const(0.045), cfrac=const(0.72),
        rb=const(0.04), rs=const(0.03),
        front=(0.12, 4.0), rear=(0.1, 4.0),
        open=[(-1.35, ws - 0.02, 0.27)],
        bl_base=bl, ws_base=ws, inset=0.025,
        roof_z=C((bl, 0.99), (-2.31, 1.15), (-2.28, 1.32), (-2.25, 1.4), (-2.18, 1.425), (-1.0, 1.44), (0.1, 1.44), (0.25, 1.4), (0.45, 1.25), (0.65, 1.08), (ws, 0.955)),
        rail_z=C((bl, 0.98), (-2.31, 1.13), (-2.28, 1.295), (-2.25, 1.37), (-2.18, 1.395), (-1.0, 1.41), (0.1, 1.41), (0.25, 1.37), (0.45, 1.225), (0.65, 1.06), (ws, 0.935)),
        rail_w=C((bl, 0.77), (-1.0, 0.765), (0.2, 0.765), (ws, 0.8)),
        corner=const(0.04), bulge=0.004,
        lines=[(-2.29, -2.29), (-2.25, -2.25), (-2.15, -2.12), (-1.25, -1.25), (-1.15, -1.15), (-0.33, -0.33), (-0.25, -0.25), (0.68, 0.55)],
        mirror=(0.7, 0.83, 0.94), mirror_region='black', mirror_out=0.15,
        keys=[-2.3],
    )
    cabin(p, ws, seats=5)
    b = p['benches'][0]
    p['more_seats'] = [(b[0], 0.0, b[2])]
    p['glass_region'] = windows(p, 0.22, -2.2, [(0.68, 9, 'black'), (-0.33, -0.25, 'black'), (-1.25, -1.15, 'black'), (-9, -2.15, 'paint')])
    p['decor'] = wagon240_decor
    return p


def wagon240_decor(o, res, pr, prg, hull, p):
    from carbody import Projector
    L = p['L']
    x0, x1 = -L / 2, L / 2
    seg = 2 if res else 1
    # Big black rubber bumpers, front and back, wrapping round the corners.
    bumpers = []
    for (x, sg) in ((x1 + 0.04, 1), (x0 - 0.05, -1)):
        bumpers.append(rbox((x, 0, 0.43), (0.09, 0.84, 0.085), 0.04, 'black', seg))
        bumpers.append(rbox((x - sg * 0.2, 0, 0.43), (0.16, 0.875, 0.08), 0.04, 'black', seg))
    bm = bumpers[0].copy()
    for m in bumpers[1:]:
        bm.extend(m)
    o.body.extend(bm)
    pb = Projector(bm)
    if res:
        for (x, sg) in ((x1 + 0.13, 1), (x0 - 0.14, -1)):
            o.body.extend(rbox((x, 0, 0.455), (0.01, 0.82, 0.01), 0.004, 'chrome', 1))
    plate(o, pb, 'front', (0.0, 0.41), w=0.4, h=0.11)
    # The upright chrome grille with its bars, square headlights, amber corner lamps.
    gr = [(-0.3, 0.53), (0.3, 0.53), (0.3, 0.79), (-0.3, 0.79)]
    flat(o, pr, 'front', gr, 'grille', 0.006, bezel=(0.025, 'chrome', 0.008), res=res)
    if res:
        for k in range(1, 8):
            y = -0.3 + 0.6 * k / 8
            line(o, pr, 'front', [(y, 0.54), (y, 0.78)], 0.008, 'chrome', 0.008)
        line(o, pr, 'front', [(-0.3, 0.53), (0.3, 0.79)], 0.014, 'chrome', 0.01)
    head = [(0.34, 0.56), (0.66, 0.56), (0.66, 0.77), (0.34, 0.77)]
    for s in (1, -1):
        hd = [(s * a, b) for (a, b) in head]
        lamp(o, pr, 'front', hd, 'head', res, 'chrome', 0.006, 0.006, both=False, bw=0.016)
        lamp(o, pr, 'front', [(s * 0.68, 0.58), (s * 0.79, 0.58), (s * 0.79, 0.76), (s * 0.68, 0.76)], 'amber', res, 'chrome', 0.004, 0.006, both=False, bw=0.012)

    # Tall tail lamps up the corners beside the tailgate.
    for s in (1, -1):
        ys = [(s * 0.6, 0.52), (s * 0.79, 0.52), (s * 0.79, 0.95), (s * 0.6, 0.95)]
        lamp(o, pr, 'rear', ys, 'tail', res, 'gloss', 0.004, 0.006, both=False, bw=0.012)
        if res:
            flat(o, pr, 'rear', [(s * 0.61, 0.66), (s * 0.78, 0.66), (s * 0.78, 0.74), (s * 0.61, 0.74)], 'amber', 0.012)
            flat(o, pr, 'rear', [(s * 0.61, 0.6), (s * 0.78, 0.6), (s * 0.78, 0.655), (s * 0.61, 0.655)], 'white', 0.012)
    plate(o, pr, 'rear', (0.0, 0.66), w=0.4, h=0.11)
    if res:
        tailgate(o, pr, 0.53, 1.0, 0.58, 0.58, r=0.02)
        line(o, pr, 'rear', [(-0.52, 0.76), (0.52, 0.76)], 0.02, 'black', 0.004)
        doors(o, pr, p, [(0.72, 0.97), (0.72, 0.33)], -0.29, -1.15)
        gaps(o, pr, [[(0.8, 0.8), (x1 - 0.02, 0.8)]], frame='top')
        gaps(o, pr, [[(-0.4, 0.82), (0.4, 0.82)]], frame='front', both=False)
        for (x, z) in ((0.08, 0.86), (-0.95, 0.875)):
            handle(o, pr, x, z, 'chrome', w=0.12, h=0.03)
        # A black rubbing strip along the sides.
        line(o, pr, 'side', [(x1 - 0.08, 0.58), (x0 + 0.06, 0.58)], 0.04, 'black', 0.006, both=True)
        # Black trim along the bottom of the windows.
        line(o, prg, 'side', along(p['shoulder'], 0.68, -2.15, 16, -0.003), 0.014, 'black', 0.003, both=True)
        line(o, pr, 'side', rounded(rrect_pts((-1.85, 0.84), 0.15, 0.11, 0.02, 2), 1), 0.006, 'gap', 0.0015, closed=True)
    rails(o, res, p, -2.05, -0.2, 0.07)
    cowl(o, res, pr, p, w=0.74)


@car
def wagon240(res):
    return closed_car(res, wagon240_params())


# ------------------------------------------------------------------ Kaido Trail4 (RAV4)

def rav4_params():
    L, W = 4.6, 1.86
    x0, x1 = -L / 2, L / 2
    xf, xr = 1.37, -1.32
    R = 0.36
    ws, bl = 0.75, x0 + 0.15
    p = dict(
        L=L, W=W, xf=xf, xr=xr, R=R, tyre_w=0.235, track=1.6, arch_gap=0.05, rim='multi', spokes=5, color=0x6a7a5a,
        tyre='road', arch_flat=0.7,
        bottom=C((x0, 0.5), (x0 + 0.1, 0.38), (x0 + 0.4, 0.28), (xr - 0.3, 0.24), (xr, 0.23), (xf, 0.23), (xf + 0.4, 0.27), (x1 - 0.1, 0.33), (x1, 0.42)),
        shoulder=C((x0, 1.08), (x0 + 0.05, 1.11), (x0 + 0.25, 1.13), (-1.5, 1.12), (-0.4, 1.08), (0.7, 1.05), (1.3, 1.0), (1.9, 0.955), (x1 - 0.06, 0.925), (x1, 0.89)),
        top=C((x0, 1.1), (x0 + 0.05, 1.14), (x0 + 0.25, 1.15), (-1.8, 1.15), (0.75, 1.075), (1.3, 1.035), (1.9, 0.985), (x1 - 0.06, 0.95), (x1, 0.91)),
        width=C((x0, 0.9), (-1.5, 0.93), (1.4, 0.93), (x1, 0.9)),
        tuck=const(0.05), tumble=const(0.06), cfrac=const(0.62),
        rb=const(0.06), rs=const(0.05),
        front=(0.3, 3.2), rear=(0.24, 3.4),
        flares=[(xf, 0.6, 0.02, 0.55, 0.3), (xr, 0.6, 0.02, 0.55, 0.3)],
        open=[(-1.45, ws - 0.02, 0.36)],
        bl_base=bl, ws_base=ws, inset=0.03,
        roof_z=C((bl, 1.13), (-2.05, 1.3), (-1.95, 1.45), (-1.85, 1.56), (-1.7, 1.64), (-1.2, 1.665), (-0.4, 1.67), (0.0, 1.65), (0.2, 1.56), (0.4, 1.39), (0.6, 1.22), (ws, 1.1)),
        rail_z=C((bl, 1.12), (-2.05, 1.28), (-1.95, 1.42), (-1.85, 1.525), (-1.7, 1.6), (-1.2, 1.62), (-0.4, 1.625), (0.0, 1.605), (0.2, 1.52), (0.4, 1.355), (0.6, 1.195), (ws, 1.08)),
        rail_w=C((bl, 0.76), (-1.2, 0.75), (0.0, 0.75), (ws, 0.82)),
        corner=C((-1.0, 0.06), (0.1, 0.055), (0.6, 0.045)),
        lines=[(-2.05, -2.05), (-1.95, -1.95), (-1.86, -1.72), (-1.35, -1.33), (-1.25, -1.23), (-0.4, -0.37), (-0.3, -0.27), (0.6, 0.48)],
        mirror=(0.62, 0.9, 1.1),
        keys=[-2.0],
    )
    cabin(p, ws, seats=5, z=0.12)
    b = p['benches'][0]
    p['more_seats'] = [(b[0], 0.0, b[2])]
    p['glass_region'] = windows(p, 0.02, -1.8, [(0.6, 9, 'black'), (-0.4, -0.3, 'gloss'), (-1.35, -1.25, 'gloss'), (-9, -1.86, 'paint')])
    p['decor'] = rav4_decor
    return p


def rav4_decor(o, res, pr, prg, hull, p):
    L = p['L']
    x0, x1 = -L / 2, L / 2
    # Angular headlights sweeping up and back from the grille.
    hf = aim((x1 - 0.16, 0.6, 0.86), 0.75, 0.12)
    head = [(-0.24, -0.02), (0.02, -0.06), (0.24, -0.035), (0.3, 0.035), (0.1, 0.05), (-0.25, 0.03)]
    lamp(o, pr, hf, rounded(head, 1), 'head', res, 'gloss', 0.008, 0.006, bw=0.012)
    if res:
        line(o, pr, hf, [(-0.22, 0.02), (0.08, 0.035), (0.27, 0.025)], 0.009, 'white', 0.016, both=True)
        for s in (-0.12, 0.0, 0.12):
            lamp(o, pr, hf, circle_pts((s, -0.012), 0.022, 8), 'chrome', res, None, 0.004, 0.016, rings=2)
    # A slot grille between the lamps and the big octagonal lower grille below it.
    flat(o, pr, 'front', [(-0.42, 0.8), (0.42, 0.8), (0.46, 0.875), (-0.46, 0.875)], 'grille', 0.004, bezel=(0.008, 'gloss', 0.003), res=res)
    octa = [(-0.42, 0.74), (0.42, 0.74), (0.56, 0.64), (0.56, 0.5), (0.46, 0.42), (-0.46, 0.42), (-0.56, 0.5), (-0.56, 0.64)]
    flat(o, pr, 'front', octa, 'grille', 0.004, bezel=(0.02, 'gloss', 0.003), res=res)
    if res:
        for z in (0.69, 0.64, 0.59, 0.54, 0.49):
            line(o, pr, 'front', [(-0.5, z), (0.5, z)], 0.01, 'gloss', 0.006)
    plate(o, pr, 'front', (0.0, 0.58))
    # Silver skid plate and black corner intakes.
    flat(o, pr, 'front', [(-0.4, 0.33), (0.4, 0.33), (0.44, 0.4), (-0.44, 0.4)], 'rim', 0.007, res=res)
    fv = aim((x1 - 0.18, 0.68, 0.58), 0.6, 0.0)
    flat(o, pr, fv, [(-0.07, 0.1), (0.07, 0.06), (0.06, -0.1), (-0.06, -0.08)], 'grille', 0.004, both=True, bezel=(0.012, 'gloss', 0.003), res=res)

    # Angular tail lamps on the corners, the tailgate, a roof spoiler over the back window.
    tf = aim((x0 + 0.14, 0.66, 1.03), math.pi - 0.85, 0.05)
    tail = [(0.28, -0.05), (0.28, 0.045), (-0.05, 0.05), (-0.26, 0.02), (-0.24, -0.02), (0.05, -0.04)]
    lamp(o, pr, tf, rounded(tail, 1), 'tail', res, 'gloss', 0.006, 0.006, bw=0.008)
    if res:
        line(o, pr, tf, [(0.22, 0.02), (-0.2, 0.0)], 0.01, 'red', 0.013, both=True)
        lamp(o, pr, tf, rounded(rrect_pts((0.18, -0.02), 0.08, 0.02, 0.006, 1), 1), 'white', res, None, 0.002, 0.014)
    plate(o, pr, 'rear', (0.0, 0.84))
    flat(o, pr, 'rear', [(-0.5, 0.36), (0.5, 0.36), (0.46, 0.43), (-0.46, 0.43)], 'rim', 0.008, res=res)
    sx = -1.86
    o.body.extend(rbox((sx, 0, p['roof_z'](sx) - 0.005), (0.08, 0.64, 0.022), 0.016, 'black', 2 if res else 1))
    if res:
        tailgate(o, pr, 0.62, 1.12, 0.6, 0.64)
        doors(o, pr, p, [(0.62, 1.14), (0.64, 0.9), (0.62, 0.62), (0.6, 0.45)], -0.35, -1.28, sill=0.45)
        gaps(o, pr, [[(0.75, 0.78), (1.4, 0.76), (2.0, 0.7), (2.2, 0.55)]], frame='top')
        line(o, pr, 'side', rounded(rrect_pts((-1.82, 1.0), 0.15, 0.11, 0.03, 2), 1), 0.006, 'gap', 0.0015, closed=True)
        for (x, z) in ((-0.02, 1.02), (-1.05, 1.05)):
            handle(o, pr, x, z, 'paint')
    # Chunky black cladding: square-ish bands round the arches, along the sills and the bumpers.
    R = p['R']
    r = R + 0.08
    for xc in (p['xf'], p['xr']):
        arch = [(xc + r + 0.03, 0.36), (xc + r, R + 0.12), (xc + 0.62 * r, R + r), (xc - 0.62 * r, R + r), (xc - r, R + 0.12), (xc - r - 0.03, 0.36)]
        line(o, pr, 'side', arch, 0.14, 'black', 0.006, both=True)
    line(o, pr, 'side', [(p['xf'] - r - 0.03, 0.34), (p['xr'] + r + 0.03, 0.34)], 0.2, 'black', 0.006, both=True)
    flat(o, pr, 'rear', [(-0.72, 0.33), (0.72, 0.33), (0.72, 0.5), (-0.72, 0.5)], 'black', 0.004, res=res, rings=1)
    flat(o, pr, 'front', [(-0.72, 0.3), (0.72, 0.3), (0.72, 0.41), (-0.72, 0.41)], 'black', 0.003, res=res, rings=1)
    rails(o, res, p, -1.75, -0.15, 0.08)
    cowl(o, res, pr, p, w=0.76)


@car
def rav4(res):
    return closed_car(res, rav4_params())
