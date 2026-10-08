"""
Close-up renders of the exported characters' heads: every hairstyle and every hat on the
body's head, three-quarter front and back, in a grid (for checking the models).

    python tools/blender/preview_heads.py [assets_dir]
"""
import math
import os
import sys

import bpy

ASSETS = next((a for a in sys.argv[1:] if not a.endswith('.py')), 'src/chars/assets')
OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'previews')


def mat(name, rgb):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.node_tree.nodes['Principled BSDF'].inputs['Base Color'].default_value = (*rgb, 1)
    m.node_tree.nodes['Principled BSDF'].inputs['Roughness'].default_value = 0.7
    return m


def render(body):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=os.path.abspath(os.path.join(ASSETS, f'body_{body}.glb')))
    sc = bpy.context.scene
    obs = {o.name: o for o in sc.objects}
    skin = mat('skin', (0.85, 0.6, 0.45))
    colors = [(0.25, 0.15, 0.08), (0.9, 0.2, 0.3), (0.95, 0.85, 0.2), (0.6, 0.45, 0.4)]
    region_mats = [mat(f'r{i}', c) for i, c in enumerate(colors)]
    body_ob = obs['Body']
    for o in sc.objects:
        if o.type == 'MESH':
            o.hide_render = True
    sc.render.engine = 'CYCLES'
    sc.cycles.device = 'CPU'
    sc.cycles.samples = 10
    w = bpy.data.worlds.new('w')
    w.use_nodes = True
    w.node_tree.nodes['Background'].inputs[0].default_value = (0.78, 0.82, 0.9, 1)
    sc.world = w
    sun = bpy.data.objects.new('sun', bpy.data.lights.new('sun', 'SUN'))
    sun.rotation_euler = (0.8, 0.1, 0.5)
    sc.collection.objects.link(sun)
    cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
    cam.data.type = 'ORTHO'
    sc.collection.objects.link(cam)
    sc.camera = cam
    for sheet, prefix in (('hair', 'Hair_'), ('hats', 'Hat_')):
        items = sorted(n for n in obs if n.startswith(prefix) and not n.endswith('_lo'))
        temp = []
        for i, name in enumerate(items):
            cx = i * 0.42
            head = bpy.data.objects.new('h', body_ob.data.copy())
            head.data.materials.clear()
            head.data.materials.append(skin)
            piece = bpy.data.objects.new('p', obs[name].data.copy())
            me = piece.data
            me.materials.clear()
            for m in region_mats:
                me.materials.append(m)
            uv = me.uv_layers[0].data if me.uv_layers else None
            for poly in me.polygons:
                if uv:
                    u = uv[poly.loop_indices[0]].uv[0]
                    poly.material_index = min(3, max(0, int(u)))
            for o in (head, piece):
                o.location = (cx, 0, 0)
                o.rotation_euler = body_ob.rotation_euler
                sc.collection.objects.link(o)
                temp.append(o)
        n = len(items)
        sc.render.resolution_x = 2400
        sc.render.resolution_y = int(2400 * 0.62 / (n * 0.42))
        cam.data.ortho_scale = n * 0.42
        mid_x = (n - 1) * 0.42 / 2
        for view, yaw in (('front', 0.45), ('back', math.pi + 0.45)):
            d = 6
            cam.location = (mid_x + math.sin(yaw) * d, -math.cos(yaw) * d, 1.66 + d * math.tan(0.12))
            cam.rotation_euler = (math.pi / 2 - 0.12, 0, yaw)
            sc.render.filepath = os.path.join(OUT, f'heads_{body}-{sheet}-{view}.png')
            bpy.ops.render.render(write_still=True)
        for o in temp:
            bpy.data.objects.remove(o)


for b in ('m', 'f'):
    render(b)
