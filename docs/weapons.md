# Weapons: the model contract and how the pieces fit

The weapon system has four parts:

| Part | Where | What |
| --- | --- | --- |
| Data | `src/weapons/catalog.ts`, `attachments.ts`, `loadout.ts` | Every weapon, its stats and slots; every attachment; camos, charms, reticles, crosshairs; the gunsmith maths and save checks (unit-tested in `tests/weapons.test.ts`). |
| Models | `tools/blender/build_guns.py` + `guns_*.py` → `src/weapons/assets/` | Every weapon and attachment modelled in Blender, one packed file each. |
| Runtime | `src/weapons/*.ts`, `src/combat/` | Loading and assembling a weapon from its loadout, first-person view model with arms, third-person holding (IK), animations, firing, projectiles and explosions. |
| Gunsmith | `src/ui/gunsmith.ts`, the gun shop | Buying weapons and parts, fitting them, stats, camos, charms, reticles, the HUD crosshair. |

## Model files

Built by `/opt/blender-venv/bin/python tools/blender/build_guns.py src/weapons/assets [--only=ids] [--render]`,
exported like the cars: each file is packed with `npx gltfpack -cc -kn -km -ke` and gets a
metadata JSON beside it.

- Weapons: `src/weapons/assets/guns/<weapon id>.glb` + `<weapon id>.json`
- Attachments: `src/weapons/assets/att/<attachment id>.glb` + `.json`
- Charms: `src/weapons/assets/att/charm_<id>.glb` + `.json`

### Space

Metres. **+x right, +y up, −z forward** (the muzzle points down −z, as a camera looks). The
**origin is the right hand's grip point**: the middle of the palm wrapped round the pistol grip
(launchers: the firing grip; the minigun: the rear firing handle). Shoulder weapons have the
butt plate at +z.

### Nodes in a weapon's file

| Node | What |
| --- | --- |
| `<id>` | The body: receiver, grip, trigger guard, fixed handguard, anything that never moves or swaps. Carries the metadata in its glTF extras (`weapon`, JSON). |
| `<id>_lo` | The whole weapon (standard parts) in about 600–1,200 triangles, for third person at a distance and NPCs. |
| `<id>_irons` | Iron sights that fold away or come off when an optic is fitted (omit if they're part of the body, e.g. a carry handle). |
| `<id>_barrel_<variant>` | One per barrel in the catalog (`std`, `short`, `long`, `heavy`, `sd`, `comp`...). |
| `<id>_mag_<variant>` | One per magazine (`std`, `ext`, `drum`, `fast`...). The reload animation moves this node, so its origin is the point where it seats in the magazine well. |
| `<id>_stock_<variant>` | One per stock (`std`, `none` = just the end cap if any, `heavy`, `light`, `brace`...). Origin at the stock's mount on the receiver. |
| Moving parts | Separate nodes, each with its origin at its pivot: `<id>_slide` or `<id>_bolt` (pulls back toward +z when firing), `<id>_charging` (charging handle), `<id>_trigger`, `<id>_hammer`, `<id>_pump` (shotgun forend, slides along z), `<id>_cylinder` (revolver: spins about z; `<id>_crane` swings it out), `<id>_breech` (break action: barrels hinge down about x), `<id>_cover` (LMG top cover, hinges up about x), `<id>_barrels` (minigun: spins about z), `<id>_rocket` (the warhead sticking out of the RPG), `<id>_pod` (M202 four-pack clip), `<id>_drum` (M32 cylinder). The animation code looks these up by name and moves what's there. |

Swappable parts the catalog lists but you don't model fall back to `std`; tell the lead.

### Metadata (`<id>.json`, the same as the extras on `<id>`)

```json
{
  "sockets": {
    "optic": [x, y, z],      // top of the rail (or the pistol slide cut) where an optic's base sits
    "under": [x, y, z],      // underside of the handguard rail, where a grip or bipod clamps
    "laser": [x, y, z],      // the right side rail, where a laser box clamps
    "charm": [x, y, z],      // where a charm hangs from (a sling loop or the rear of the receiver)
    "gripL": [x, y, z],      // the support hand with no grip fitted (handguard, magwell, foregrip, pump)
    "eject": [x, y, z],      // the ejection port (spent cases fly out of here, to the right)
    "magwell": [x, y, z]     // where the left hand grabs the magazine during a reload
  },
  "muzzle": { "std": [x, y, z], "short": [x, y, z], ... },  // the muzzle tip for each barrel
  "eye": [x, y, z],          // a point on the line through the iron (or built-in) sights, just behind the rear sight
  "length": 0.78,
  "color": 1710618           // the factory finish of the 'paint' surfaces
}
```

### Nodes in an attachment's file

`att_<id>` (and `att_<id>_lo` for the bigger ones), origin at its mount:

- Optic: the centre of its base on the rail. Its metadata has `eye` (the sight line point the camera lines up with) and `lens` `[x, y, z, radius]` (where the reticle is drawn, facing +z).
- Muzzle: the start of its thread; it extends along −z. Metadata `length` is how far the muzzle tip moves forward.
- Underbarrel: the rail contact; it hangs down −y. Metadata `gripL` is where the left hand holds it (grips).
- Laser: the rail contact on the right side; it sticks out +x. Metadata `beam` `[x, y, z]` is where the beam starts.
- Charm: the hook point at the top; it hangs down.

### Surfaces (materials, by name, like the cars)

`paint` (the main finish, which takes the camo: receiver, handguard, stock and mags, usually),
`metal` (dark gunmetal: barrels, bolts, pins), `steel` (bare steel), `polymer` (black plastic),
`rubber`, `wood`, `chrome`, `brass` (cartridges), `copper` (bullet tips), `olive`/`tan` (fixed
coloured furniture that doesn't take camo), `lens` (glass), `glow` (tritium dots, laser
apertures), `red` (rocket warheads, safety marks), `white` (markings).

Budgets: weapon body 4–12k triangles (the minigun and the M202 up to 16k), parts as needed,
attachments 0.5–4k; `_lo` about 1k.

## Runtime (TypeScript)

- `src/weapons/models.ts`: lazy-loads `guns/*.glb` / `att/*.glb` like the cars (meshopt
  decoder, quantized attributes back to floats), and `buildWeapon(id, loadout)` assembles a
  `WeaponRig`: the body, the chosen barrel/mag/stock, attachments at their sockets (the muzzle
  device at the chosen barrel's muzzle), the charm, the camo material on `paint`, and the
  moving parts as named groups the animator drives. Until the model arrives it returns a simple
  stand-in.
- `src/weapons/viewmodel.ts`: the first-person view model, drawn in its own pass over the world
  (its own field of view, depth cleared), with arms in the player's sleeves and skin, sway, bob,
  sprint, aim down sights onto the sight line (`eye` or the optic's `eye`), recoil, and every
  animation (draw, holster, fire, cycle, reload by `reloadStyle`, inspect, minigun spin).
- Third person: the weapon held by both hands with two-bone IK onto `origin` (right hand) and
  `gripL`/the grip's `gripL` (left hand), at the shoulder, hip or on the shoulder by `hold`; the
  same reload beats, smaller.
- Firing: `finalWeapon(id, loadout)` gives the stats; hitscan with range falloff, pellets,
  spread, recoil; rockets, homing missiles and grenades fly and explode (damage falls off over
  `splash`, cars take damage, people panic).
