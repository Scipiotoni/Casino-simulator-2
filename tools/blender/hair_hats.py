"""
Hairstyles and hats for the Casino Simulator 2 characters, modelled in Blender.

Hair is sculpted as metaball volumes over the skull (a shell a couple of centimetres thick,
fringes, quiffs, spikes, buns, tails), fused with a voxel remesh and trimmed with boolean
cutters along the hairline, round the ears and at the nape, so the cut edge shows the
hair's thickness like a game character's. Hats are lathed and bent shapes, solidified and
subdivided. Everything is a rigid mesh that rides on the head bone, in model space, with
its colour regions in the u of its UVs (0 = main colour, 1 = second colour such as a hat
band or a hair tie, 2 = accent or glow, 3 = darkened skin for shaved sides).
"""
import math

from common import (Sculpt, box_mesh, clean, decimate, ellipsoid_mesh, finish, join, lathe, remove, sculpt_mesh,
                    set_region, snap_regions, subtract)

HAIRS = ['buzz', 'short', 'spiky', 'quiff', 'mohawk', 'afro', 'long', 'ponytail', 'bun', 'bob', 'braids']
HATS = ['cap', 'beanie', 'tophat', 'cowboy', 'helmet', 'fedora', 'visor', 'beret', 'crown', 'headset', 'bandana']


def head(f):
    """Skull centre, half extents and head width (must match build_characters.sculpt_body)."""
    hw = 0.11 if f else 0.114
    return (0.0, 1.676, 0.004), (hw, 0.124, 0.12)


# ------------------------------------------------------------------ hair

def face_cut(f, top=1.752, wide=0.094, low=False):
    """The face: everything in front below the hairline (a rounded forehead line, temples)."""
    c, h = head(f)
    return ellipsoid_mesh((0, top - 0.155, 0.112), (wide, 0.155, 0.125 if not low else 0.14))


def nape_cut(f, back=1.6, front=1.668):
    """Everything below the line from the nape to just in front of the ears."""
    slope = math.atan2(front - back, 0.2)
    return box_mesh((0, (back + front) / 2 - 0.25, -0.02), (0.4, 0.25, 0.3), rx=-slope)


def ear_cuts(f):
    c, h = head(f)
    return [ellipsoid_mesh((s * (h[0] + 0.006), 1.652, -0.006), (0.034, 0.042, 0.036)) for s in (-1, 1)]


HEAD = {}


def set_head(f, ob):
    """The modelled head (and neck) of the body, closed underneath: hair is built over it."""
    HEAD[f] = ob


def offset_head(f, grow, up=0.0, name='HeadOffset'):
    """A copy of the modelled head pushed out (or in) along its normals by `grow` metres."""
    import bmesh
    import bpy
    from common import link
    bm = bmesh.new()
    bm.from_mesh(HEAD[f].data)
    bm.normal_update()
    for v in bm.verts:
        v.co += v.normal * grow
        v.co.z += up
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me))


def core(f):
    """Just under the head's skin: subtracted, it leaves the hair a shell over the head."""
    return offset_head(f, -0.0025, name='Core')


def shell(sc, f, grow, up=0.0, back=0.0):
    """Hair hugging the head `grow` metres thick (fused with the sculpt's other volumes)."""
    if not hasattr(sc, 'extra'):
        sc.extra = []
    sc.extra.append(offset_head(f, grow, up))


def hair_style(style, f):
    """The finished hair mesh for a style (regions set), or None for bald."""
    c, h = head(f)
    hw = h[0]
    top = c[1] + h[1]
    main = Sculpt('Hair', 0.006)
    pieces = []
    cuts = None
    if style == 'buzz':
        shell(main, f, 0.008)
        cuts = [face_cut(f, top=1.758), nape_cut(f), *ear_cuts(f)]
    elif style == 'short':
        shell(main, f, 0.016)
        # A side-swept fringe and a little lift on top.
        main.ellipsoid((0.025, top - 0.005, 0.075), (0.075, 0.035, 0.05), rot=_rx(-0.4))
        main.ellipsoid((-0.01, top + 0.002, 0.01), (0.09, 0.03, 0.09))
        cuts = [face_cut(f), nape_cut(f), *ear_cuts(f)]
    elif style == 'spiky':
        shell(main, f, 0.016)
        for i, (ax, az, tilt) in enumerate([(0, 0.07, 0.5), (0.06, 0.04, 0.4), (-0.06, 0.04, 0.4), (0.0, -0.01, 0.15), (0.07, -0.03, 0.2),
                                            (-0.07, -0.03, 0.2), (0.0, -0.07, -0.3), (0.05, -0.08, -0.4), (-0.05, -0.08, -0.4)]):
            base = (ax, top - 0.01 - abs(az) * 0.15, az)
            tip = (ax * 1.5, top + 0.09 - abs(ax) * 0.4, az + tilt * 0.08)
            main.taper(base, tip, 0.04, 0.008, 4)
        cuts = [face_cut(f), nape_cut(f), *ear_cuts(f)]
    elif style == 'quiff':
        shell(main, f, 0.016)
        main.ellipsoid((0, top + 0.02, 0.06), (0.08, 0.05, 0.075), rot=_rx(0.45))
        main.ellipsoid((0, top + 0.04, 0.105), (0.065, 0.04, 0.05), rot=_rx(0.7))
        cuts = [face_cut(f, top=1.762), nape_cut(f), *ear_cuts(f)]
    elif style == 'mohawk':
        # A ridge down the middle of the skull with a row of swept-back spikes.
        for i in range(7):
            a = -0.85 + i * 0.3  # along the top of the skull, back (-) to front (+)
            y = c[1] + math.cos(a) * h[1]
            z = c[2] + math.sin(a) * h[2]
            n = (math.cos(a), math.sin(a))
            main.ellipsoid((0, y + n[0] * 0.012, z + n[1] * 0.012), (0.024, 0.03, 0.04), rot=_rx(-a))
            ln = 0.075 - abs(a - 0.15) * 0.02
            tip = (0, y + n[0] * ln, z + n[1] * ln - 0.035)
            main.taper((0, y, z), tip, 0.026, 0.006, 4)
        stubble = Sculpt('Stubble', 0.006)
        shell(stubble, f, 0.003)
        sb = sculpt_mesh([stubble], voxel=0.004, smooth=2, name='Stubble')
        lean = decimate(sb, 1600, name='StubbleLean')
        remove(sb)
        sb = lean
        sb = subtract(sb, [core(f), face_cut(f, top=1.758), nape_cut(f), *ear_cuts(f)])
        set_region(sb, 3)
        pieces.append(sb)
        cuts = [face_cut(f, top=1.758)]
    elif style == 'afro':
        main.ellipsoid((0, c[1] + 0.06, c[2] - 0.012), (hw + 0.065, 0.165, 0.17))
        cuts = [face_cut(f, top=1.748, wide=0.098), nape_cut(f, back=1.585, front=1.63)]
    elif style == 'long':
        shell(main, f, 0.018)
        main.ellipsoid((0.02, top - 0.008, 0.07), (0.08, 0.035, 0.05), rot=_rx(-0.4))
        # Down the back to the shoulder blades, and a lock each side framing the face.
        main.ellipsoid((0, 1.6, -0.07), (hw + 0.02, 0.13, 0.08))
        main.ellipsoid((0, 1.46, -0.115), (hw * 0.95, 0.09, 0.05))
        for s in (-1, 1):
            main.ellipsoid((s * (hw + 0.004), 1.585, 0.02), (0.03, 0.115, 0.055))
        cuts = [face_cut(f, wide=0.09), box_mesh((0, 1.2, 0), (0.4, 0.2, 0.4))]
    elif style == 'ponytail':
        shell(main, f, 0.013)
        main.ellipsoid((0.02, top - 0.006, 0.075), (0.07, 0.03, 0.045), rot=_rx(-0.4))
        tail = Sculpt('Tail', 0.006)
        tail.chain([(0, 1.72, -0.13), (0, 1.66, -0.19), (0, 1.55, -0.2), (0, 1.45, -0.17)], 0.042, 0.016, 3)
        tm = sculpt_mesh([tail], voxel=0.004, smooth=3, name='Tail')
        set_region(tm, 0)
        pieces.append(tm)
        pieces.append(_band((0, 1.705, -0.15), 0.03, 0.022, -0.9))
        cuts = [face_cut(f), nape_cut(f), *ear_cuts(f)]
    elif style == 'bun':
        shell(main, f, 0.013)
        main.ellipsoid((0.02, top - 0.006, 0.075), (0.07, 0.03, 0.045), rot=_rx(-0.4))
        bun = Sculpt('Bun', 0.006)
        bun.ellipsoid((0, top + 0.025, -0.055), (0.062, 0.055, 0.062))
        bm = sculpt_mesh([bun], voxel=0.004, smooth=3, name='BunBall')
        set_region(bm, 0)
        pieces.append(bm)
        pieces.append(_band((0, top - 0.012, -0.05), 0.045, 0.012, 0.5))
        cuts = [face_cut(f), nape_cut(f), *ear_cuts(f)]
    elif style == 'bob':
        shell(main, f, 0.02)
        main.ellipsoid((0, 1.655, -0.01), (hw + 0.034, 0.13, 0.13))
        cuts = [face_cut(f, top=1.712, wide=0.09, low=True), box_mesh((0, 1.56 - 0.2, 0), (0.4, 0.2, 0.4))]
    elif style == 'braids':
        shell(main, f, 0.013)
        main.ellipsoid((0.02, top - 0.006, 0.075), (0.07, 0.03, 0.045), rot=_rx(-0.4))
        for s in (-1, 1):
            br = Sculpt('Braid', 0.006)
            for i in range(6):
                t = i / 5
                br.ellipsoid((s * (hw + 0.012 + t * 0.012), 1.64 - t * 0.21, -0.03 + t * 0.06), (0.026, 0.03, 0.026))
            bm = sculpt_mesh([br], voxel=0.004, smooth=2, name='Braid')
            set_region(bm, 0)
            pieces.append(bm)
            pieces.append(_band((s * (hw + 0.024), 1.405, 0.03), 0.02, 0.014, 0))
        cuts = [face_cut(f), nape_cut(f), *ear_cuts(f)]
    else:
        remove(main.ob)
        return None
    mesh = sculpt_mesh([main], voxel=0.004, smooth=4, name='HairMain')
    # Thin it down before the cuts, so the cut edges stay clean; hollow it (hair is a shell
    # over the head), then trim the hairline.
    lean = decimate(mesh, 2400, name='HairLean', symmetric=style not in ('short', 'long', 'ponytail', 'bun', 'braids'))
    remove(mesh)
    mesh = subtract(lean, [core(f)] + (cuts or []))
    set_region(mesh, 0)
    out = join('Hair_' + style, [mesh, *pieces])
    clean(out, sharp=1.0)
    return out


def _band(c, r, h, rx):
    """A hair tie: a short fat ring."""
    ob = lathe('Band', [(0.8, -h / 2), (1.0, -h / 2), (1.0, h / 2), (0.8, h / 2)], r, r, 0, seg=16,
               deform=_tilt(c, rx))
    ob = finish(ob, solid=0.004)
    set_region(ob, 1)
    return ob


def _rx(a):
    from mathutils import Quaternion
    return Quaternion((1, 0, 0), a)


def _tilt(c, rx):
    """Deform: rotate about game x by rx, then move to c."""
    cs, sn = math.cos(rx), math.sin(rx)

    def d(x, y, z):
        return c[0] + x, c[1] + y * cs - z * sn, c[2] + y * sn + z * cs
    return d


# ------------------------------------------------------------------ hats

def hat(name, f):
    c, h = head(f)
    hw = h[0]
    k = hw / 0.114  # hats are drawn for the wider head and narrowed to fit
    parts = []

    def add(ob, region, solid=0.006, subdiv=1):
        ob = finish(ob, solid=solid, subdiv=subdiv, sharp=1.2)
        set_region(ob, region)
        parts.append(ob)

    if name == 'cap':
        y0 = 1.712
        tilt = lambda x, y, z: (x, y - 0.05 * z, z)
        add(lathe('Crown', [(1.0, 0), (0.995, 0.03), (0.96, 0.06), (0.88, 0.085), (0.72, 0.104), (0.5, 0.116), (0.25, 0.121), (0, 0.122)],
                  0.136 * k, 0.146, y0, seg=28, deform=tilt), 0)
        bill = lambda r, a: 0.98 + (r - 0.98) * max(0.0, math.cos(a)) ** 0.8
        add(lathe('Bill', [(0.97, 0.0), (1.25, -0.006), (1.5, -0.016), (1.62, -0.024)], 0.136 * k, 0.146, y0, seg=20,
                  phi=(-1.45, 1.45), rfun=bill, deform=lambda x, y, z: tilt(x, y - 0.6 * x * x, z)), 1, solid=0.008)
        add(lathe('Button', [(0, 0), (0.7, 0.004), (1, 0.01), (0.7, 0.016), (0, 0.018)], 0.013, 0.013, y0 + 0.118, seg=10), 2, solid=0, subdiv=0)
    elif name == 'beanie':
        y0 = 1.668
        add(lathe('Dome', [(1.0, 0), (1.0, 0.05), (0.96, 0.09), (0.86, 0.13), (0.66, 0.16), (0.36, 0.178), (0, 0.183)], 0.134 * k, 0.144, y0, seg=28), 0)
        add(lathe('Cuff', [(1.0, -0.004), (1.07, 0.0), (1.08, 0.03), (1.07, 0.058), (1.0, 0.062)], 0.134 * k, 0.144, y0, seg=28), 1, solid=0.005)
        add(lathe('Pom', [(0, 0), (0.6, 0.006), (0.95, 0.025), (1.0, 0.04), (0.8, 0.06), (0, 0.075)], 0.04, 0.04, y0 + 0.17, seg=14), 2, solid=0, subdiv=1)
    elif name == 'tophat':
        y0 = 1.755
        curl = lambda x, y, z: (x, y + 0.035 * (x / 0.18) ** 2, z)
        add(lathe('Brim', [(0.92, 0), (1.3, 0.0), (1.62, 0.012), (1.7, 0.022)], 0.108 * k, 0.12, y0, seg=32, deform=curl), 0)
        add(lathe('Crown', [(1.0, 0), (0.98, 0.06), (0.99, 0.14), (1.05, 0.2), (1.04, 0.207), (0.7, 0.212), (0, 0.212)], 0.1 * k, 0.112, y0, seg=32), 0, solid=0.005)
        add(lathe('Band', [(1.012, 0.006), (1.01, 0.05)], 0.1 * k, 0.112, y0, seg=32), 1, solid=0.004, subdiv=0)
    elif name == 'cowboy':
        y0 = 1.745

        def brim(x, y, z):
            return x, y + 0.075 * min(1.0, abs(x) / 0.25) ** 3 - 0.012 * (z / 0.27) ** 2, z
        add(lathe('Brim', [(0.95, 0), (1.4, -0.004), (1.9, 0.004), (2.2, 0.03)], 0.112 * k, 0.122, y0, seg=36, deform=brim), 0, solid=0.007)

        def crease(x, y, z):
            dent = 0.024 * max(0.0, 1 - abs(x) / 0.06) * max(0.0, (y - y0 - 0.06) / 0.075)
            return x, y - dent, z
        add(lathe('Crown', [(1.0, 0), (0.97, 0.06), (0.92, 0.11), (0.8, 0.135), (0.5, 0.13), (0, 0.118)], 0.108 * k, 0.12, y0, seg=32, deform=crease), 0)
        add(lathe('Band', [(1.0, 0.006), (0.985, 0.032)], 0.112 * k, 0.124, y0, seg=32), 1, solid=0.004, subdiv=0)
    elif name == 'helmet':
        y0 = 1.655
        add(lathe('Shell', [(1.1, -0.005), (1.11, 0.0), (1.07, 0.035), (1.0, 0.07), (0.88, 0.12), (0.65, 0.16), (0.35, 0.18), (0, 0.185)],
                  0.14 * k, 0.155, y0, seg=32, deform=lambda x, y, z: (x, y + 0.03 * max(0, -z) / 0.15, z)), 0, solid=0.008)
        add(lathe('Rim', [(1.1, -0.012), (1.13, -0.006), (1.13, 0.006), (1.1, 0.01)], 0.14 * k, 0.155, y0, seg=32,
                  deform=lambda x, y, z: (x, y + 0.03 * max(0, -z) / 0.15, z)), 1, solid=0.004)
    elif name == 'fedora':
        y0 = 1.75

        def snap(x, y, z):
            return x, y - 0.022 * max(0.0, z) / 0.2 + 0.014 * max(0.0, -z) / 0.2, z
        add(lathe('Brim', [(0.95, 0), (1.35, -0.002), (1.68, 0.008), (1.75, 0.018)], 0.108 * k, 0.12, y0, seg=32, deform=snap), 0)

        def pinch(x, y, z):
            up = max(0.0, (y - y0) / 0.12)
            x *= 1 - 0.18 * max(0.0, z / 0.12) * up
            dent = 0.02 * max(0.0, 1 - abs(x) / 0.05) * max(0.0, (y - y0 - 0.06) / 0.06)
            return x, y - dent, z
        add(lathe('Crown', [(1.0, 0), (0.96, 0.06), (0.9, 0.1), (0.78, 0.12), (0.4, 0.115), (0, 0.105)], 0.1 * k, 0.112, y0, seg=32, deform=pinch), 0)
        add(lathe('Band', [(1.012, 0.006), (0.99, 0.034)], 0.1 * k, 0.112, y0, seg=32), 1, solid=0.004, subdiv=0)
    elif name == 'visor':
        y0 = 1.718
        tilt = lambda x, y, z: (x, y - 0.04 * z, z)
        add(lathe('Band', [(1.02, 0), (1.03, 0.032)], 0.13 * k, 0.14, y0, seg=28, deform=tilt), 0, solid=0.005)
        bill = lambda r, a: 1.0 + (r - 1.0) * max(0.0, math.cos(a)) ** 0.8
        add(lathe('Bill', [(1.0, 0.0), (1.3, -0.008), (1.6, -0.02)], 0.13 * k, 0.14, y0, seg=20, phi=(-1.4, 1.4), rfun=bill,
                  deform=lambda x, y, z: tilt(x, y - 0.6 * x * x, z)), 0, solid=0.007)
    elif name == 'beret':
        y0 = 1.752
        ang = 0.28
        cs, sn = math.cos(ang), math.sin(ang)

        def lean(x, y, z):
            yy = y - y0
            return x * cs - yy * sn - 0.01, y0 + x * sn + yy * cs, z
        add(lathe('Beret', [(0.86, 0), (1.0, 0.012), (1.2, 0.03), (1.22, 0.045), (1.1, 0.06), (0.6, 0.075), (0, 0.08)], 0.118 * k, 0.122, y0, seg=28, deform=lean), 0)
        add(lathe('Nub', [(0, 0), (1, 0.0), (0.8, 0.015), (0, 0.018)], 0.012, 0.012, y0 + 0.078, seg=8, deform=lambda x, y, z: lean(x, y, z)), 0, solid=0, subdiv=0)
    elif name == 'crown':
        y0 = 1.758

        def points(x, y, z):
            if y > y0 + 0.04:
                a = math.atan2(x, z)
                y += 0.055 * max(0.0, math.cos(3 * a)) ** 6
            return x, y, z
        add(lathe('Crown', [(1.0, 0), (1.0, 0.045), (1.0, 0.05)], 0.104 * k, 0.112, y0, seg=96, deform=points), 0, solid=0.006, subdiv=0)
        for i in range(6):
            a = i * math.pi / 3
            x, z = math.sin(a) * 0.106 * k, math.cos(a) * 0.114
            add(lathe('Jewel', [(0, -0.01), (1, 0), (0, 0.01)], 0.011, 0.011, 0, seg=8,
                      deform=lambda px, py, pz, x=x, z=z: (x + px, y0 + 0.024 + py, z + pz)), 2, solid=0, subdiv=1)
    elif name == 'headset':
        sc = Sculpt('Headset', 0.005)
        arc = [(math.cos(t) * (hw + 0.026), 1.676 + math.sin(t) * 0.15, -0.012) for t in [i * math.pi / 8 for i in range(9)]]
        sc.chain(arc, 0.011, 0.011, 2)
        for s in (-1, 1):
            sc.ellipsoid((s * (hw + 0.026), 1.655, -0.004), (0.022, 0.042, 0.042))
        sc.chain([(hw + 0.03, 1.64, 0.02), (hw + 0.01, 1.6, 0.09), (0.04, 1.594, 0.13)], 0.005, 0.005, 2)
        ob = sculpt_mesh([sc], voxel=0.003, smooth=3, name='Headset')
        set_region(ob, 0)
        parts.append(ob)
        add(lathe('Mic', [(0, -0.01), (1, -0.006), (1, 0.006), (0, 0.01)], 0.011, 0.011, 0, seg=10,
                  deform=lambda x, y, z: (0.035 + x, 1.594 + y, 0.132 + z)), 2, solid=0, subdiv=1)
    elif name == 'bandana':
        y0 = 1.695
        tilt = lambda x, y, z: (x, y - 0.06 * z, z)
        add(lathe('Wrap', [(1.0, 0), (0.99, 0.04), (0.94, 0.08), (0.8, 0.12), (0.55, 0.15), (0.25, 0.165), (0, 0.168)], 0.132 * k, 0.142, y0, seg=28, deform=tilt), 0, solid=0.005)
        sc = Sculpt('Knot', 0.005)
        sc.ellipsoid((0, 1.712, -0.15), (0.03, 0.022, 0.02))
        sc.chain([(0.01, 1.705, -0.155), (0.03, 1.64, -0.18), (0.045, 1.6, -0.18)], 0.016, 0.01, 2)
        sc.chain([(-0.01, 1.705, -0.155), (-0.03, 1.65, -0.175), (-0.04, 1.615, -0.17)], 0.016, 0.01, 2)
        ob = sculpt_mesh([sc], voxel=0.003, smooth=3, name='Knot')
        set_region(ob, 0)
        parts.append(ob)
    else:
        return None
    out = join('Hat_' + name, parts)
    clean(out, sharp=1.2)
    return out


def build_all(f, hair_tris=2000, hat_tris=1300, lo_tris=320):
    """Every hairstyle and hat, each with a low-detail copy (name + '_lo')."""
    made = []
    for style in HAIRS:
        ob = hair_style(style, f)
        if ob is None:
            continue
        made.append(_with_low(ob, hair_tris, lo_tris))
    for name in HATS:
        ob = hat(name, f)
        if ob is None:
            continue
        made.append(_with_low(ob, hat_tris, lo_tris))
    return made


def _with_low(ob, hi, lo):
    name = ob.name
    ob.name = name + '_src'
    full = decimate(ob, hi, name=name, symmetric=False)
    remove(ob)
    low = decimate(full, lo, name=name + '_lo', symmetric=False)
    for o in (full, low):
        snap_regions(o)
        clean(o, sharp=1.0)
    return full, low
