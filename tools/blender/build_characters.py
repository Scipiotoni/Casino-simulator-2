"""
Builds the characters for Casino Simulator 2 in Blender and exports them as glTF.

Run with Blender's Python module (pip install bpy) or Blender itself:
    python tools/blender/build_characters.py [out_dir] [--render]

For each body type (m, f) it sculpts one continuous body out of metaballs in a simple hero
style (broad shoulders, big hands and trainers, a slightly large head), fuses them with a
voxel remesh into a single watertight surface, decimates it to a high and a low level of
detail and rigs it with an armature whose joints match the game's skeleton
(src/chars/model.ts, restPose) using Blender's automatic weights.

Clothes are regions of that one surface: the mesh is cut along clean lines (neckline,
V-neck, waistband, sleeve lengths, cuffs, shorts and trouser hems, boot tops, shoe line,
sole) and each face is tagged with its region in the u of its UVs, so an outfit is a
colour per region with crisp edges and nothing that can gap at the joints.

It also models every hairstyle and hat (hair_hats.py), adds a face patch (UV-mapped for
the painted face) and a skirt, and exports it all in the game's model space: y up, the
character facing +z, its left at +x.
"""
import math
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402  (first of Blender's modules)
import bmesh  # noqa: E402
from mathutils import Quaternion, Vector  # noqa: E402

from common import B, G, Sculpt, clean, decimate, link, remove, sculpt_mesh  # noqa: E402
import hair_hats  # noqa: E402

OUT = next((a for a in sys.argv[1:] if not a.startswith('--') and not a.endswith('.py')), 'src/chars/assets')
RENDER = '--render' in sys.argv
PREVIEWS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'previews')


def rest_pose(f):
    sh = 0.192 if f else 0.212
    hip = 0.098 if f else 0.094
    return {
        'root': (0, 0, 0), 'hips': (0, 0.96, 0), 'spine': (0, 1.1, 0), 'chest': (0, 1.28, 0), 'neck': (0, 1.49, 0), 'head': (0, 1.57, 0.005),
        'upperArmL': (sh, 1.43, 0), 'foreArmL': (sh + 0.02, 1.15, -0.005), 'handL': (sh + 0.035, 0.89, 0.01),
        'upperArmR': (-sh, 1.43, 0), 'foreArmR': (-sh - 0.02, 1.15, -0.005), 'handR': (-sh - 0.035, 0.89, 0.01),
        'thighL': (hip, 0.93, 0), 'shinL': (hip + 0.005, 0.51, 0.012), 'footL': (hip + 0.008, 0.085, -0.01),
        'thighR': (-hip, 0.93, 0), 'shinR': (-hip - 0.005, 0.51, 0.012), 'footR': (-hip - 0.008, 0.085, -0.01),
    }


PARENT = {
    'root': None, 'hips': 'root', 'spine': 'hips', 'chest': 'spine', 'neck': 'chest', 'head': 'neck',
    'upperArmL': 'chest', 'foreArmL': 'upperArmL', 'handL': 'foreArmL',
    'upperArmR': 'chest', 'foreArmR': 'upperArmR', 'handR': 'foreArmR',
    'thighL': 'hips', 'shinL': 'thighL', 'footL': 'shinL',
    'thighR': 'hips', 'shinR': 'thighR', 'footR': 'shinR',
}

# The colour regions, in the order the game reads them (src/chars/model.ts, REGION).
REGIONS = ['head', 'neck', 'vneck', 'chest', 'placket', 'belly', 'belt', 'pelvis',
           'shoulder', 'upperarm', 'forearm', 'hand', 'thigh', 'lowthigh', 'shin', 'calf', 'foot', 'sole']
RID = {n: i for i, n in enumerate(REGIONS)}

# Where the clothes' edges run (game metres).
NECKLINE = 1.505
V_BOTTOM = 1.15
V_SLOPE = 0.3  # half-width of the V per metre up
CHEST_LINE = 1.17
BELT_TOP = 1.0
BELT_BOTTOM = 0.965
PLACKET = 0.032
SLEEVE = 0.42  # short sleeves end this far down the upper arm
SHORTS = 0.55  # shorts end this far down the thigh
CALF = 0.5  # boots come this far up the shin
SOLE = 0.03


def sculpt_body(f):
    """Metaball families: torso and head, two arms, two legs (separate so the limbs stay distinct)."""
    R = rest_pose(f)
    torso = Sculpt('Torso')
    if f:
        torso.ellipsoid((0, 0.93, -0.008), (0.172, 0.105, 0.115))
        torso.ellipsoid((0, 1.06, 0), (0.122, 0.085, 0.086))
        torso.ellipsoid((0, 1.17, 0.004), (0.132, 0.075, 0.092))
        torso.ellipsoid((0, 1.29, 0.004), (0.128, 0.095, 0.1))
        torso.ellipsoid((0, 1.405, -0.006), (0.155, 0.06, 0.09))
        for s in (-1, 1):
            torso.ellipsoid((s * 0.056, 1.295, 0.06), (0.062, 0.058, 0.05))
            torso.ball((s * 0.178, 1.41, 0), 0.052)
        torso.capsule((0, 1.44, -0.004), (0, 1.585, 0.006), 0.046)
    else:
        torso.ellipsoid((0, 0.935, -0.005), (0.158, 0.1, 0.108))
        torso.ellipsoid((0, 1.06, 0), (0.142, 0.09, 0.098))
        torso.ellipsoid((0, 1.17, 0.006), (0.158, 0.08, 0.106))
        # Narrow enough under the arms that they hang free of the chest (no webbing when raised).
        torso.ellipsoid((0, 1.3, 0.01), (0.14, 0.1, 0.122))
        torso.ellipsoid((0, 1.41, -0.006), (0.192, 0.065, 0.108))
        for s in (-1, 1):
            # Pecs and big rounded shoulders: the heroic V.
            torso.ellipsoid((s * 0.068, 1.315, 0.07), (0.075, 0.06, 0.05))
            torso.ball((s * 0.2, 1.418, 0), 0.066)
        torso.capsule((0, 1.44, -0.004), (0, 1.585, 0.006), 0.056)
    # Head: skull, jaw, chin, nose, brow and ears (hair_hats.head has the same skull).
    (hc, hh) = hair_hats.head(f)
    hw = hh[0]
    torso.ellipsoid(hc, hh)
    torso.ellipsoid((0, 1.6, 0.032), (hw * 0.76, 0.062, 0.082))
    torso.ellipsoid((0, 1.566, 0.07), (0.042, 0.03, 0.04))
    torso.ellipsoid((0, 1.65, 0.112), (0.015, 0.024, 0.016), stiff=1.0)
    torso.ellipsoid((0, 1.712, 0.086), (hw * 0.7, 0.017, 0.028))
    for s in (-1, 1):
        torso.ellipsoid((s * (hw + 0.002), 1.66, -0.004), (0.014, 0.034, 0.024), stiff=3.0)
    sculpts = [torso]
    for side in ('L', 'R'):
        sg = 1 if side == 'L' else -1
        arm = Sculpt('Arm' + side)
        up = R['upperArm' + side]
        el = R['foreArm' + side]
        wr = R['hand' + side]
        ru = 0.05 if f else 0.058
        arm.ball((up[0] - sg * 0.01, up[1] - 0.005, 0), ru * 1.05)
        arm.taper((up[0], up[1] - 0.02, up[2]), el, ru, ru * 0.82)
        arm.ellipsoid((el[0] + sg * 0.004, el[1] - 0.06, el[2]), (ru * 0.84, 0.075, ru * 0.86))
        arm.taper(el, (wr[0], wr[1] + 0.02, wr[2]), ru * 0.8, ru * 0.6)
        # A big hand: palm, fingers together (slightly curled) and a thumb.
        hs = 1.0 if f else 1.1
        arm.ellipsoid((wr[0] + sg * 0.003, wr[1] - 0.055 * hs, wr[2] + 0.006), (0.027 * hs, 0.057 * hs, 0.05 * hs))
        arm.ellipsoid((wr[0] + sg * 0.005, wr[1] - 0.124 * hs, wr[2] + 0.018), (0.023 * hs, 0.047 * hs, 0.046 * hs), rot=Quaternion((1, 0, 0), -0.3))
        arm.capsule((wr[0] - sg * 0.004, wr[1] - 0.03, wr[2] + 0.04), (wr[0] - sg * 0.008, wr[1] - 0.078 * hs, wr[2] + 0.07 * hs), 0.016 * hs)
        leg = Sculpt('Leg' + side)
        th = R['thigh' + side]
        kn = R['shin' + side]
        an = R['foot' + side]
        rt = 0.094 if f else 0.092
        # The top of the thigh reaches up inside the pelvis so the hip join is deep.
        leg.ellipsoid((th[0] + sg * 0.004, th[1] - 0.02, th[2]), (rt * 0.95, 0.09, rt * 0.95))
        leg.taper((th[0], th[1] - 0.06, th[2]), kn, rt, rt * 0.7)
        leg.ellipsoid((kn[0], kn[1] - 0.15, kn[2] - 0.022), (rt * 0.68, 0.13, rt * 0.7))
        leg.taper(kn, (an[0], an[1] + 0.05, an[2]), rt * 0.64, rt * 0.55)
        # A chunky trainer: ankle, toe box and a flat sole on the ground.
        fs = 1.0 if f else 1.08
        leg.ellipsoid((an[0], an[1] + 0.005, an[2] - 0.01), (0.05 * fs, 0.05, 0.055 * fs))
        leg.ellipsoid((an[0] + sg * 0.004, 0.055, an[2] + 0.07 * fs), (0.054 * fs, 0.045, 0.11 * fs))
        leg.ellipsoid((an[0] + sg * 0.003, 0.026, an[2] + 0.05 * fs), (0.056 * fs, 0.026, 0.135 * fs), stiff=3.0)
        sculpts += [arm, leg]
    return R, sculpts


def thin_body(fused, body_tris, head_tris, neck=1.53):
    """
    Decimate the body and the head to separate budgets (the face is where detail shows):
    first everything below the neck with the head held, then the head with the body held.
    """
    in_head = lambda co: co.z > neck
    n_head = sum(len(p.vertices) - 2 for p in fused.data.polygons if p.center.z > neck)
    step = decimate(fused, body_tris + n_head, name='BodyStep', keep=in_head, invert=True)
    out = decimate(step, body_tris + head_tris, name='Body', keep=in_head)
    remove(step)
    return out


def head_of(fused):
    """The head and neck cut off the fused body at the collar and closed underneath."""
    tmp = decimate(fused, 40000, name='HeadSrc')
    bm = bmesh.new()
    bm.from_mesh(tmp.data)
    bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], dist=1e-6,
                           plane_co=B((0, 1.47, 0)), plane_no=B((0, 1, 0)), clear_inner=True)
    edges = [e for e in bm.edges if e.is_boundary]
    bmesh.ops.holes_fill(bm, edges=edges, sides=0)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(tmp.data)
    bm.free()
    tmp.hide_render = True
    tmp.hide_set(True)
    return tmp


def make_armature(R):
    arm_data = bpy.data.armatures.new('Rig')
    arm = link(bpy.data.objects.new('Rig', arm_data))
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    tails = {
        'root': (0, 0, 0.12), 'hips': R['spine'], 'spine': R['chest'], 'chest': R['neck'], 'neck': R['head'], 'head': (0, 1.8, 0.005),
        'thighL': R['shinL'], 'shinL': R['footL'], 'footL': (R['footL'][0], 0.04, 0.15),
        'thighR': R['shinR'], 'shinR': R['footR'], 'footR': (R['footR'][0], 0.04, 0.15),
    }
    for s in ('L', 'R'):
        tails['upperArm' + s] = R['foreArm' + s]
        tails['foreArm' + s] = R['hand' + s]
        h = R['hand' + s]
        tails['hand' + s] = (h[0] + (0.005 if s == 'L' else -0.005), h[1] - 0.16, h[2] + 0.02)
    eb = {}
    for name in R:
        b = arm_data.edit_bones.new(name)
        b.head = B(R[name]) if name != 'root' else Vector((0, 0, 0))
        b.tail = B(tails[name]) if name != 'root' else Vector((0, 0, 0.12))
        eb[name] = b
    for name, parent in PARENT.items():
        if parent:
            eb[name].parent = eb[parent]
            eb[name].use_connect = False
    bpy.ops.object.mode_set(mode='OBJECT')
    arm_data.bones['root'].use_deform = False
    return arm


def rig(mesh, arm):
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    arm.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.parent_set(type='ARMATURE_AUTO')
    # The arms rest hanging down, so aiming or waving raises them a long way: spread the
    # shoulders' weights out so the armpit stretches smoothly instead of in streaks.
    smooth_weights(mesh, lambda g: 1.12 < g.y < 1.55 and 0.08 < abs(g.x) < 0.3, repeat=30)
    limit_weights(mesh)


def smooth_weights(mesh, where, repeat=20):
    """Blur the vertex weights of the vertices `where(game_co)` picks."""
    for v in mesh.data.vertices:
        v.select = where(G(v.co))
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.object.vertex_group_smooth(group_select_mode='ALL', factor=0.6, repeat=repeat, expand=0.3)
    bpy.ops.object.mode_set(mode='OBJECT')


def limit_weights(mesh):
    """Four influences at most, normalised (what the game's skinning uses)."""
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    bpy.ops.object.mode_set(mode='OBJECT')


CLASS_OF_BONE = {'head': 'head', 'neck': 'torso', 'chest': 'torso', 'spine': 'torso', 'hips': 'torso'}
for _s in 'LR':
    for _b in ('upperArm', 'foreArm', 'hand'):
        CLASS_OF_BONE[_b + _s] = 'arm' + _s
    for _b in ('thigh', 'shin', 'foot'):
        CLASS_OF_BONE[_b + _s] = 'leg' + _s
CLASSES = ['head', 'torso', 'armL', 'armR', 'legL', 'legR']


def limb_frames(R):
    """The planes the clothes' edges follow down each arm and leg."""
    V = lambda k: Vector(R[k])
    fr = {}
    for s in 'LR':
        up, el, wr = V('upperArm' + s), V('foreArm' + s), V('hand' + s)
        du = (el - up).normalized()
        df = (wr - el).normalized()
        fr['arm' + s] = {
            'sleeve': (up + (el - up) * SLEEVE, du),
            'elbow': (el, (du + df).normalized()),
            'cuff': (wr - df * 0.012, df),
        }
        th, kn, an = V('thigh' + s), V('shin' + s), V('foot' + s)
        dt = (kn - th).normalized()
        ds = (an - kn).normalized()
        fr['leg' + s] = {
            'shorts': (th + (kn - th) * SHORTS, dt),
            'knee': (kn, (dt + ds).normalized()),
            'calf': (kn + (an - kn) * CALF, ds),
            # The top of the shoe: low at the toe, up round the ankle (normal points up: above = leg).
            'ankle': (Vector((0, 0.125, an.z - 0.05)), Vector((0, 1, 0.25)).normalized()),
        }
    return fr


def armhole(f):
    """Where the sleeve meets the body (above the armpit): a plane each side."""
    sh = 0.192 if f else 0.212
    n = Vector((0.97, 0.24, 0)).normalized()
    return {s: (Vector((s * (sh - 0.03), 1.42, 0)), Vector((s * n.x, n.y, 0))) for s in (-1, 1)}


def region_of(k, c, fr):
    if k == 'head':
        return RID['head']
    if k == 'torso':
        if c.y > NECKLINE:
            return RID['neck']
        if c.z > 0 and c.y > V_BOTTOM and abs(c.x) < (c.y - V_BOTTOM) * V_SLOPE:
            return RID['vneck']
        if c.y > CHEST_LINE:
            return RID['chest']
        if c.y > BELT_TOP:
            return RID['placket'] if c.z > 0 and abs(c.x) < PLACKET else RID['belly']
        if c.y > BELT_BOTTOM:
            return RID['belt']
        return RID['pelvis']
    p = fr[k]
    below = lambda key: (c - p[key][0]).dot(p[key][1]) > 0
    if k.startswith('arm'):
        if not below('elbow'):
            return RID['upperarm'] if below('sleeve') else RID['shoulder']
        return RID['hand'] if below('cuff') else RID['forearm']
    if c.y < SOLE:
        return RID['sole']
    if (c - p['ankle'][0]).dot(p['ankle'][1]) < 0:
        return RID['foot']
    if below('calf'):
        return RID['calf']
    if below('knee'):
        return RID['shin']
    return RID['lowthigh'] if below('shorts') else RID['thigh']


def regionize(ob, R, f):
    """Cut the rigged body along the clothes' edges and tag every face with its region."""
    me = ob.data
    names = [g.name for g in ob.vertex_groups]
    bm = bmesh.new()
    bm.from_mesh(me)
    dl = bm.verts.layers.deform.active
    cls = bm.faces.layers.int.new('cls')
    for fc in bm.faces:
        acc = {}
        for v in fc.verts:
            for gi, w in v[dl].items():
                c = CLASS_OF_BONE.get(names[gi])
                if c:
                    acc[c] = acc.get(c, 0.0) + w
        k = max(acc, key=acc.get) if acc else 'torso'
        # The tops of the thighs up past the hips belong with the body (a straight waistband).
        if k.startswith('leg') and G(fc.calc_center_median()).y > BELT_BOTTOM - 0.01:
            k = 'torso'
        fc[cls] = CLASSES.index(k)

    def cut(which, co, no, pred=None):
        faces = [fc for fc in bm.faces if CLASSES[fc[cls]] in which and (pred is None or pred(G(fc.calc_center_median())))]
        if not faces:
            return
        verts = list({v for fc in faces for v in fc.verts})
        edges = list({e for fc in faces for e in fc.edges})
        bmesh.ops.bisect_plane(bm, geom=verts + edges + faces, dist=1e-6, plane_co=B(co), plane_no=B(no))

    # Armholes: above the armpit the plane decides between sleeve and body.
    for s, (co, no) in armhole(f).items():
        arm = 'armL' if s > 0 else 'armR'
        near = lambda c, s=s: c.y > 1.24 and c.x * s > 0.08
        cut(('torso', arm), co, no, near)
        for fc in bm.faces:
            c = G(fc.calc_center_median())
            if CLASSES[fc[cls]] in ('torso', arm) and near(c):
                fc[cls] = CLASSES.index(arm if (c - co).dot(no) > 0 else 'torso')
    up = (0, 1, 0)
    for y in (NECKLINE, CHEST_LINE, BELT_TOP, BELT_BOTTOM):
        cut(('torso',), (0, y, 0), up)
    for s in (-1, 1):
        d = Vector((s * V_SLOPE, 1, 0)).normalized()
        cut(('torso',), (0, V_BOTTOM, 0), (d.y, -d.x, 0), lambda c: c.z > 0 and V_BOTTOM - 0.05 < c.y < NECKLINE + 0.03)
        cut(('torso',), (s * PLACKET, 1.0, 0), (1, 0, 0), lambda c: c.z > 0 and BELT_TOP - 0.02 < c.y < CHEST_LINE + 0.02)
    fr = limb_frames(R)
    for k, planes in fr.items():
        for key, (co, no) in planes.items():
            pred = (lambda c: c.y < 0.3) if key == 'ankle' else None
            cut((k,), co, no, pred)
        if k.startswith('leg'):
            cut((k,), (0, SOLE, 0), up, lambda c: c.y < 0.1)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    uv = bm.loops.layers.uv.get('UVMap') or bm.loops.layers.uv.new('UVMap')
    counts = [0] * len(REGIONS)
    for fc in bm.faces:
        r = region_of(CLASSES[fc[cls]], G(fc.calc_center_median()), fr)
        counts[r] += 1
        for lp in fc.loops:
            lp[uv].uv = (r + 0.5, 0.5)
    bm.faces.layers.int.remove(cls)
    bm.to_mesh(me)
    bm.free()
    limit_weights(ob)
    return dict(zip(REGIONS, counts))


def bind_rigid(ob, arm, weights):
    """Skin an object to the rig with given weights: callable(co_game) -> {bone: w}."""
    groups = {}
    for v in ob.data.vertices:
        g = G(v.co)
        for bone, w in weights(g).items():
            if w <= 0:
                continue
            if bone not in groups:
                groups[bone] = ob.vertex_groups.new(name=bone)
            groups[bone].add([v.index], w, 'REPLACE')
    ob.parent = arm
    m = ob.modifiers.new('rig', 'ARMATURE')
    m.object = arm


def face_patch(src, arm):
    """The front of the head, lifted a hair off the skin and UV-mapped for the painted face."""
    bm = bmesh.new()
    bm.from_mesh(src.data)
    keep = []
    x0, x1, y0, y1 = -0.1, 0.1, 1.535, 1.79
    for fc in bm.faces:
        g = G(fc.calc_center_median())
        nz = -fc.normal.y
        if y0 < g.y < y1 and abs(g.x) < 0.105 and nz > 0.22 and g.z > 0.0:
            keep.append(fc)
    out = bmesh.new()
    vmap = {}
    for fc in keep:
        vs = []
        for v in fc.verts:
            if v.index not in vmap:
                vmap[v.index] = out.verts.new(v.co + v.normal * 0.0016)
            vs.append(vmap[v.index])
        try:
            out.faces.new(vs)
        except ValueError:
            pass
    uv = out.loops.layers.uv.new('UVMap')
    for fc in out.faces:
        for lp in fc.loops:
            co = lp.vert.co
            lp[uv].uv = ((co.x - x0) / (x1 - x0), (co.z - y0) / (y1 - y0))
    me = bpy.data.meshes.new('Face')
    out.to_mesh(me)
    out.free()
    bm.free()
    ob = link(bpy.data.objects.new('Face', me))
    for p in me.polygons:
        p.use_smooth = True
    bind_rigid(ob, arm, lambda g: {'head': 1.0})
    return ob


def skirt(arm, f):
    """A flared skirt from the waist to above the knee, skinned to the hips and thighs."""
    rings = [(1.0, 0.152 if f else 0.15, 0.112), (0.9, 0.19, 0.142), (0.78, 0.225, 0.175), (0.66, 0.255, 0.205), (0.56, 0.272, 0.222)]
    seg = 28
    bm = bmesh.new()
    grid = []
    for (y, rx, rz) in rings:
        row = []
        for i in range(seg):
            a = 2 * math.pi * i / seg
            row.append(bm.verts.new(B((math.sin(a) * rx, y, math.cos(a) * rz))))
        grid.append(row)
    for r in range(len(rings) - 1):
        for i in range(seg):
            j = (i + 1) % seg
            # Wound so the outside faces out (three.js culls back faces).
            bm.faces.new((grid[r][i], grid[r + 1][i], grid[r + 1][j], grid[r][j]))
    me = bpy.data.meshes.new('Skirt')
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new('Skirt', me))
    for p in me.polygons:
        p.use_smooth = True

    def w(g):
        t = max(0.0, min(1.0, (1.0 - g.y) / 0.44))
        side = max(0.0, min(1.0, 0.5 + g.x / 0.18))
        return {'hips': 1 - 0.7 * t, 'thighL': 0.7 * t * side, 'thighR': 0.7 * t * (1 - side)}

    bind_rigid(ob, arm, w)
    return ob


# ------------------------------------------------------------------ previews

def region_material():
    """Colours each face by its region (for checking the cuts)."""
    mat = bpy.data.materials.new('regions')
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes['Principled BSDF']
    tc = nt.nodes.new('ShaderNodeUVMap')
    tc.uv_map = 'UVMap'
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    mul = nt.nodes.new('ShaderNodeMath')
    mul.operation = 'MULTIPLY'
    mul.inputs[1].default_value = 0.382
    fr = nt.nodes.new('ShaderNodeMath')
    fr.operation = 'FRACT'
    hsv = nt.nodes.new('ShaderNodeCombineColor')
    hsv.mode = 'HSV'
    hsv.inputs[1].default_value = 0.65
    hsv.inputs[2].default_value = 0.85
    nt.links.new(tc.outputs[0], sep.inputs[0])
    nt.links.new(sep.outputs[0], mul.inputs[0])
    nt.links.new(mul.outputs[0], fr.inputs[0])
    nt.links.new(fr.outputs[0], hsv.inputs[0])
    nt.links.new(hsv.outputs[0], bsdf.inputs['Base Color'])
    return mat


def flat_material(name, rgb):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    return mat


def render_previews(name):
    """The body coloured by region: front, side and back (preview_heads.py does the heads)."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 12
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.75, 0.8, 0.9, 1)
    sc.world = world
    body = sc.objects['Body']
    body.data.materials.clear()
    body.data.materials.append(region_material())
    for ob in sc.objects:
        if ob.type == 'MESH' and ob is not body:
            ob.hide_render = True
    sun = link(bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN')))
    sun.rotation_euler = (0.9, 0.2, 0.6)
    cam = link(bpy.data.objects.new('cam', bpy.data.cameras.new('cam')))
    cam.data.type = 'ORTHO'
    sc.camera = cam
    os.makedirs(PREVIEWS, exist_ok=True)
    sc.render.resolution_x = 480
    sc.render.resolution_y = 720
    cam.data.ortho_scale = 2.0
    for view, (pos, rot) in {
        'front': ((0, -4, 0.92), (math.pi / 2, 0, 0)),
        'side': ((4, 0, 0.92), (math.pi / 2, 0, math.pi / 2)),
        'back': ((0, 4, 0.92), (math.pi / 2, 0, math.pi)),
    }.items():
        cam.location = pos
        cam.rotation_euler = rot
        sc.render.filepath = os.path.join(PREVIEWS, f'{name}-{view}.png')
        bpy.ops.render.render(write_still=True)


# ------------------------------------------------------------------ build

def build(body):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    f = body == 'f'
    R, sculpts = sculpt_body(f)
    fused = sculpt_mesh(sculpts, voxel=0.0055, smooth=6, name='BodyFused')
    hair_hats.set_head(f, head_of(fused))
    hi = thin_body(fused, body_tris=2900, head_tris=900)
    lo = decimate(fused, 760, name='BodyLow')
    remove(fused)
    for o in (hi, lo):
        clean(o)
    arm = make_armature(R)
    report = {}
    for o in (hi, lo):
        rig(o, arm)
        report[o.name] = regionize(o, R, f)
    face_patch(hi, arm)
    skirt(arm, f)
    hair_hats.build_all(f)
    remove(hair_hats.HEAD.pop(f))
    os.makedirs(OUT, exist_ok=True)
    path = os.path.abspath(os.path.join(OUT, f'body_{body}.glb'))
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_yup=True,
        export_skins=True,
        export_animations=False,
        export_materials='NONE',
        export_normals=True,
        export_texcoords=True,
    )
    tris = {ob.name: sum(len(p.vertices) - 2 for p in ob.data.polygons) for ob in bpy.context.scene.objects if ob.type == 'MESH'}
    print('built', body, path, os.path.getsize(path), 'bytes')
    print('  tris', tris)
    print('  regions', report['Body'])
    if RENDER:
        render_previews(f'body_{body}')


if __name__ == '__main__':
    for body in ('m', 'f'):
        build(body)
