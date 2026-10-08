"""
Builds the character bodies for Casino Simulator 2 in Blender and exports them as glTF.

Run with Blender's Python module (pip install bpy) or Blender itself:
    python tools/blender/build_characters.py [out_dir] [--render]

For each body type (m, f) it sculpts one continuous body out of metaballs (torso and head,
two arms, two legs), fuses them with a voxel remesh into a single watertight surface,
smooths the joins at the hips and shoulders, decimates to a high and a low level of detail,
rigs it with an armature whose joints match the game's skeleton (src/chars/model.ts,
restPose) using Blender's automatic weights, and adds a face patch (UV-mapped for the
painted face) and a skirt. Everything is exported in the game's model space: y up, the
character facing +z, its left at +x.
"""
import math
import os
import sys

import bpy  # first: it makes bmesh and mathutils importable when run as a module
import bmesh
from mathutils import Quaternion, Vector

OUT = next((a for a in sys.argv[1:] if not a.startswith('--') and not a.endswith('.py')), 'src/chars/assets')
RENDER = '--render' in sys.argv
SURFACE = 0.575  # a metaball's surface sits at this fraction of its radius (threshold 0.6)


def B(p):
    """Game model space (x, y up, z forward) to Blender (x, -y forward, z up)."""
    return Vector((p[0], -p[2], p[1]))


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


class Sculpt:
    """One metaball family (elements in this object blend; other objects only touch)."""

    def __init__(self, name):
        self.mb = bpy.data.metaballs.new(name)
        self.mb.resolution = 0.008
        self.mb.threshold = 0.6
        self.ob = bpy.data.objects.new(name, self.mb)
        bpy.context.scene.collection.objects.link(self.ob)

    def ball(self, p, r, stiff=2.0):
        e = self.mb.elements.new()
        e.type = 'BALL'
        e.co = B(p)
        e.radius = r / SURFACE
        e.stiffness = stiff

    def ellipsoid(self, p, size, stiff=2.0, rot=None):
        """size = surface half-extents in game space (x, y up, z forward)."""
        e = self.mb.elements.new()
        e.type = 'ELLIPSOID'
        e.co = B(p)
        e.radius = 1 / SURFACE
        e.size_x, e.size_y, e.size_z = size[0], size[2], size[1]
        e.stiffness = stiff
        if rot:
            e.rotation = rot

    def capsule(self, a, b, r, stiff=2.0):
        a, b = B(a), B(b)
        d = b - a
        e = self.mb.elements.new()
        e.type = 'CAPSULE'
        e.co = (a + b) / 2
        e.radius = r / SURFACE
        e.size_x = max(1e-4, d.length / 2)
        e.rotation = Vector((1, 0, 0)).rotation_difference(d.normalized())
        e.stiffness = stiff

    def taper(self, a, b, r0, r1, n=4):
        """A limb that thins from r0 at a to r1 at b (a run of overlapping capsules)."""
        for i in range(n):
            t0 = i / n
            t1 = (i + 1) / n
            p0 = [a[k] + (b[k] - a[k]) * t0 for k in range(3)]
            p1 = [a[k] + (b[k] - a[k]) * t1 for k in range(3)]
            self.capsule(p0, p1, (r0 + (r1 - r0) * (t0 + t1) / 2) * 0.92)


def sculpt_body(f):
    R = rest_pose(f)
    torso = Sculpt('Torso')
    if f:
        torso.ellipsoid((0, 0.935, -0.005), (0.168, 0.1, 0.112))
        torso.ellipsoid((0, 1.06, 0), (0.128, 0.085, 0.088))
        torso.ellipsoid((0, 1.17, 0.004), (0.138, 0.075, 0.095))
        torso.ellipsoid((0, 1.29, 0.004), (0.155, 0.095, 0.104))
        torso.ellipsoid((0, 1.405, -0.006), (0.158, 0.06, 0.092))
        for s in (-1, 1):
            torso.ellipsoid((s * 0.058, 1.29, 0.058), (0.062, 0.055, 0.048))
            torso.ball((s * 0.178, 1.41, 0), 0.05)
        torso.capsule((0, 1.44, -0.004), (0, 1.585, 0.006), 0.047)
    else:
        torso.ellipsoid((0, 0.935, -0.005), (0.158, 0.1, 0.108))
        torso.ellipsoid((0, 1.06, 0), (0.148, 0.09, 0.098))
        torso.ellipsoid((0, 1.17, 0.004), (0.16, 0.08, 0.104))
        torso.ellipsoid((0, 1.295, 0.008), (0.19, 0.1, 0.122))
        torso.ellipsoid((0, 1.41, -0.006), (0.19, 0.065, 0.108))
        for s in (-1, 1):
            torso.ball((s * 0.198, 1.415, 0), 0.057)
        torso.capsule((0, 1.44, -0.004), (0, 1.585, 0.006), 0.054)
    # Head: skull, jaw, chin, nose, brow and ears, sized to fit the game's hair and hats.
    hw = 0.106 if f else 0.11
    torso.ellipsoid((0, 1.675, 0.004), (hw, 0.122, 0.118))
    torso.ellipsoid((0, 1.6, 0.03), (hw * 0.74, 0.06, 0.08))
    torso.ellipsoid((0, 1.565, 0.068), (0.04, 0.03, 0.04))
    torso.ellipsoid((0, 1.648, 0.112), (0.016, 0.03, 0.022))
    torso.ellipsoid((0, 1.71, 0.082), (hw * 0.7, 0.016, 0.026))
    for s in (-1, 1):
        torso.ellipsoid((s * (hw + 0.002), 1.66, -0.004), (0.013, 0.032, 0.022), stiff=3.0)
    for side in ('L', 'R'):
        sg = 1 if side == 'L' else -1
        arm = Sculpt('Arm' + side)
        up = R['upperArm' + side]
        el = R['foreArm' + side]
        wr = R['hand' + side]
        ru = 0.054 if f else 0.062
        arm.ball((up[0] - sg * 0.01, up[1] - 0.005, 0), ru * 1.05)
        arm.taper((up[0], up[1] - 0.02, up[2]), el, ru, ru * 0.82)
        arm.ellipsoid((el[0] + sg * 0.004, el[1] - 0.06, el[2]), (ru * 0.8, 0.07, ru * 0.82))
        arm.taper(el, (wr[0], wr[1] + 0.02, wr[2]), ru * 0.8, ru * 0.6)
        # Hand: palm, fingers (together, slightly curled) and a thumb.
        arm.ellipsoid((wr[0] + sg * 0.003, wr[1] - 0.052, wr[2] + 0.006), (0.025, 0.054, 0.047))
        arm.ellipsoid((wr[0] + sg * 0.005, wr[1] - 0.118, wr[2] + 0.017), (0.021, 0.045, 0.043), rot=Quaternion((1, 0, 0), -0.3))
        arm.capsule((wr[0] - sg * 0.004, wr[1] - 0.03, wr[2] + 0.037), (wr[0] - sg * 0.008, wr[1] - 0.075, wr[2] + 0.066), 0.015)
        leg = Sculpt('Leg' + side)
        th = R['thigh' + side]
        kn = R['shin' + side]
        an = R['foot' + side]
        rt = 0.092 if f else 0.088
        # The top of the thigh reaches up inside the pelvis so the hip join is deep.
        leg.ellipsoid((th[0] + sg * 0.004, th[1] - 0.02, th[2]), (rt * 0.95, 0.09, rt * 0.95))
        leg.taper((th[0], th[1] - 0.06, th[2]), kn, rt, rt * 0.7)
        leg.ellipsoid((kn[0], kn[1] - 0.15, kn[2] - 0.022), (rt * 0.66, 0.13, rt * 0.68))
        leg.taper(kn, (an[0], an[1] + 0.04, an[2]), rt * 0.64, rt * 0.52)
        # Foot (a trainer: rounded toe, flat-ish sole).
        leg.ellipsoid((an[0], an[1] - 0.005, an[2] - 0.005), (0.048, 0.05, 0.052))
        leg.ellipsoid((an[0] + sg * 0.004, 0.05, an[2] + 0.075), (0.05, 0.045, 0.1))
    return R


def bake_object(ob):
    """Evaluate an object (with modifiers) into a new plain mesh object."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    nob = bpy.data.objects.new(ob.name + '_mesh', me)
    bpy.context.scene.collection.objects.link(nob)
    return nob


def fuse_body():
    """Every metaball family to a mesh, joined, voxel-remeshed into one surface, smoothed."""
    parts = []
    for ob in list(bpy.context.scene.objects):
        if ob.type == 'META':
            parts.append(bake_object(ob))
    for ob in list(bpy.context.scene.objects):
        if ob.type == 'META':
            bpy.data.objects.remove(ob)
    bm = bmesh.new()
    for p in parts:
        bm.from_mesh(p.data)
    me = bpy.data.meshes.new('Body')
    bm.to_mesh(me)
    bm.free()
    for p in parts:
        bpy.data.objects.remove(p)
    body = bpy.data.objects.new('BodyRaw', me)
    bpy.context.scene.collection.objects.link(body)
    rm = body.modifiers.new('remesh', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = 0.0055
    sm = body.modifiers.new('smooth', 'CORRECTIVE_SMOOTH')
    sm.factor = 0.6
    sm.iterations = 6
    sm.smooth_type = 'SIMPLE'
    sm.use_only_smooth = True
    fused = bake_object(body)
    bpy.data.objects.remove(body)
    fused.name = 'BodyFused'
    return fused


def decimated(src, name, tris):
    ob = bpy.data.objects.new(name, src.data.copy())
    bpy.context.scene.collection.objects.link(ob)
    n = sum(len(p.vertices) - 2 for p in ob.data.polygons)
    d = ob.modifiers.new('dec', 'DECIMATE')
    d.decimate_type = 'COLLAPSE'
    d.ratio = min(1.0, tris / max(1, n))
    d.use_symmetry = True
    d.symmetry_axis = 'X'
    out = bake_object(ob)
    bpy.data.objects.remove(ob)
    out.name = name
    out.data.name = name
    out.data.validate()
    # Decimation can flip a few faces: make every normal point outwards again.
    bm = bmesh.new()
    bm.from_mesh(out.data)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-5, edges=bm.edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    bm.to_mesh(out.data)
    bm.free()
    for p in out.data.polygons:
        p.use_smooth = True
    return out


def make_armature(R):
    arm_data = bpy.data.armatures.new('Rig')
    arm = bpy.data.objects.new('Rig', arm_data)
    bpy.context.scene.collection.objects.link(arm)
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
    # Four influences at most, normalised (what the game's skinning uses).
    bpy.context.view_layer.objects.active = mesh
    bpy.ops.object.select_all(action='DESELECT')
    mesh.select_set(True)
    bpy.ops.object.mode_set(mode='WEIGHT_PAINT')
    bpy.ops.object.vertex_group_limit_total(group_select_mode='ALL', limit=4)
    bpy.ops.object.vertex_group_normalize_all(group_select_mode='ALL', lock_active=False)
    bpy.ops.object.mode_set(mode='OBJECT')


def bind_rigid(ob, arm, weights):
    """Skin an object to the rig with given weights: callable(co_game) -> {bone: w}."""
    groups = {}
    for v in ob.data.vertices:
        co = v.co
        g = (co.x, co.z, -co.y)
        for bone, w in weights(g).items():
            if w <= 0:
                continue
            if bone not in groups:
                groups[bone] = ob.vertex_groups.new(name=bone)
            groups[bone].add([v.index], w, 'REPLACE')
    ob.parent = arm
    m = ob.modifiers.new('rig', 'ARMATURE')
    m.object = arm


def face_patch(src, arm, f):
    """The front of the head, lifted a hair off the skin and UV-mapped for the painted face."""
    bm = bmesh.new()
    bm.from_mesh(src.data)
    bm.faces.ensure_lookup_table()
    keep = []
    x0, x1, y0, y1 = -0.1, 0.1, 1.535, 1.79
    for fc in bm.faces:
        c = fc.calc_center_median()
        g = (c.x, c.z, -c.y)
        n = fc.normal
        nz = -n.y
        if g[1] > y0 and g[1] < y1 and abs(g[0]) < 0.105 and nz > 0.22 and g[2] > 0.0:
            keep.append(fc)
    out = bmesh.new()
    vmap = {}
    for fc in keep:
        vs = []
        for v in fc.verts:
            if v.index not in vmap:
                nv = out.verts.new(v.co + v.normal * 0.0016)
                vmap[v.index] = nv
            vs.append(vmap[v.index])
        try:
            out.faces.new(vs)
        except ValueError:
            pass
    uv = out.loops.layers.uv.new('UVMap')
    for fc in out.faces:
        for lp in fc.loops:
            co = lp.vert.co
            gx, gy = co.x, co.z
            lp[uv].uv = ((gx - x0) / (x1 - x0), (gy - y0) / (y1 - y0))
    me = bpy.data.meshes.new('Face')
    out.to_mesh(me)
    out.free()
    bm.free()
    ob = bpy.data.objects.new('Face', me)
    bpy.context.scene.collection.objects.link(ob)
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
    ob = bpy.data.objects.new('Skirt', me)
    bpy.context.scene.collection.objects.link(ob)
    for p in me.polygons:
        p.use_smooth = True

    def w(g):
        t = max(0.0, min(1.0, (1.0 - g[1]) / 0.44))
        side = max(0.0, min(1.0, 0.5 + g[0] / 0.18))
        return {'hips': 1 - 0.7 * t, 'thighL': 0.7 * t * side, 'thighR': 0.7 * t * (1 - side)}

    bind_rigid(ob, arm, w)
    return ob


def render_previews(name):
    """Front, side and back views with Cycles on the CPU (for checking the sculpt)."""
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 16
    sc.render.resolution_x = 480
    sc.render.resolution_y = 720
    world = bpy.data.worlds.new('w')
    world.use_nodes = True
    world.node_tree.nodes['Background'].inputs[0].default_value = (0.75, 0.8, 0.9, 1)
    sc.world = world
    mat = bpy.data.materials.new('clay')
    mat.use_nodes = True
    mat.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.8, 0.62, 0.5, 1)
    for ob in sc.objects:
        if ob.type == 'MESH':
            ob.data.materials.clear()
            ob.data.materials.append(mat)
            # Only the full-detail body: the low LOD, face patch and skirt would overlap it.
            ob.hide_render = ob.name != 'Body'
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.rotation_euler = (0.9, 0.2, 0.6)
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    cam.data.ortho_scale = 2.0
    sc.collection.objects.link(cam)
    sc.camera = cam
    for view, (pos, rot) in {
        'front': ((0, -4, 0.92), (math.pi / 2, 0, 0)),
        'side': ((4, 0, 0.92), (math.pi / 2, 0, math.pi / 2)),
        'back': ((0, 4, 0.92), (math.pi / 2, 0, math.pi)),
    }.items():
        cam.location = pos
        cam.rotation_euler = rot
        sc.render.filepath = os.path.join(OUT, '..', '..', '..', 'tools', 'blender', 'previews', f'{name}-{view}.png')
        bpy.ops.render.render(write_still=True)


def build(body):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    f = body == 'f'
    R = sculpt_body(f)
    fused = fuse_body()
    hi = decimated(fused, 'Body', 4200)
    lo = decimated(fused, 'BodyLow', 1100)
    bpy.data.objects.remove(fused)
    arm = make_armature(R)
    rig(hi, arm)
    rig(lo, arm)
    face_patch(hi, arm, f)
    skirt(arm, f)
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
    print('built', body, path, os.path.getsize(path), 'bytes', tris)
    if RENDER:
        render_previews(f'body_{body}')


for body in ('m', 'f'):
    build(body)
