# KnotzCopperAx — Game Design Bible

A 3D side-scrolling fantasy beat-'em-up in Three.js. It's a spiritual successor to Sega's *Golden Axe* (1989 arcade, plus the Mega Drive port and *Revenge of Death Adder*). It keeps everything those games had and brings it up to 2026 production values. Every agent builds against this document. If you change a design decision, update this file in the same edit.

## 1. Pillars
1. **Arcade soul.** The game reads instantly. The belt-scroll plane, pots from thieves, stealing beasts, screen-clearing magic, and "GO →" pacing all make you want one more credit.
2. **Weight and juice.** Every hit sells: hitstop, anticipation, smears and trails, sparks, camera punch, knockback arcs, bounces, dust, rumble, and layered SFX.
3. **Painted-myth visuals.** The art direction is Frazetta/Vallejo box-art fantasy translated into modern stylized-PBR 3D. It has dramatic rim light, volumetric haze, embers, rich dusk palettes, heroic exaggerated proportions, and readable silhouettes. It must NOT look like low-poly nostalgia or programmer art.
4. **Depth without confusion.** The game is fully 3D. Movement happens on a belt plane (X = scroll, Z = depth lane). A cinematic camera dollies and swings slightly for drama, but the side-scroll readability always stays.
5. **Couch co-op first.** 1–2 local players on keyboard or gamepads. Drop-in at character select.

## 2. Heroes (3 playable)
| | **Brann Stormhewn** | **Seraphine Vey** | **Gorrim Knotbeard** |
|---|---|---|---|
| Archetype | Barbarian swordsman (balanced) | Agile blade-dancer (speed/air) | Dwarf axeman (power/grapples) |
| Height | 1.95 m, massive shoulders | 1.76 m, lithe | 1.38 m, as wide as tall |
| Weapon | Two-handed greatsword *Grudgebrand* | Twin curved sabres *Dawn & Dusk* | The **Copper Ax**, a double-bit copper-and-rune greataxe |
| Look | Bronze skin, black mane, fur-trimmed kilt, leather harness, bracers, battle scars | Auburn braid, scale-leather armour, crimson sash, gold circlet, war paint | Copper-red braided beard with brass knots, horned iron helm, chainmail, massive bracers |
| Magic | **EARTH** — 4 levels | **FIRE** — 6 levels | **STORM/LIGHTNING** — 3 levels |
| Life / speed | 3 bars (48 HP) / 1.0 | 3 bars, takes ×1.1 dmg / 1.2 (best jump) | 3 bars, takes ×0.85 dmg / 0.85 (small hurtbox) |

**Magic ladder (authentic GA thresholds, uneven with dead zones).**
- Brann holds 6 pots: tier 1 = 1–2 pots, T2 = 3–4, T3 = 5, T4 = 6.
- Seraphine holds 9: T1 = 1–4, T2 = 5, T3 = 6, T4 = 7, T5 = 8, T6 = 9.
- Gorrim holds 4: T1 = 1, T2 = 2–3, T3 = 4.
- Tier damage to every enemy on screen runs 4/8/16/24/32/40.
- The HUD shows **numbered tier boxes that fill with pot icons**, not one bar per pot.
- **Tap Magic** spends everything (GA1). **Hold Magic** scrolls down to a lower tier and spends only its cost (GA2 modern option).
- Higher tiers are longer, bigger, and screen-clearing, with a full-screen cinematic. The camera pulls back, time slows for a beat, the world darkens, and the hero is lit by the spell. Close-up cut-ins of burning or shocked enemy faces appear on T3+.
- 2P: if both players cast within 0.5 s, it becomes a combined **Knot Surge** team spell.
- Brann EARTH: L1 *Tremor Shards* (ground cracks with spikes) · L2 *Stone Pillars* (a row of basalt columns erupts) · L3 *Boulder Rain* · L4 *Mountain's Wrath* (a colossal stone titan's fist smashes down; the whole screen quakes).
- Seraphine FIRE: L1 *Flare Burst* · L2 *Fire Serpents* (twin homing flames) · L3 *Pillar Blaze* · L4 *Inferno Wave* · L5 *Drake of Cinders* (a fire dragon sweeps the screen) · L6 *Phoenix Sun* (a vast phoenix dives and the screen goes white-gold).
- Gorrim STORM: L1 *Crackle* (bolts strike nearby foes) · L2 *Chain Tempest* (chain lightning plus a storm cloud) · L3 *Thunder Anvil* (a giant hammer of lightning slams from the sky).

## 3. Controls & Moveset (shared grammar, per-hero flavour)
Buttons: **Light**, **Heavy**, **Jump**, **Magic**, **Dodge**. Movement: 8-way on the belt plane.
- Keyboard P1: WASD move · J light · K heavy · L jump · I magic · U dodge · Enter start.
- Keyboard P2: Arrows move · Numpad1 light · Numpad2 heavy · Numpad3 jump · Numpad5 magic · Numpad0 dodge · NumpadEnter start.
- Gamepad (standard mapping): X/□ light · Y/△ heavy · A/✕ jump · B/○ dodge · RB/R1 magic · LB/L1 dodge alt · Start.

Classic moves (all heroes). These are mandatory, faithful to the GA research in `docs/GOLDEN_AXE_NOTES.md`:
- **Light string with two branches.** A combo only continues if the first hit connects.
  - *At range:* swing, swing, then a thrust or chop that knocks down.
  - *Close to a foe:* swing, swing, pommel knock, pommel knock, then a kick or **throw** (hold ← or → to aim it). A thrown foe damages the enemies it hits.
- **Run.** Double-tap left/right. Each hero has a **unique dash attack** with its own priority: Brann's shoulder barge (low), Seraphine's flying kick (high, widest reach), Gorrim's headbutt. If two dashes meet (a Longmoan-type dash vs yours), they **dash-clash**.
- **Jump attack.** A jumping slash that always knocks down. Jump height is fixed. Dash then jump gives the long leap.
- **Death Stab.** Dash → jump → Light at the apex. A huge downward skull-splitting stab with big damage. Foes try to sidestep it in depth, and skeletons can do it to you.
- **Back attack** (Light+Jump together). A signature high-damage move that always knocks down. Brann and Seraphine do an overhead swirl behind them; Gorrim does a long invulnerable backward roll-stab. It is disabled while mounted.
- **Magic.** Uses the pots (see the ladder above).

Modern additions:
- **Heavy** (hold to charge, 3 levels of charge with a flash). Heavy after 2 lights is a **launcher**, and jump-cancel into **air combos** is possible. Heavy in the air is a **slam** that ground-bounces.
- **Dodge.** Sidestep in depth or roll, with i-frames. A **perfect dodge** (within 6 frames of a hit) gives slow-mo for 0.6 s.
- **Juggle rules.** Gravity scaling per juggle hit, and a wall bounce off stage bounds or props. Knocked-down foes get 0.5 s of OTG window, then i-frames on get-up.
- **Combo counter and style rank** (D→C→B→A→S→KNOT). This is the score multiplier. It resets when you take damage or after 2.5 s of idle.
- **Cancel windows.** Light→Heavy, Heavy→Jump, any→Dodge on hit.
- **Team-up (2P).** Throwing a foe at your partner's swing gives a "Relay" bonus.

Frame data lives in data files at 60 Hz ticks: startup, active, recovery, hitbox shape per active frame, damage, hitstun, knockback, launch, hitstop.

## 4. Enemies
| Enemy | Role | Notes |
|---|---|---|
| **Pot Thief** (gnome-like imp in a hooded cloak with a huge sack) | Loot | Blue sack means magic pots, green sack means meat/health. Runs in, cackles, flees. Kick them to spill 1–3 items. Pots bounce and glint. |
| **Ashen Marauder** | Grunt | Club or mace. Colour tiers (straw → rust → violet → iron) raise HP and aggression. The Heninger/Longmoan analogue. |
| **Viper Maiden** | Agile | Whip-spear, leaping attacks, backflips away. Tyris-style silhouette (the Storchinaya analogue). |
| **Grave Skeleton** | Horde | **Rises from the ground** in dark stages. It crumbles into bones on KO and can reassemble unless you do an OTG hit or magic. Sword and shield, and it blocks. |
| **Hollow Knight** | Tank | Plate armour and halberd. It guards frontal light attacks. Crack it with heavies, throws, and back attacks. |
| **Ogre Brute** | Mini-boss | Giant with a hammer, ground-pound shockwave, and grab. Appears as a pair ("the Brute Brothers": the Bad Brothers analogue). |
| **Bosses** | see §6 | |

**AI and crowd.** There is an attack-token director (at most 2 foes attack one player at once, and the others circle or flank). Foes surround, feint, flank from behind, use depth, react to allies being thrown, and jump onto or off beasts. Difficulty scales token count and reaction time.

## 5. Bizarrians (rideable beasts)
Enemies ride in on them. Knock the rider off to steal the beast. A mounted player has 1–2 beast attacks and extra HP-soak, and gets knocked off by big hits. The beast wanders off after a time or when hit hard.
- **Cluckhorn.** The chicken-leg analogue: a bipedal beaked beast with a spiked club-tail. Its attack is a spinning tail whip, and it has a fast dash.
- **Emberdrake.** A blue-scaled small dragon with a short **fire-breath stream** (a cone).
- **Cinderwyrm.** A red dragon that lobs **fireballs** (ranged arc).
- **Tusker.** NEW: an armoured war-boar with a **charge ram** that bowls through crowds, and a buck.
- **Stormroc** (stretch goal). NEW: a flightless thunder-bird that stomps a shockwave.

## 6. Stages (clear progression plus variety)
Each stage runs 3–6 "screens". Each screen locks the camera until its wave clears, then shows the "GO →" arrow. Every stage has thieves, a beast encounter, destructible props with food or pots, and a boss.
1. **Ashen Wilds.** Burned village outskirts at blood-red dusk. Windswept grass, smouldering huts, ember storms, a ruined palisade, crows, a distant burning keep. Boss: **Brute Brothers**.
2. **Shellback Crossing.** A colossal ancient tortoise wades a misty lake with a village on its shell (Golden Axe's Turtle Village, reborn). Moss, rope bridges, lanterns, the shell horizon swaying slowly, and water spray. Skeletons rise here. Boss: **Hollow Knight Captains**.
3. **Eaglespine Skies.** Fight on the back of a giant eagle soaring through a canyon of cloud and stone spires (the Eagle stage reborn). Wind streaks, feathers ripple, and the camera banks. **Knock foes off the edges** for instant KOs. Boss: **Wyrm Riders** (a Viper Maiden captain on a Cinderwyrm).
4. **Serpent Keep Gates.** Midnight thunderstorm with rain, lightning flashes, a drawbridge, torch-lit courtyard, portcullis, and gargoyles. Boss: **Iron Chancellor Varkhul** (a giant knight-lord with a flail and lieutenant tactics).
5. **Throne of Coils.** The Adder King's obsidian throne hall: green witchfire braziers, colossal coiled serpent statues, and the stolen **Copper Ax relic** glowing on the altar. Final boss: **Morvane Deathcoil, the Adder King**, the Death Adder analogue. Phase 1: a hulking armoured tyrant with a giant axe who summons skeletons and casts shadow magic. Phase 2: the relic's power corrupts him into a serpent-coiled horror, and the arena starts cracking.
- **Between stages: Thieves' Night.** A bonus camp scene. Heroes rest by a campfire under the stars, thieves creep in to steal pots, and you kick them before they escape (timed). Faithful to the original's night bonus.
- **Ending.** The Queen is freed and the Copper Ax is restored, followed by the epilogue, credits, and the high-score initials entry.

## 7. Structure, rules, scoring
- Title screen with an **attract mode** (AI demo play), then mode select: **Arcade** (1–2P), **Duel** (endless gauntlet arena, the Genesis "Duel" analogue), and Options (volume, difficulty, controls, graphics quality).
- **Character select.** A 3D stage with the three heroes lit by torchlight. Each player picks independently.
- **Life bars** follow GA: 3 bars per life at 16 HP each. Hits chip part of a bar, and a modern smooth drain plus damage-ghost shows inside the blocks. Per-hero defence: Gorrim takes ×0.85 damage and Seraphine ×1.1. **Lives: 3 per credit. Continues: 3.** When a player dies, their HUD slot counts down "CONTINUE? 9…0" while the partner keeps playing. Drop-in is allowed at any time, you may switch hero on continue, and GAME OVER uses big gold lettering. Food (meat) restores bars up to the cap of 3; pots feed magic.
- **End-of-game YOUR STRENGTH / CLASS screen.** Shows score and deaths per stage. Strength = 30 + stage-weighted kill value / (deaths + 1), and ring-out kills count ×2. It has a letter-class ladder (A+++ … F) with a joke "percent of players" column, a sword cursor on your class, and "PERFECT!" for a no-death run. A per-stage rating (F…AA, SA) appears on the stage-clear tally.
- **Score.** Points per hit (scaled by the move), KO bonus, combo/style multiplier, pots collected, time bonus, no-damage screen bonus, and stage-clear tally. Top-10 local high scores with initials.
- **Environmental interactions.** Breakable crates, urns, and fences drop loot. Burning braziers can be kicked over to ignite foes. Cliff and edge ring-outs. Spike traps. Hanging lanterns and chains react to hits. Grass and cloth react to wind and to magic shockwaves. Puddles splash.

## 8. Feel targets (numbers to tune from)
- Light hit hitstop is 4–6 frames, heavy is 8–10, magic tier-final is 14. Camera shake uses a trauma model (trauma² amplitude).
- Hero walk is ~3.2 m/s, run ~7 m/s, and a jump reaches ~2.1 m apex for Brann.
- Input buffer is 8 frames, and cancels are buffered.
- Performance: 60 fps at 1080p on a GTX 1650-class GPU with post-FX on "High". There is also a "Low" preset.

## 9. Quality bar (critics compare against these)
- **Core feel and feature completeness.** Golden Axe (arcade 1989), Golden Axe II, Revenge of Death Adder, and the Mega Drive port.
- **Modern polish.** Streets of Rage 4 (hit feel and juice), TMNT: Shredder's Revenge (readability and co-op), Absolum (fantasy beat-'em-up art direction), Trine 5 (2.5D fantasy lighting and environments), Double Dragon Gaiden, and top Three.js showcase projects.

## 10. Canon corrections & additions from research (authoritative; see docs/GOLDEN_AXE_NOTES.md)
- **Mount rules.** No back attack or Death Stab while riding. Grunts jump-slash riders off. Ogres grab and toss unmounted players. The Cluckhorn tail whip has a turn-around wind-up. Drakes stand still while breathing. Only one Cinderwyrm fireball can be in flight at a time. Knights and ogres cannot ride. Beasts are lost between stages, and a player can dismount at will (Dodge+Jump).
- **Thieves' Night (camps after stages 1–4).** While the heroes sleep, blue thieves steal pots from the players' current stock. Kick them before they escape to get the pots back plus extras. Green thieves bring meat (+2 bars, capped at 3). The last camp before the throne is a quiet rationing beat.
- **Morvane Deathcoil script.** He forms from a swarm of snakes around his helmet on a pile of bones. His crouch plants a homing spark that crawls along the ground, and the crouch is his vulnerable window. He summons 4 elite purple skeletons. The captive Queen and her consort hang chained above the arena and are lowered at the end. Phase 2: after knocking a player down he casts that hero's own spell back, and his sparks split into 6. Finale: the Copper Ax tears free of his grip and impales him.
- **Set pieces.**
  - Opening: a dying messenger begs you on. A parchment-map interlude between stages shows the route; the tortoise swims and the eagle is revealed.
  - Warnings and ambushes: a mid-stage sunset warns of the boss. A pincer ambush has a cleft you can hide in. Bosses wait until their grunts die.
  - Traversal: villagers flee a mounted raider. A gap needs a dash-jump. **Ring-outs on pits and water in stages 2, 4, and 5** as well as the eagle. The stage 3 eagle delivers the heroes to the Serpent Keep. Statues come alive, and enemies burst through doors. A boulder chase rolls toward the camera in stage 4.
  - Props and prisoners: crates with power-ups, destructible enemy projectiles, and rescuable chained prisoners who give an extra life.
- **Elite ranks with our own pun.** Copper-corrosion titles: Sgt. Tarnish → Lt. Verdigris → Col. Patina → Gen. Oxide. Knights can't run or ride, and each of their hits costs a full bar. White skeletons are basic; purple skeletons use the full hero moveset at double damage.
- **Duel mode.** 12 hand-authored escalating rounds, 8 life bars, no magic or healing, and enemy life bars on the HUD. Plus a 2P versus sub-mode.
- **Co-op extras.** Relay throws. The **Partner Launch** (the GA3 "human slingshot": grab your partner and hurl them as a projectile). Combined Knot Surge team magic.
- **Arcade flavour.** KO'd foes linger briefly and collapse. There are visceral grunts and screams. Credits gag: a grunt bats the credit text into the sky, and pots spell out END. The character select is staged in giant skeletal hands. Stage numbering is **1–5 everywhere** (HUD, map, stage-clear tally, ranking): only the five action stages are numbered; Thieves' Night camps are named, not numbered (owner decision 2026-10-22).
- **Stretch or hard mode.** A dungeon stage and the Death Bringer-style true final boss, plus a branching route choice on the map.
