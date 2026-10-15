# Casino Simulator 2: Jackpot Island

The sequel to [Casino Simulator: Jackpot Tycoon](https://scipiotoni.github.io/Casino-simulator/).
A 3D open-world casino game that runs in the browser, even on old computers.

**Play it:** https://scipiotoni.github.io/Casino-simulator-2/

You arrive over the Interstate 15 bridge in a rental with $30,000 and nothing else: no
home and no car (buy them, or fast-travel from the map). There's no story and nobody talks
at you: the island is yours to make your fortune on, gambling, buying lots and building on
them, and getting into trouble.

## What's on the island

- **Your own character.** The creator (and the wardrobe at home, or Wardrobe in the pause
  menu) lets you pick body, skin tone, height and build; eye colour, eyebrows, facial hair,
  lipstick, lashes and face details (freckles, blush, a scar, war paint...); hairstyle and any
  hair colour; and every piece of the outfit (top, bottoms, shoes, hat, glasses, neck, back,
  gloves, neon trim) in any colours. Special pieces come with the Drip Locker's outfits.
  Save up to eight looks and switch between them; other players see your look exactly.
- **A big island** with a city (Fortuna City), Old Town, a desert town, a fishing town in the
  north, mountains, a lake, farms, a wind farm, an airstrip, a container port and a marina.
  The minimap and the big map (M) work like the first game's.
- **Casinos with real rules.** Sit down at blackjack, roulette, craps, baccarat, three card
  poker, video poker and the slots and play in first person; the only interface is the betting options.
- **Lots and businesses.** Buy a lot on the big map, from Paradise Realty or the laptop in
  the flat, and choose what to build on it. A first casino costs $12,000, goes up in 15
  seconds and opens with three machines on the floor; casinos grow as you invest.
- **Property map.** The big map (M) filters the lots: for sale, ones you can afford with the
  cash you have, ones big enough for a casino, by price, size and district, and your own.
  Click a lot to buy it, mark it or teleport to its street; 🏠 Home teleports you home and
  🚗 Car dealers to the nearest dealer.
- **A home, when you want one.** The drive over ends outside Palm Court, where a flat is for
  sale ($8,000): buy it at the door to sleep (pass the night and save), change outfits at the
  wardrobe and browse lots on the laptop. Or build a house on a lot of your own. With a home
  you wake up there after a knockout instead of at the hospital.
- **Forty-odd cars after real ones,** modelled in Blender (no badges): hatchbacks, family
  cars, an electric saloon, minivans, pickups, off-roaders, a semi truck, '50s–'80s classics,
  luxury cars and supercars, at five dealerships round the island: **Island Motors** (new
  everyday cars, by the harbor), **Honest Eddie's** (used cars from $3,500, next to Palm
  Court), **Fortuna Exotics** (supercars and luxury on the Strip), **Dustwater 4x4** (trucks
  and off-roaders in the desert town) and **Halibut Bay Classics** (on the north coast).
  Each has four cars on its forecourt; what you buy is delivered to the kerb out front.
- **Shoplifting.** Sunny Mart corner stores are all over the island. Pocket things off the
  shelves while the clerk is on their phone; if they look up and catch you, the alarm goes
  off. Tagged stock can trip the door gates on the way out. Draw a gun at the counter to rob
  the register instead (that's a silent alarm). Sell what you lift at Pawn Paradise.
- **The docks.** Walk the piers at Coral Cove Marina and the quay at the Port of Fortuna
  (cranes, a container ship, stacks of containers). Take a speedboat or the cruiser out on
  the water. Each harbour office has timed cargo runs to the other one; some crates are hot,
  and halfway there the police get a tip-off.
- **Police and Fort Hammerhead,** the army base, with its armory.
- **Multiplayer.** Everyone playing shares the island: you see other players walk and drive
  around with name tags. Press **T** to chat (the only talking in the game).
- **The bridge to the first game.** Drive east over Interstate 15 to the mainland and you're
  offered the trip to Jackpot Tycoon; its own Interstate 15 bridge leads back here.

## Controls

| Key | |
| --- | --- |
| W A S D | Walk / drive |
| Mouse | Look |
| Shift | Run / boost |
| Space | Dodge roll (on foot) / handbrake (driving) |
| E | Use: doors, seats, shelves, counters, cars, boats; get out |
| 1–7 | Draw a weapon (Q to put it away), left click to shoot, right click to aim, R to reload |
| V | First / third person |
| M | Big map: property filters, click a lot to buy it or teleport there, anywhere else for a waypoint |
| T or Enter | Chat (`/help`, `/players`) |
| P or Esc | Pause menu (settings, graphics quality, save) |

## The characters

The people are modelled and rigged in [Blender](https://www.blender.org/), in a simple
hero style, and exported as glTF (`src/chars/assets/body_m.glb`, `body_f.glb`). Each body
is one continuous surface sculpted from metaballs and fused by a voxel remesh, decimated
(the head keeps more detail), rigged to the game's skeleton with automatic weights, and cut
along the clothes' edges (neckline, V-neck, waistband, sleeves, cuffs, hems, boot tops,
soles) so every outfit gets clean lines. Every hairstyle is a shell built over the modelled
head with boolean-cut hairlines, and the hats are modelled too.

To rebuild them you need Blender's Python module (`pip install bpy`, Python 3.11+):

```sh
python tools/blender/build_characters.py src/chars/assets --render   # the models (+ previews)
python tools/blender/preview_heads.py src/chars/assets                # close-ups of hair and hats
```

Previews land in `tools/blender/previews/` (not committed).

## Running it locally

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests
npm run build      # production build in dist/
```

Handy URL options: `?mqtt=ws://host:port` points multiplayer at your own MQTT broker;
`?mainland=<url>` points the bridge at another copy of the first game.

## Publishing

`.github/workflows/pages.yml` builds the game and deploys it to GitHub Pages on every push
to `main` (and the development branch). In the repository's **Settings → Pages**, set
**Source** to **GitHub Actions** once; after that every push publishes the game at
`https://<user>.github.io/Casino-simulator-2/`.
