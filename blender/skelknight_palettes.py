"""Skeleton + Hollow Knight team (C2 r22): tier PALETTES and screen targets. Owner: TEXTURE & MATERIAL artist.

Builders import this through skelknight_team.tier_pal(family, tier, defaults) and never edit it. Keys are the ones
the Sept 2026 painters use (build_enemy_skeleton.py / build_enemy_knight.py PAL + TIER_PAL); a builder adds keys for
NEW parts in its own defaults, and the texture artist may then override them here. Values are LINEAR RGB (srgb()
below = blender/lib/shaders.srgb) or plain floats. Phase B palette D is frozen after real-mesh probes; it is calibrated against r22
stage captures; actual semantic painter rebakes and release checks remain required. TARGETS are screen
acceptance ranges in the engine (stage 1 + stage 2), not Blender values.

CALIBRATION 2026-10-27: the NAMED ashen-dusk preset has albedoFloor=.3/liftMax=4,
but stage1.js and stage2.js override BOTH to floor=0/liftMax=1, key intensity=1.2,
wrap=.12, metalAmbient=.6. Author against the effective stage settings, not the named
preset alone. The sRGB 20-60 controls mostly fall below L*18 there; no D1 floor override
is required. Measured chart: progress/shots/enemies-art-2/r22-team/texture/calibration.md.
TARGETS are acceptance ranges, not a claim that the current bake meets them.
"""
import numpy as np


def srgb(r, g, b):
    c = np.array([r, g, b], float) / 255.0
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


# ------------------------------------------------------------------------------------------------ SKELETON
SKELETON_BASE = dict(
    # white = basic grunt: warm aged ivory, the BRIGHTEST mass of the five tiers; black void behind the ribs
    bone=srgb(250, 241, 215), bone_dark=srgb(135, 111, 77), bone_grime=srgb(220, 200, 161), bone_soil=srgb(181, 154, 114),
    bone_ao_tint=(0.46, 0.39, 0.29),
    teeth=srgb(255, 246, 217), void=srgb(10, 8, 9), void_glow=srgb(60, 22, 10),
    iron=srgb(92, 88, 84), iron_patina=srgb(120, 66, 34), iron_patina_amt=0.8,
    leather=srgb(60, 40, 26), leather_worn=srgb(112, 84, 58),
    cloth=srgb(88, 56, 34),                 # ref: brown torn rags (r2 was dusty red)
    wood=srgb(110, 72, 42), wood_dark=srgb(52, 34, 20),
    horn=srgb(40, 32, 30), horn_tip=srgb(214, 200, 170),
    glow=(1.0, 0.38, 0.06), glow_strength=2.8,     # ember-orange pinpoints
)
SKELETON_TIERS = {
    "white": {},
    "purple": dict(
        # r23: blue-violet pigment compensates warm stage-3 daylight; chromatic AO preserves violet crevices.
        bone=srgb(104, 50, 218), bone_dark=srgb(30, 12, 77), bone_grime=srgb(80, 30, 174), bone_soil=srgb(60, 22, 138),
        bone_ao_tint=(0.37, 0.33, 0.67),
        teeth=srgb(118, 58, 230), void=srgb(10, 4, 16), void_glow=srgb(80, 20, 130),
        iron=srgb(64, 58, 70), iron_patina=srgb(92, 52, 36), iron_patina_amt=0.6,   # rusty dark helm / pauldrons / breastplate
        cloth=srgb(92, 22, 138), leather=srgb(38, 26, 32),
        wood=srgb(70, 46, 30), wood_dark=srgb(34, 22, 14),
        horn=srgb(60, 48, 40), horn_tip=srgb(200, 184, 150),
        glow=(0.72, 0.26, 1.0), glow_strength=3.2,     # violet eye glow
    ),
}

# ------------------------------------------------------------------------------------------------ KNIGHT
KNIGHT_BASE = dict(
    # every rank: BLACKENED dark steel (dark value mass) whose read comes from bright worn edges, not a pale wash
    skin=srgb(30, 30, 34), skin_rough=0.6,                  # mail / under-suit seen at the joints
    steel=srgb(132, 136, 120), steel_edge=srgb(190, 186, 172),
    trim=srgb(84, 82, 86), trim_patina=srgb(44, 40, 38), trim_patina_amt=0.3,
    bronze=srgb(150, 110, 56), bronze_patina=srgb(64, 54, 40), bronze_patina_amt=0.3,
    iron=srgb(70, 68, 72), iron_patina=srgb(80, 58, 40), iron_patina_amt=0.35,
    leather=srgb(64, 42, 26), leather_worn=srgb(112, 80, 54), leather_dark=srgb(34, 24, 18), leather_dark_worn=srgb(80, 60, 44),
    void=srgb(4, 5, 8), void_glow=srgb(20, 60, 90),
    glow=(0.55, 0.9, 1.0), glow_strength=3.0,               # two faint cold eye glints
    # rank colour: the TABARD is the big mass (front + back panels), enamel/trim second
    cloth=srgb(164, 244, 255), cloth_trim=srgb(174, 188, 190),   # Lt.: pale-blue tabard on dark steel
    plume=srgb(54, 96, 174),
    enamel=srgb(128, 132, 116), enamel_dark=srgb(52, 50, 48), enamel_metal=0.8, enamel_rough=0.42, enamel_helm=False,
)
KNIGHT_TIERS = {
    "silver": {},   # Lt. Verdigris: dark steel + pale-blue tabard + blue plume; NO pale/white plate
    "red": dict(    # Col. Patina: dark steel + deep crimson tabard + red-enamelled pauldrons, brass trim, tall red crest
        cloth=srgb(255, 36, 44), cloth_trim=srgb(216, 174, 86), plume=srgb(194, 18, 26),
        trim=srgb(176, 128, 58), trim_patina=srgb(86, 64, 36),
        enamel=srgb(210, 18, 26), enamel_dark=srgb(80, 7, 12), enamel_metal=0.05, enamel_rough=0.42,
    ),
    "gold": dict(   # Gen. Oxide: dark steel + gilded trim/pauldron rims + royal-purple tabard, tallest crest
        cloth=srgb(160, 102, 205), cloth_trim=srgb(255, 220, 100), plume=srgb(154, 62, 202),
        trim=srgb(255, 207, 97), trim_patina=srgb(116, 73, 24), trim_patina_amt=0.06,
        enamel=srgb(245, 183, 66), enamel_dark=srgb(95, 56, 18), enamel_metal=1.0, enamel_rough=0.27, enamel_helm=True,
    ),
}

# r23 knight-only fix: brighter Lt. pale blue; Gen. gold is metallic 1.0, warm with dark cavity falloff.
# Phase B r22: palette D FROZEN 2026-10-27. Skeleton data unchanged from candidate C.
# Knight data use the actual-mesh C/D probe; strict targets remain subject to semantic release measurements.
# Per-material in-game rim scale (glTF extras kcaRimScale; 1 = engine default). Tuned by in-engine A/B.
RIM = {"skeleton": {"body": 0.5, "glow": None}, "knight": {"body": 0.25, "glow": None}}

# SCREEN targets of each tier's DOMINANT mass at the stage camera (CIE L*, LCh hue deg, chroma), measured on the
# 1600x900 lineup crop with a mask/picker on that mass (not the whole box). Blueprint "Tier value / colour table".
TARGETS = {
    "skeleton_white": {"mass": "bone", "s1": {"L": (68, 84), "hue": (55, 90), "C": (10, 30)}, "s2": {"L": (70, 86), "hue": (60, 95), "C": (8, 28)}},
    "skeleton_purple": {"mass": "bone (violet stain)", "s1": {"L": (24, 40), "hue": (285, 325), "C": (25, 60)}, "s2": {"L": (26, 42), "hue": (280, 320), "C": (22, 55)}},
    "knight_silver": {"mass": "cuirass/plate + tabard", "s1": {"L": (18, 34), "C": (0, 12), "tabard_L": (45, 62), "tabard_hue": (230, 265)}, "s2": {"L": (20, 36), "C": (0, 12), "tabard_L": (48, 66), "tabard_hue": (230, 265)}},
    "knight_red": {"mass": "tabard + pauldrons", "s1": {"L": (28, 45), "hue": (10, 40), "C": (40, 75)}, "s2": {"L": (30, 46), "hue": (10, 40), "C": (38, 70)}},
    "knight_gold": {"mass": "tabard (purple) + gilded trim", "s1": {"L": (22, 38), "hue": (285, 320), "C": (25, 60), "gold_L": (60, 78), "gold_hue": (65, 95)}, "s2": {"L": (24, 40), "hue": (285, 320), "C": (22, 55), "gold_L": (62, 80), "gold_hue": (65, 95)}},
}

_BASE = {"skeleton": SKELETON_BASE, "knight": KNIGHT_BASE}
_TIERS = {"skeleton": SKELETON_TIERS, "knight": KNIGHT_TIERS}


def base(family):
    return dict(_BASE[family])


def tier(family, t):
    return dict(_TIERS[family][t])
