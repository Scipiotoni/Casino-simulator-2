"""
Shared helpers for the Blender build scripts: game/Blender coordinates, metaball sculpting,
lathed and swept shapes, baking modifiers, decimation and the region UVs the game colours by.

Game model space: x (the character's left), y up, z forward (the way it faces).
Blender: x, -y forward, z up. The glTF exporter (export_yup) turns Blender back into game space.
"""
import math

import bpy  # first: it makes bmesh and mathutils importable when run as a module
import bmesh
from mathutils import Vector

SURFACE = 0.575  # a metaball's surface sits at this fraction of its radius (threshold 0.6)


def B(p):
    """Game model space (x, y up, z forward) to Blender (x, -y forward, z up). Points or directions."""
    return Vector((p[0], -p[2], p[1]))


def G(co):
    """Blender to game model space."""
    return Vector((co.x, co.z, -co.y))


def link(ob):
    bpy.context.scene.collection.objects.link(ob)
    return ob


class Sculpt:
    """One metaball family (elements in this object blend; other objects only touch)."""

    def __init__(self, name, resolution=0.008):
        self.mb = bpy.data.metaballs.new(name)
        self.mb.resolution = resolution
        self.mb.threshold = 0.6
        self.ob = link(bpy.data.objects.new(name, self.mb))

    def ball(self, p, r, stiff=2.0):
        e = self.mb.elements.new()
        e.type = 'BALL'
        e.co = B(p)
        e.radius = r / SURFACE
        e.stiffness = stiff

    def ellipsoid(self, p, size, stiff=2.0, rot=None):
        """size = surface half-extents in game space (x, y up, z forward); rot a Blender quaternion."""
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

    def chain(self, pts, r0, r1, n=3):
        """A tapered tube through a list of points."""
        total = sum((Vector(pts[i + 1]) - Vector(pts[i])).length for i in range(len(pts) - 1))
        run = 0.0
        for i in range(len(pts) - 1):
            seg = (Vector(pts[i + 1]) - Vector(pts[i])).length
            ra = r0 + (r1 - r0) * run / total
            rb = r0 + (r1 - r0) * (run + seg) / total
            self.taper(pts[i], pts[i + 1], ra, rb, n)
            run += seg


def bake_object(ob, name=None):
    """Evaluate an object (with modifiers) into a new plain mesh object."""
    dg = bpy.context.evaluated_depsgraph_get()
    me = bpy.data.meshes.new_from_object(ob.evaluated_get(dg))
    nob = link(bpy.data.objects.new(name or (ob.name + '_mesh'), me))
    if name:
        me.name = name
    return nob


def remove(ob):
    data = ob.data
    bpy.data.objects.remove(ob)
    if data is not None and data.users == 0:
        if isinstance(data, bpy.types.Mesh):
            bpy.data.meshes.remove(data)
        elif isinstance(data, bpy.types.MetaBall):
            bpy.data.metaballs.remove(data)


def sculpt_mesh(sculpts, voxel=0.004, smooth=4, name='Sculpted'):
    """Metaball families to one closed mesh: unioned by a voxel remesh, lightly smoothed."""
    parts = [bake_object(s.ob) for s in sculpts]
    for s in sculpts:
        parts += getattr(s, 'extra', [])
        remove(s.ob)
    bm = bmesh.new()
    for p in parts:
        bm.from_mesh(p.data)
        remove(p)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    ob = link(bpy.data.objects.new(name + '_raw', me))
    rm = ob.modifiers.new('remesh', 'REMESH')
    rm.mode = 'VOXEL'
    rm.voxel_size = voxel
    if smooth:
        sm = ob.modifiers.new('smooth', 'CORRECTIVE_SMOOTH')
        sm.factor = 0.5
        sm.iterations = smooth
        sm.smooth_type = 'SIMPLE'
        sm.use_only_smooth = True
    out = bake_object(ob, name)
    remove(ob)
    return out


def subtract(ob, cutters):
    """Boolean-subtract closed cutter meshes from an object (the cut faces show its thickness)."""
    for c in cutters:
        m = ob.modifiers.new('cut', 'BOOLEAN')
        m.operation = 'DIFFERENCE'
        m.solver = 'MANIFOLD'  # every operand here is closed and manifold
        m.object = c
    out = bake_object(ob, ob.name)
    remove(ob)
    for c in cutters:
        remove(c)
    out.name = out.data.name
    return out


def ellipsoid_mesh(c, half, rx=0.0, name='Cutter', seg=40):
    """A closed ellipsoid mesh in game space (centre, half extents, tilted rx about game x)."""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=seg // 2, radius=1.0)
    _place(bm, c, half, rx)
    return _obj(bm, name)


def box_mesh(c, half, rx=0.0, name='Cutter'):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=2.0)
    _place(bm, c, half, rx)
    return _obj(bm, name)


def _place(bm, c, half, rx):
    cs, sn = math.cos(rx), math.sin(rx)
    for v in bm.verts:
        g = G(v.co)
        x, y, z = g.x * half[0], g.y * half[1], g.z * half[2]
        y, z = y * cs - z * sn, y * sn + z * cs
        v.co = B((c[0] + x, c[1] + y, c[2] + z))


def _obj(bm, name):
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    return link(bpy.data.objects.new(name, me))


def lathe(name, prof, sx, sz, y0, seg=32, z0=0.0, phi=None, rfun=None, deform=None):
    """
    A surface of revolution round the game y axis: `prof` is (r, y) pairs from bottom to top,
    r scaling the radii (sx across, sz front to back). `phi` limits it to an arc (radians from
    the front, +z, towards +x); `rfun(r, a)` reshapes the radius by angle; `deform(x, y, z)`
    bends the result. Ends with r == 0 close to a point.
    """
    full = phi is None
    a0, a1 = (-math.pi, math.pi) if full else phi
    n = seg if full else seg + 1
    bm = bmesh.new()
    rings = []
    for (r, y) in prof:
        if r <= 1e-6:
            x, yy, z = 0.0, y0 + y, z0
            if deform:
                x, yy, z = deform(x, yy, z)
            rings.append([bm.verts.new(B((x, yy, z)))])
            continue
        ring = []
        for i in range(n):
            a = a0 + (a1 - a0) * i / (seg if full else seg)
            rr = rfun(r, a) if rfun else r
            x = math.sin(a) * rr * sx
            z = z0 + math.cos(a) * rr * sz
            yy = y0 + y
            if deform:
                x, yy, z = deform(x, yy, z)
            ring.append(bm.verts.new(B((x, yy, z))))
        rings.append(ring)
    for k in range(len(rings) - 1):
        lo, hi = rings[k], rings[k + 1]
        if len(lo) == 1 and len(hi) == 1:
            continue
        for i in range(n if full else n - 1):
            j = (i + 1) % n
            if len(lo) == 1:
                bm.faces.new((lo[0], hi[j], hi[i]))
            elif len(hi) == 1:
                bm.faces.new((lo[i], lo[j], hi[0]))
            else:
                bm.faces.new((lo[i], lo[j], hi[j], hi[i]))
    return _obj(bm, name)


def finish(ob, solid=0.0, subdiv=0, sharp=None):
    """Thicken (solidify) and round (subdivision) a modelled piece, then bake it."""
    if solid:
        m = ob.modifiers.new('solid', 'SOLIDIFY')
        m.thickness = solid
        m.offset = -1
        m.use_even_offset = True
        m.use_rim = True
    if subdiv:
        m = ob.modifiers.new('subd', 'SUBSURF')
        m.levels = subdiv
        m.render_levels = subdiv
    out = bake_object(ob, ob.name)
    remove(ob)
    out.name = out.data.name
    clean(out, sharp)
    return out


def clean(ob, sharp=None):
    """Consistent outward normals, smooth shading, and sharp edges past `sharp` radians."""
    bm = bmesh.new()
    bm.from_mesh(ob.data)
    # No leftover vertex weights (rigging starts from nothing).
    while ob.vertex_groups:
        ob.vertex_groups.remove(ob.vertex_groups[0])
    for layer in list(bm.verts.layers.deform.values()):
        bm.verts.layers.deform.remove(layer)
    bmesh.ops.dissolve_degenerate(bm, dist=1e-6, edges=bm.edges)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for f in bm.faces:
        f.smooth = True
    if sharp is not None:
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0) > sharp:
                e.smooth = False
    bm.to_mesh(ob.data)
    bm.free()


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def decimate(ob, tris, name=None, symmetric=True, keep=None, invert=False):
    """
    A copy of an object cut down to about `tris` triangles. With `keep(co) -> bool` only the
    vertices it picks are thinned (with `invert`, only the others).
    """
    out = link(bpy.data.objects.new((name or ob.name) + '_tmp', ob.data.copy()))
    n = tri_count(out)
    if n > tris:
        d = out.modifiers.new('dec', 'DECIMATE')
        d.decimate_type = 'COLLAPSE'
        d.ratio = tris / n
        d.use_symmetry = symmetric
        d.symmetry_axis = 'X'
        if keep:
            vg = out.vertex_groups.new(name='keep')
            vg.add([v.index for v in out.data.vertices if keep(v.co)], 1.0, 'REPLACE')
            d.vertex_group = 'keep'
            d.invert_vertex_group = invert
            d.vertex_group_factor = 100.0
        baked = bake_object(out, name or ob.name)
        remove(out)
        out = baked
    out.name = name or ob.name
    out.data.name = out.name
    return out


def set_region(ob, region):
    """Every face of the object in one colour region (stored as the u of its UVs)."""
    me = ob.data
    uv = me.uv_layers.get('UVMap') or me.uv_layers.new(name='UVMap')
    for d in uv.data:
        d.uv = (region + 0.5, 0.5)


def snap_regions(ob):
    """After decimation: every face's UVs back on its region's centre (one region per face)."""
    me = ob.data
    uv = me.uv_layers.get('UVMap')
    if not uv:
        return
    for poly in me.polygons:
        us = [uv.data[i].uv[0] for i in poly.loop_indices]
        r = int(round(sum(us) / len(us) - 0.5))
        for i in poly.loop_indices:
            uv.data[i].uv = (r + 0.5, 0.5)


def join(name, pieces):
    """Merge several mesh objects (with their UVs) into one new object."""
    bm = bmesh.new()
    for p in pieces:
        bm.from_mesh(p.data)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p in pieces:
        remove(p)
    ob = link(bpy.data.objects.new(name, me))
    return ob
