"""
Builds every car in Casino Simulator 2 in Blender and exports each one as its own small
glTF file (src/vehicles/assets/cars/<id>.glb, packed with gltfpack: quantized and meshopt
compressed) plus its metadata (<id>.json), so the game only downloads the cars it shows.

Run with Blender's Python module (pip install bpy) or Blender itself:
    python tools/blender/build_cars.py [out_dir] [--render] [--only=sedan,taxi]

--only builds and exports just those cars and leaves the other files alone.

Each car is modelled after a real-world kind of car (no makes, badges or logos): a lofted
lower body with wheel arches cut out of it, a lofted glasshouse with pillars and roof, then
lamps, grilles, number plates, panel gaps and trim laid on the surface, the bolt-on parts
(mirrors, bumpers, light bars...), an interior you can see through the glass, and wheels as
separate meshes so the game can spin and steer them. Two levels of detail per car: '<id>'
(a few thousand triangles) and '<id>_lo' (about a thousand, wheels included, opaque glass).
The cars themselves are in cars_*.py; the kit they're made with in carkit.py, carbody.py,
carparts.py and carcommon.py.

Every face is in a colour region, exported as a material of that name (see carkit.REGIONS):
the game paints 'paint' in the car's colour, merges the rest by material and lights the
lamps at night. Each car's object carries its wheel positions, seats and driver's eye (in
the game's car space: +x forward, y up, +z right) as glTF extras.

With --render it renders previews instead (front and rear three-quarter, side, and the low
detail) into tools/blender/previews/.
"""
import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Matrix, Vector  # noqa: E402

import carkit as K  # noqa: E402
from carcommon import CARS  # noqa: E402
import cars_saloon  # noqa: E402,F401
import cars_fast  # noqa: E402,F401

ARGS = [a for a in sys.argv[1:] if not a.endswith('.py')]
OUT = next((a for a in ARGS if not a.startswith('--')), 'src/vehicles/assets')
RENDER = '--render' in ARGS
ONLY = next((a.split('=', 1)[1].split(',') for a in ARGS if a.startswith('--only=')), None)
VIEWS = next((a.split('=', 1)[1].split(',') for a in ARGS if a.startswith('--views=')), ['front', 'rear', 'side', 'lo'])
PREVIEWS = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'previews')


# ------------------------------------------------------------------ export

def to_objects(cid, hi, lo):
    """Blender objects for one car: '<id>' (with the metadata), '<id>_lo', '<id>_wf', '<id>_wr', parts."""
    obs = []
    ob = hi.body.to_object(cid, sharp_angle=math.radians(50))
    ob['car'] = json.dumps(hi.meta)
    obs.append(ob)
    obs.append(lo.body.to_object(cid + '_lo', sharp_angle=math.radians(50)))
    for k, w in hi.wheel.items():
        obs.append(w.to_object(f'{cid}_w{k}', sharp_angle=math.radians(55)))
    for name, m in hi.parts.items():
        obs.append(m.to_object(f'{cid}_{name}', sharp_angle=math.radians(50)))
    for name, m in lo.parts.items():
        obs.append(m.to_object(f'{cid}_{name}_lo', sharp_angle=math.radians(50)))
    return obs


def tri_count(ob):
    return sum(len(p.vertices) - 2 for p in ob.data.polygons)


def export(path, selected=None):
    bpy.ops.export_scene.gltf(
        filepath=path,
        export_format='GLB',
        export_yup=True,
        export_apply=False,
        export_animations=False,
        export_materials='EXPORT',
        export_normals=True,
        export_texcoords=False,
        export_extras=True,
        use_visible=False,
        use_selection=selected is not None,
    )


# ------------------------------------------------------------------ previews

def preview_scene():
    sc = bpy.context.scene
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 16
    try:
        sc.cycles.use_denoising = True
    except Exception:
        pass
    sc.render.resolution_x = 960
    sc.render.resolution_y = 600
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    nt = w.node_tree
    bg = nt.nodes['Background']
    tc = nt.nodes.new('ShaderNodeTexCoord')
    sep = nt.nodes.new('ShaderNodeSeparateXYZ')
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    nt.links.new(tc.outputs['Generated'], sep.inputs[0])
    mr = nt.nodes.new('ShaderNodeMapRange')
    mr.inputs['From Min'].default_value = -1
    mr.inputs['From Max'].default_value = 1
    nt.links.new(sep.outputs['Z'], mr.inputs['Value'])
    nt.links.new(mr.outputs['Result'], ramp.inputs['Fac'])
    els = ramp.color_ramp.elements
    els[0].position = 0.45
    els[0].color = (0.18, 0.17, 0.16, 1)
    els[1].position = 0.5
    els[1].color = (0.95, 0.95, 0.97, 1)
    e = els.new(0.62)
    e.color = (0.45, 0.62, 0.9, 1)
    nt.links.new(ramp.outputs['Color'], bg.inputs['Color'])
    bg.inputs['Strength'].default_value = 0.9
    sc.world = w
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.data.energy = 3.5
    sun.data.angle = 0.1
    sun.rotation_euler = (0.75, 0.15, 2.4)
    sc.collection.objects.link(sun)
    me = bpy.data.meshes.new('ground')
    me.from_pydata([(-30, -30, 0), (30, -30, 0), (30, 30, 0), (-30, 30, 0)], [], [(0, 1, 2, 3)])
    g = bpy.data.objects.new('ground', me)
    gm = bpy.data.materials.new('groundm')
    gm.use_nodes = True
    gm.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (0.42, 0.42, 0.43, 1)
    gm.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.8
    me.materials.append(gm)
    sc.collection.objects.link(g)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.lens = 50
    sc.collection.objects.link(cam)
    sc.camera = cam
    return cam


def look(cam, pos, target):
    cam.location = pos
    d = Vector(target) - Vector(pos)
    cam.rotation_euler = d.to_track_quat('-Z', 'Y').to_euler()


def preview_materials(color):
    """Shade the regions for the renders: the car's paint, glassy glass, lit-looking lamps."""
    c = ((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255
    lin = tuple(v ** 2.2 for v in c)
    for name in K.REGIONS:
        m = K.material(name)
        b = m.node_tree.nodes['Principled BSDF']
        if name == 'paint':
            b.inputs['Base Color'].default_value = (*lin, 1)
            b.inputs['Coat Weight'].default_value = 1.0
            b.inputs['Roughness'].default_value = 0.3
            b.inputs['Metallic'].default_value = 0.35
        if name == 'paint2':
            b.inputs['Coat Weight'].default_value = 1.0
        if name == 'glass':
            b.inputs['Alpha'].default_value = 0.6
            b.inputs['Roughness'].default_value = 0.0
            b.inputs['Coat Weight'].default_value = 1.0


def render_car(cid, hi, lo, cam):
    """Front and rear three-quarter renders of the high detail, one of the low detail beside it."""
    temp = []
    body = hi.body.to_object('prev_' + cid, sharp_angle=math.radians(50))
    temp.append(body)
    for (x, y, z, k) in hi.meta['wheels']:
        w = hi.wheel[k].copy()
        if z < 0:  # game -z is the car's left (Blender +y): turn the wheel round
            w.transform(Matrix.Rotation(math.pi, 4, 'Z'))
        w.transform(Matrix.Translation((x, -z, y)))
        temp.append(w.to_object('prev_w', sharp_angle=math.radians(55)))
    for name, m in hi.parts.items():
        temp.append(m.to_object('prev_' + name, sharp_angle=math.radians(50)))
    preview_materials(hi.meta.get('color', 0xcccccc))
    L = hi.meta['dims'][0]
    d = max(6.0, L * 1.45)
    os.makedirs(PREVIEWS, exist_ok=True)
    sc = bpy.context.scene
    views = {'front': (0.62, 1.5), 'rear': (math.pi - 0.62, 1.6), 'side': (math.pi / 2, 0.9),
             'nose': (0.15, 1.1), 'tail': (math.pi - 0.15, 1.2), 'top': (0.9, 4.5)}
    for view, (yaw, h) in views.items():
        if view not in VIEWS:
            continue
        look(cam, (math.cos(yaw) * d, math.sin(yaw) * d, h), (0, 0, 0.62))
        sc.render.filepath = os.path.join(PREVIEWS, f'car_{cid}-{view}.png')
        bpy.ops.render.render(write_still=True)
    for o in temp:
        K.remove(o)
    if 'lo' not in VIEWS:
        return
    lob = lo.body.to_object('prev_lo_' + cid, sharp_angle=math.radians(50))
    parts = [lob] + [m.to_object('prev_lo_' + n, sharp_angle=math.radians(50)) for n, m in lo.parts.items()]
    look(cam, (math.cos(0.62) * d, math.sin(0.62) * d, 1.5), (0, 0, 0.62))
    sc.render.filepath = os.path.join(PREVIEWS, f'car_{cid}-lo.png')
    bpy.ops.render.render(write_still=True)
    for o in parts:
        K.remove(o)


# ------------------------------------------------------------------ main

def main():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    K.reset_materials()
    ids = [c for c in CARS if not ONLY or c in ONLY]
    built = {}
    for cid in ids:
        hi = CARS[cid](1)
        lo = CARS[cid](0)
        built[cid] = (hi, lo)
        print(f'{cid}: hi {hi.body.tris()} tris + wheels {sum(w.tris() for w in hi.wheel.values())}, lo {lo.body.tris()} tris')
    if RENDER:
        cam = preview_scene()
        for cid, (hi, lo) in built.items():
            render_car(cid, hi, lo, cam)
        return
    # One file per car (only the ones built), packed with gltfpack, and its metadata beside it.
    for o in list(bpy.context.scene.objects):
        bpy.data.objects.remove(o)
    out = os.path.abspath(os.path.join(OUT, 'cars'))
    os.makedirs(out, exist_ok=True)
    root = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))
    tmp = tempfile.mkdtemp()
    for cid, (hi, lo) in built.items():
        obs = to_objects(cid, hi, lo)
        for ob in bpy.context.scene.objects:
            ob.select_set(ob in obs)
        raw = os.path.join(tmp, cid + '.glb')
        export(raw, selected=True)
        path = os.path.join(out, cid + '.glb')
        subprocess.run(['npx', 'gltfpack', '-i', raw, '-o', path, '-cc', '-kn', '-km', '-ke'], cwd=root, check=True, stdout=subprocess.DEVNULL)
        with open(os.path.join(out, cid + '.json'), 'w') as f:
            json.dump(hi.meta, f, separators=(',', ':'))
        print(f'exported {cid}: {os.path.getsize(raw)} -> {os.path.getsize(path)} bytes, ' + ', '.join(f'{ob.name} {tri_count(ob)}' for ob in obs))
        for ob in obs:
            bpy.data.objects.remove(ob)
    shutil.rmtree(tmp, ignore_errors=True)


if __name__ == '__main__':
    main()
