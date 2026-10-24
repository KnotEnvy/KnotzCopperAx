# Golden Axe Feature Bible (research notes)

Owner: reference researcher. This is a precise record of what the originals actually do, so our design keeps the DNA on purpose. Images for every section are in `refs/golden-axe/` (see `refs/REFERENCES.md`).

Sources: StrategyWiki *Golden Axe* guide (Controls, Gameplay, Characters, Enemies, Stage 1–8, Scoring, The Duel), Hardcore Gaming 101 series articles (GA, GA II, GA III, Revenge of Death Adder), Wikipedia (GA, II, III, RoDA), Golden Axe Wiki (Fandom) wikitext via its public API, Genesis manual scans hosted there, and on-screen evidence in our ref frames. Damage and HP numbers are community-measured (StrategyWiki credits ninjasrok and lserh). Anything not confirmed is marked *(unverified)*.

Terms used below: **GA** is the 1989 arcade game (Sega System 16B). **MD** is the Mega Drive/Genesis port (1989/90). **GA2** is Golden Axe II (MD, 1991). **RoDA** is *The Revenge of Death Adder* (arcade, System 32, 1992). **GA3** is Golden Axe III (MD, 1993).

---

## 1. Controls and full move list (GA / MD)

Hardware: an 8-way stick and **3 buttons: Attack, Jump, Magic**.

| Move | Input | Behaviour |
|---|---|---|
| Walk | stick, 8-way | Free movement on the belt-scroll plane (left/right and in depth). |
| Run / dash | double-tap ← or → | Sprint. |
| Attack string, far | Attack ×3 | Two swings, then a **thrust** (Gilius: an **overhead chop**). The combo only starts once the first swing *connects*. Only the finisher knocks down. |
| Attack string, close | Attack ×n, touching the foe | Two swings, then **two pommel knocks to the top of the head**, then a **kick** that knocks down. |
| Throw | Attack on a **stunned** foe at close range | Hero lifts and throws the foe. Knocks down, low damage, **hits other enemies**, and is the main way to toss foes into pits and water. In GA2 you can press ← or → right after the pickup to choose the throw direction. |
| Jump | Jump | **Fixed height** regardless of hold time. Dash + Jump gives a longer, higher leap. |
| Jump attack | Jump → Attack | Jumping slash. **Always knocks down.** The strongest "safe" option in the arcade (StrategyWiki: "the most effective attack overall is the jumping slash"). Timing it above an axe swing hits Death Adder in the head for a knockdown. |
| Dash attack | dash → Attack in range | **Always knocks down.** Each hero's is unique. **Ax**: shoulder bash (low priority). **Tyris**: flying kick (high priority and widest reach; her most reliable attack). **Gilius**: headbutt. |
| Back / special attack | **Attack + Jump together** | Hits **behind** you. **Ax and Tyris**: an overhead sword swirl striking behind. **Gilius**: a backwards **rolling stab** that travels far and is largely invulnerable. **Always knocks down, high damage.** Cannot be used while mounted. GA2 changes it to a **360° spin** that hits all sides. |
| Death stab (plunge) | dash → Jump → Attack at the **apex** | Downward thrust into the skull. **Very high damage** and kills most non-boss foes in one hit. Enemies actively try to dodge it (moving up or down in depth). **Skeletons can do it to you** (16 dmg = 1 full bar). Cannot be used mounted in GA/MD. RoDA allows it while riding. |
| Magic | Magic | Consumes **all** pots and casts the tier they reach (§2). Hits every enemy on screen. |
| Mount | walk onto a riderless bizarrian | See §4. |

Hero differences (GA/MD):
- **Ax Battler** (barbarian, broadsword). Balanced attack and magic, the good choice for new players. His MD reach beats Tyris's.
- **Tyris Flare** (amazon, longsword). Strongest magic, shortest weapon reach, most agile, best flying kick.
- **Gilius Thunderhead** (dwarf, battle axe). Strongest melee with excellent reach and the best back attack, but the weakest magic and the slowest first swing. Deals **double damage in Duel versus**.
- All heroes deal roughly the same base damage. The differences are reach, speed and magic.

Health: each life has **3 life bars**. A single hit **chips** part of a bar rather than removing a whole one (1 bar = 16 HP). Losing all 3 costs a life. Food restores **up to 2 bars, capped at 3**. The HUD shows blue bar blocks, a lives digit and a portrait for each player.

Arcade feel notes:
- **Corpses stay on screen forever** in the arcade (MD removes them).
- Brutal digitised screams (the famous "OH GAWD!" sample from *First Blood*).
- The JP demo shows a decapitation with blood (`ga-arc_night-decapitation.png`).
- The select-screen lettering drips blood in JP.

## 2. Magic: pots, tiers, damage

Pots come from **Blue Thieves**. Food comes from **Green Thieves**. Magic hits **every enemy on screen**, and pressing Magic spends **all** pots ("all or nothing"). **Extra pots inside a tier add no damage** ("wasted pots").

The HUD shows numbered level boxes, and the pot icons fill slots inside them. A hero's first boxes hold several pots (see `ga-arc_s9_eagle-head-continue.png`, where Tyris's box 1 holds 4 pots). Thresholds are identical in GA and MD:

| Hero | Element | Tier: pots needed → damage (bars) | Spell (Genesis manual names) |
|---|---|---|---|
| **Ax Battler** (max 6 pots) | Earth / "volcano" | L1: 1–2 → 4 (¼) · L2: 3–4 → 8 (½) · L3: 5 → 16 (1) · L4: 6 → 24 (1½) | Crack · Large Crack · Explosion · **Big Bang** (mushroom-cloud eruption) |
| **Tyris Flare** (max 9 pots) | Fire | L1: 1–4 → 4 · L2: 5 → 8 · L3: 6 → 16 · L4: 7 → 24 · L5: 8 → 32 (2) · L6: 9 → 40 (2½) | Fire Spark · Pillar of Fire · Fire Ghost · Running Flames · Eruption (volcano) · **Dragon's Breath** (a huge white dragon breathes fire over the screen) |
| **Gilius** (max 4 pots) | Thunder | L1: 1 → 4 · L2: 2–3 → 8 · L3: 4 → 16 | Thunder Wave · Thunder Pole · **Thunderbolt** (bolts rain on every foe) |

Consequences:
- Tyris's L3 costs 6 pots for the same 16 damage Ax gets from 5 pots. Her magic only pulls ahead at L5–L6.
- Gilius reaches his max tier with the fewest pots.
- The screen-clearing spectacle scales with tier. Low tiers are small local sparks and cracks. The top tier takes over the whole screen (`ga-arc_s5_tyris-magic-fire-dragon.png`, `ga-arc_s5_gilius-magic-lightning.jpg`, `ga-md-manual_magic-*`).
- High-score trick: kill an enemy, then keep hitting the falling body with magic before it lands.

Series variants:
- **GA2**: pots become **magic books** dropped by little **wizards**. You **hold** Magic and release to pick the tier, spending only part of the stock. Ax changes to **wind**, Gilius to **rock**, and Tyris keeps fire (top tier: a fire **phoenix**). Books also extend the meter.
- **RoDA**: each hero has **one fixed spell** at a set pot cost, and you can carry more pots than the cost. Casts cut in to a **close-up of an enemy's face burning or turning to stone** (`roda_magic-cutin-closeup.png`). **Stern Blade** has fire. **Dora** (centaur) has earth and the cheapest magic. **Little Trix** grows **apple trees whose fruit heals**, the only non-offensive spell in the series. **Goah**, ridden by Gilius, has death/entropy magic (`roda_goah-magic-skull.png`).
- **GA3**: returns to the GA "spend all pots" rule, and adds **combined team magic** in co-op.

## 3. Enemy roster and behaviour (GA / MD)

GA uses **7 base enemy types, palette-swapped into stat tiers**. Grades run D < C < B < A.

| Enemy | Weapon / look | Tiers and colours | Behaviour and damage |
|---|---|---|---|
| **Heninger** | Spiked mace, headband, muscular soldier | Silver, Purple (D) · Green, Gold (C) · Dark, Bronze (B) · Red (A). Speed B for Red/Gold/Dark. | 2-hit combo (2 dmg each) + knockdown (4). Dash attack (4) is **unblockable**. |
| **Longmoan** | Spiked club, horned helmet, blue tunic | Same tiers as Heninger | Same damage. Its dash can be **stopped only by your own dash attack** (dash clash). |
| **Amazons** (Zuburoka family: Storchinaya, Strobaya, Lemanaya, Gruziya) | Female warriors | Purple, Green (B) · Red, Dark (A) | Faster. Their dashes are **unblockable**. They often arrive riding bizarrians. |
| **Skeleton** | Sword + skull shield, "Harryhausen" undead | White (B) · Purple (A, arcade and Duel only) | **Uses every hero move**: dash, jump slash (12), **death stab** (16), a 4-hit combo (24 total). **Double the damage** of grunts. Emerges from the ground and appears in set pieces (Fiend's Path, castle, dungeon). |
| **Bad Brothers** | Twin bald hammer giants | Green (C), Silver (B), Red (A). MD adds Sgt. Malt and Sgt. Hop (blue) and Gen. Heartland (red). | Dash (8), everything else a full bar (16). In the **arcade they grab and toss** a player who crosses them unless the player is mounted. They **cannot ride**. Stage 1 boss. |
| **Knights** (Lt. Bitter, Col. Bitter, Gen. Bitter) | Full plate, sword + shield | Silver (B speed), Red and Gold (A) | Every hit costs a full bar (16). **Cannot run or ride.** They swing early against dash-ins in the arcade. The best answer is to out-range them with a dragon, or to dodge in depth and counter. |
| **Death Adder** (GA final boss) | Red armour, horned mask, the Golden Axe | A | Axe swing (16). He **crouches to plant a ground spark that crawls and homes** at you (8), which passes through other enemies. He is **vulnerable while crouching**. He runs but has no dash or plunge. He summons **four Purple Skeletons** in the arcade. |
| **Death Adder Jr.** | Blue armour | A | MD Beginner-mode stand-in for Lt. Bitter. His projectile flies through the air. |
| **Death Bringer** (MD true final) | Pink armour, green skin | A, 128 HP | Death Adder's kit, but his sparks **split into 6 homing trails**. After knocking you down he **casts hero magic**: Gilius L1 thunder, Ax L3 earth, or Tyris L6 fire (a purple dragon). He has two escort skeletons with 256 HP. |
| **Blue Thief** | Gnome in blue with a sack | none | Non-hostile. **Drops magic pots when hit** (StrategyWiki: "hit the Blue Thief twice until he drops his magic pots"). Carries 1–5+ pots depending on placement. **Steals pots during camp.** |
| **Green Thief** | Gnome in green with a sack | none | Drops **meat/food**. **Never steals.** |

Naming humour: the soldiers carry beer-brand names (Malt, Hop, Bitter, Heartland), and the town has a "Sega Beer Garden" sign. Tone: grim barbarian fantasy with a wink.

AI traits worth copying:
- Enemies **pin you from both sides**. StrategyWiki advises "hide in the cleft".
- Grunts **jump up to high ground** after you, and you can swat them out of the air.
- Arcade grunts do a **short jump-slash to knock you off your mount**.
- Enemies **pause for a few seconds** on arrival. Bosses hold back until the wave's grunts are dead.
- Enemies strike on **wake-up** and have no mercy invincibility, so you can meet a knight with fire as he stands.
- Enemies walk off ledges when chasing, and dashing enemies can be baited into pits by jumping over them.

## 4. Bizarrians (rideable beasts)

- To steal one, knock the rider off, or mount a **dormant** riderless one. You are knocked off by hits.
- **You lose your bizarrian between stages.** Only RoDA lets you keep it. GA3 lets you **dismount at will**.
- Bad Brothers and Knights **cannot ride**. You cannot back-attack or death-stab while mounted (GA/MD).

| Beast | Attacks (damage) | Notes |
|---|---|---|
| **Chicken Leg** (Cockatrice, from *Altered Beast*) | Dash (4); **tail whip** (8): it spins to face away, so the whip is powerful but delayed | Beaked bipedal creature with a clubbed tail, a saddle and a spiked yellow collar (`ga-art_bizarrians-official.png`). Its dash is great against slow bosses. |
| **Blue Dragon** | Dash (4); **fire-breath stream** (8) with fairly long range | Roots in place while breathing. Its flame range beats the knights' reach. |
| **Red Dragon** | Dash (4); **fireball** (8) that crosses the whole screen, even offscreen | Roots while spitting. **Only one fireball can be in flight at a time.** It appears in Turtle Village and at the start of the mainland stage (arcade; that MD stage uses a blue dragon). |

Later games:
- **GA2**: Chicken Legs, **Green Dragons** and **Fire Dragons**.
- **RoDA**: a giant **mantis** that snaps a foe's neck as a finisher, a **fire-breathing mantis**, a **scorpion** that arcs electricity between its claws, and a fire-breathing **skeleton dragon**. Dora switches to human legs to ride. **Mini ballistae and catapults** can be carried and fired even while riding.
- **GA3**: a snail-ostrich hybrid in purple (tongue lash) and green (longer tongue), a **red dragon** (a travelling flame wave), and a **green dragon** that **bites and throws foes over its shoulder**.

## 5. Stages, content and set pieces

The **arcade HUD numbers camps as stages** (1, 3, 5, 7, 9 are action; 2, 4, 6, 8 are camps). The end tally groups them the same way (1-2, 3-4, 5-6, 7-8, 9). Home numbering is shown in brackets.

| Arcade stage | Name | Content and set pieces | Boss |
|---|---|---|---|
| **1** [1] | Village Outskirts / Old Firewood Kingdom (wilderness) | Opens on the dying messenger **Alex** in a cutscene (MD: your hero narrates instead). Dead forest, rock walls and a raised rock platform to jump onto. Heninger and Longmoan pairs, blue thieves (2 + 1 pots), and a **Storchinaya riding a Chicken Leg** for your first mount. The boss arena is under a **blood-orange dusk sky**. | **Bad Brothers** ×2 with Heningers, one on a Chicken Leg. They wait until the grunts die. |
| 2 | Camp (night) | See §6 | — |
| **3** [2] | **Turtle Village**, a village of thatched huts on a giant turtle's shell | Drop down to a ledge; holes let you knock foes to their death. A **"hide in the cleft"** pincer moment. **Villagers flee screaming**, chased by a Storchinaya on a **Blue Dragon**. A blue thief with 3 pots. Strobayas stand frozen for a few seconds. A Lemanaya on a **Red Dragon** with a Skeleton. The map afterwards shows **the turtle has swum south** carrying you. | Amazons ×2 + Skeleton |
| **5** [3] | Mainland coast / Turtle Island town | Knock a Heninger **into the water**. A Lemanaya on a dragon (red in the arcade: keep it for the whole stage). A **gap that needs a dash-jump**. **Doors marked "Sega Beer Garden"** release hammer giants. Two thieves hold 5 pots. Gold enemies. The boss walks out through the doors with two escorts. | **Lt. Bitter** (knight). Beginner: Death Adder Jr. |
| **7** [4] | **Fiend's Path**, the back of a giant eagle | Seize the **high ground** and swat enemies as they jump up. Ledges drop into water. Skeletons. **"The sun will now set, indicating a boss fight"**: a time-of-day shift mid-stage. Two waves of dark grunts and skeletons. The map then reveals the path **was a giant eagle** flying you to the castle. | Skeleton ×2 wave |
| **9** [5–6] | **Eagle's Head → Death Adder's Castle** | Step off the eagle's head, past its giant eye and beak, onto a stone bridge over the sea. Skeletons drop off the eagle. A Lemanaya on a dragon. Two **Col. Bitters** as a knight duo. Ramparts and round towers over the sea. Thieves with 6 pots. Mini-boss **Gen. Heartland** (MD) with escorts. Throne room: **the King and Princess hang chained from the ceiling** above corpses. **Snakes slither together into Death Adder** from a helmet on a corpse pile (MD: he walks out of double doors). He summons **four Purple Skeletons**. On defeat **the Golden Axe flies from his hands into his gut** in a blood shower, and the captives are **lowered from the ceiling**. The arcade keeps your dragon from stage 9's start. | **Death Adder** |
| — [7] | Dungeons (MD only) | Pits everywhere (knock everything in). Bronze Heninger and Longmoan **statues come to life**. 7 pots from two thieves. Gen. Bitter ×2, who can walk on the chasm. | Gen. Bitter ×2 |
| — [8] | Death Bringer's Lair (MD only) | He waits on his throne until two skeletons enter, then attacks. Beating him knocks the axe out of his hands and the skeletons vanish. | **Death Bringer** |

Between stages there is a **journal and map interlude**. A hero writes in a journal, and the parchment map shows progress (the turtle moves south, the eagle is revealed). The world is a **journey across living giant creatures**: the turtle and the eagle.

Endings:
- **Arcade**: the axe impales Death Adder and the royals thank you. Then a **fourth-wall finale**: three kids are playing Golden Axe in a closed arcade, the cabinet shorts out, the game's monsters burst into the real world chasing them, and the three heroes follow (`ga-arc_ending-real-world-arcade.png`). Last comes the "Fin" map with CONGRATULATIONS.
- **MD**: the King promises a feast. In the credits, Ax and Tyris nap while Gilius pitches text balls to a Longmoan who bats them into the sky as credits. Then the heroes toss their pots into the air, which spell **E N D** ("FIN" in some versions).

## 6. Bonus stage: the night camp

- Night falls after each of the first four action stages (arcade stages 2, 4, 6 and 8). Stars, a campfire, and the stage's signpost behind you (`ga-arc_bonus-camp-night-thief.png`).
- **Blue Thieves sneak in and steal pots from your stock** (typically 2). Kick them to get your pots back **plus extras** (typically +2–3).
- **Green Thieves** bring **meat** that restores life bars (up to +2, capped at 3). Per camp, e.g. Stage 3's camp holds 2 meat + 2 pots.
- If you are too slow, the thieves escape with your pots.
- **The fourth camp is the last one.** After it you must ration magic, because pots only come from stage thieves.
- **RoDA** night scenes include skeleton ambushes by the fire (`roda_skeleton-horde-camp.png`). **GA3** thieves **burrow like moles**, which makes them hard to hit.

## 7. Lives, continues, scoring and rankings

- **Arcade**:
  - Coin-op with **drop-in 2P** ("PUSH 2P START").
  - When a player dies with no lives left, their HUD slot shows a **"CONTINUE? N"** countdown (`ga-arc_s9_eagle-head-continue.png` shows "CONTINUE? 6").
  - "GAME OVER" appears in gold lettering (`ga-arc_game-over.png`).
  - RoDA allows unlimited continues and **switching character when you continue**.
- **MD**: lives and credits are option-selectable *(unverified: exact defaults)*. Includes a Beginner mode that ends after stage 3 at the score screen.
- **Arcade end tally, "YOUR STRENGTH"** (`ga-arc_ranking-your-strength-class.png`; the JP version called it *Hensachi*, a school-ranking term):
  - **Table**: STAGE (1-2, 3-4, 5-6, 7-8, 9) | SCORE | DEATH. Stage weights rise steeply. The example perfect run reads 14.0 / 25.5 / 36.0 / 60.0 / 96.0.
  - **Strength**: the stage scores summed + 30. The example: 231.5 + 30 = **261.5**, matching the reported formula *strength = 30 + score / (deaths + 1)*.
  - **What scores**: per-kill value depends on the stage, the enemy class (small ×1, big ×2, last boss ×8) and **how** it died (life depleted ×1, **dropped off-screen/pit ×2**, both ×3). **Deaths are heavily penalised. Magic use doesn't matter.**
  - **CLASS ladder**, shown with the % of players in each class: **A+++** (100~) 1% · **A++** (~100) 6% · **A+** (~60) 4% · **A** (~55) 4% · **B** (~50) 9% · **C** (~45) 14% · **D** (~40) 29% · **F** (~35) 33%. A **sword cursor** points at your class, and "**PERFECT!**" appears for a no-death run.
- **GA2**: gives a **rating after every level** plus a final one. The ladder runs F (~40), E (40~), D (50~), C (60~), B (70~), A (80~), AA (90~), SA (100~).
- *(The "beast/animal rank titles" the brief mentions could not be confirmed for GA1. The documented end screens use the letter CLASS ladder above.)*

## 8. The Duel (MD and home ports)

- **1P**: a gauntlet of **fixed escalating rounds** (MD has **12**). You start with **8 life bars, no healing, no magic**. Enemy life bars show under yours and are shared when there are several foes. The MD background colour changes every two rounds.
- **MD rounds in order**:
  1. Longmoan on a Chicken Leg
  2. 2 Heningers
  3. Heninger on a Red Dragon
  4. 2 Skeletons
  5. 2 Red Longmoans
  6. 2 Lemanayas on Red Dragons
  7. 2 Dark Heningers + a Dark Longmoan
  8. 2 **Purple Skeletons** (Duel-exclusive on MD)
  9. 2 Bad Brothers
  10. Lt. Bitter
  11. 2 Gen. Heartlands
  12. 2 Gen. Bitters
- **Win**: the credits roll. **Loss**: "you are defeated on the way to glory". Either way you see your score and the round you reached.
- **2P**: head-to-head **versus** with the full move set. **Gilius deals double damage.**
- **DOS**: 15 rounds, ending with Death Adder and then Death Bringer. Life bars are hidden from round 9.
- **GA2**: Duel has 15 rounds on one fixed arena.

## 9. What the sequels added (candidates for "2026 evolution")

- **Golden Axe II** (MD 1991): see the magic variants in §2. Other additions:
  - The back attack becomes a **360° spin**, and you **choose the throw direction**.
  - New enemies: lizardmen, headless knights, man-beasts and magic-book wizards.
  - A per-level **rating**.
  - Seven stages: Ravaged Village, Ruins, Tower, Dragon's Throat, Castle Gates, Castle, Dark Guld's Chamber. Each ends with a big group-boss fight.
- **Revenge of Death Adder** (arcade 1992), widely called the series peak:
  - **4-player co-op**.
  - Four new heroes: **Stern Blade**, **Dora** the centaur, **Little Trix** (a pitchfork imp), and **Goah** the giant carrying **Gilius** on his back, who casts the magic.
  - **Branching paths** at 2 forks, with a hand-drawn map UI.
  - A **co-op group throw** (spinning piledriver).
  - A **kick that stuns**, and the plunge while mounted.
  - **Crates** with power-ups, **switches and cages to free prisoners**, and destructible **statues, doors, chests and tree-men** (a well-timed heavy blow **shatters** a tree-man into splinters flying at the screen).
  - **Scaling set pieces**: dodge **boulders rolling at the screen**.
  - Siege weapons, and **destroyable enemy projectiles**.
  - Many **death and stagger animations**.
  - Huge, detailed sprites with waterfalls, mushroom forests, burning villages and markets.
  - Bosses reuse a pattern template with one unique move each, including an armoured scarecrow with a scythe.
- **Golden Axe III** (MD 1993):
  - Four heroes: Kain Grinder, Sarah Burn, Proud Cragger, Chronos Lait. Gilius appears as an NPC.
  - **Branching junctions**.
  - **Blocking**, sweeps and projectile attacks, plus two **special moves** per hero and a screen-crossing super.
  - Deeper **grapples** (Proud's **air-slam throw**), and **double jump / wall jump** (Sarah, Chronos).
  - **Co-op team attacks** ("human slingshot") and **combined magic**.
  - **Rescue prisoners for extra lives**.
  - Thieves return.
  - A **VS mode** that includes bosses.
  - A **score-gated good ending** with the final boss's second form.

---

## Gaps vs docs/DESIGN.md

Concrete original features our design is missing or getting wrong. Each item names the fix.

1. **Pot economy is wrong.** DESIGN has one pot = one bar. The originals use **uneven thresholds** with a **"wasted pots" dead zone**:
   - Brann (Ax analogue): 6 pot slots, tiers at 1–2 / 3–4 / 5 / 6.
   - Seraphine (Tyris): 9 slots, tiers at 1–4 / 5 / 6 / 7 / 8 / 9.
   - Gorrim (Gilius): 4 slots, tiers at 1 / 2–3 / 4.
   - Damage table 4 / 8 / 16 / 24 / 32 / 40.
   - The HUD should show **numbered tier boxes that contain pot icons**, not simple bars. This keeps the famous trade-off: Tyris is weak until she is saving 8–9 pots, and Gilius reaches max tier cheaply.
2. **Moves are mis-assigned.**
   - DESIGN's "Jump attack = diving down-thrust that hits OTG" should be a **jumping slash that always knocks down**.
   - The high-damage **downward skull-stab is the dash → jump → attack-at-apex "death stab"**, which enemies try to dodge in depth. Skeletons must be able to do it to you.
   - DESIGN's "running jump attack = big leaping slash" should be this plunge.
   - Jump height is **fixed**. Dash + jump is the long leap.
3. **The back attack is under-designed.** It should be a signature hero move (Brann and Seraphine: an overhead swirl behind; Gorrim: a long **invulnerable backward roll-stab**) that always knocks down and does high damage. It is not a "pommel or elbow". It is disabled while mounted. GA2's 360° version is a good tier-up or charge option.
4. **The close-range string branch is missing.** Light near a foe should auto-branch after 2 hits into **2 pommel knocks, then a kick or throw**. Far away, 2 swings + a thrust/chop. **Combos start only on connect.** Throw direction is selectable (GA2).
5. **Dash identity and dash rules are missing.** Each hero needs a unique dash attack with different **priority**: Brann a shoulder barge (low), Seraphine a flying kick (high, widest), Gorrim a headbutt. Enemy dashes are **unblockable**, and a Longmoan-type dash is **only stoppable by your own dash** (a dash-clash rule).
6. **Mount rules are missing.**
   - No back attack or plunge while mounted.
   - Grunts **jump-slash riders off**.
   - The **giants grab and toss unmounted players**, so being mounted is protection.
   - The Chicken Leg's tail whip has a **turn-around wind-up**. Dragons **root while breathing**. The red dragon allows **one fireball in flight at a time**. All mounts have a dash attack.
   - **Knights and giants cannot ride.**
   - **Beasts are lost between stages** (the documented rule). Whether GA beasts flee on their own is unverified, so treat DESIGN's "wanders off after a time" as our own addition.
7. **Thieves' Night is missing the theft.**
   - Blue thieves **steal from your current stock** while the heroes sleep. You kick them to recover the stolen pots plus extras before they escape.
   - Green thieves bring meat (+2 bars, cap 3).
   - A camp follows **each of the first four stages only**. The last camp is a rationing beat.
   - DESIGN currently frames it as a timed kick minigame with no loss state.
8. **Health model detail.** Use **3 life bars per life** with partial chip damage (1 bar = 16 HP of scale), food capped at 3 bars, and the 8-bar Duel start. DESIGN's 100/85/120 HP is fine internally, but the HUD should read as GA-style bar blocks.
9. **The end-of-game "YOUR STRENGTH" / CLASS screen is missing.** It needs:
   - A per-stage-pair **score + deaths** table, and strength = 30 + Σ(stage-weighted kill value) / (deaths + 1).
   - **Ring-out kills are worth ×2** (×3 with a depleted-life kill), and magic use is score-neutral.
   - A **letter ladder A+++ → F with a "% of players" column**, a sword cursor on your class, and **"PERFECT!"** for a no-death run.
   - An optional **GA2-style per-stage rating** (F … AA, SA).
   - DESIGN only has a top-10 initials table.
10. **Continue UX is missing.** Each dead player's HUD slot needs an in-place **"CONTINUE? N" countdown** while the partner keeps playing, **drop-in at any time**, and gold "GAME OVER" lettering. RoDA-style **hero switch on continue** would be a modern plus.
11. **Death Adder / Morvane set pieces are missing.**
    - He **forms from swarming snakes** around his helmet on a corpse pile.
    - He **crouches to plant a ground-crawling homing spark**. The crouch is a vulnerable window, and a well-timed jump slash to the head knocks him down.
    - He summons **4 purple (elite) skeletons**.
    - The **King and Princess hang chained above the arena** and are lowered at the end.
    - The kill is **the Golden/Copper Ax flying out of his hands and impaling him**.
    - Consider the MD **Death Bringer** twist for phase 2: after knocking a player down, he **casts the heroes' own spells back** (thunder L1 / earth L3 / fire L6 with a dark-tinted dragon), and his sparks split into 6.
12. **Stage set pieces are missing.**
    - The **dying-messenger opening** (Alex) in stage 1.
    - The **journal + parchment map interstitials** showing the turtle swimming and the eagle reveal.
    - A **mid-stage sunset** that telegraphs the boss (Fiend's Path, and the stage 1 dusk arena).
    - A **"hide in the cleft" pincer** ambush.
    - Frozen-then-attack boss escorts, and **bosses waiting until grunts die**.
    - Villagers fleeing a mounted raider.
    - A **gap that needs a dash-jump**.
    - Water, pit and hole **ring-outs in stages 2, 4 and 5**, not only on the eagle.
    - **Statues that come alive** (MD dungeon).
    - **Enemies emerging through doors** (the "Beer Garden" doors gag).
13. **Arcade flavour is missing.**
    - **Corpses persist on screen** (arcade DNA; modern: persistent ragdolls with a cap).
    - Visceral screams.
    - An optional **gore toggle** (JP decapitation, blood-dripping select lettering).
    - The **fourth-wall ending** (heroes chase monsters out of an arcade cabinet into the real world), and the credits gag (a grunt bats credit text into the sky; pots spell "END").
    - The select screen staged in **giant skeleton hands**.
    - Beer-pun elite names (Sgt. Malt/Hop, Lt./Col./Gen. Bitter, Gen. Heartland).
14. **Enemy tiering depth.** GA uses 7 palettes per grunt type (Silver, Purple, Green, Gold, Dark, Bronze, Red) with graded strength and speed, named amazon variants (Storchinaya, Strobaya, Lemanaya, Gruziya), a knight rank ladder (Lt. → Col. → Gen.), and **white vs purple skeletons**. DESIGN's 4 tiers are fine, but it needs the **named elite ranks** and a knight/"Hollow Knight" rule: **cannot run or ride, every hit costs a full bar**.
15. **Duel mode is wrong shape.** The original is **fixed, hand-authored escalating rounds** (12 on MD), 8 life bars, **no magic, no healing**, shared enemy life bars on the HUD, and a **2P versus** mode (Gorrim double damage vs players). DESIGN only says "endless gauntlet".
16. **RoDA/GA3 innovations not yet in DESIGN** (pick deliberately):
    - **Branching routes** with a map choice.
    - **Prisoner or cage rescue for extra lives**.
    - **Crates with power-ups**.
    - **Siege weapons** (ballista, catapult) usable on foot or mounted, and **destroyable projectiles**.
    - **Boulder-chase** set pieces toward the camera (perfect for our 3D camera).
    - **Tree-men that shatter** on a heavy blow.
    - A **co-op group throw or piledriver**, a GA3 **"human slingshot"** and **combined team magic** (richer than our single "Relay" bonus).
    - New mounts: a **mantis with a neck-snap finisher**, a **scorpion with an electric arc**, a **skeleton dragon**, and a **bite-and-throw dragon**.
    - **Enemy-face magic cut-ins**.
    - **Keep your beast between stages** (RoDA).
    - **Dismount at will** (GA3).
17. **Magic charge option.** GA2's **hold-to-choose tier** (spend part of your stock) is the series' own modernisation of the pot rule. DESIGN currently hard-codes GA1's all-or-nothing rule. Decide explicitly. Suggested: tap = all-in (GA1 DNA); hold = choose tier (GA2).
18. **Stage count and structure.** GA has 5 action stages plus 4 camps, and the arcade HUD numbers them 1–9. MD adds 2 castle stages (Dungeon and Death Bringer). DESIGN's 5 stages match the arcade, but stage 4 (Serpent Keep Gates) should borrow the **Eagle's Head arrival → sea-rampart knight duo → throne** flow, and stage 3 should end with the eagle delivering you to the castle.
