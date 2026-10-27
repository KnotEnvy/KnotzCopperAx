"""Fast owner-round check of both bodies and only their two hammers, via blender-run."""
import os
import sys
from types import SimpleNamespace
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_boss_brutes as brutes
brutes.build(SimpleNamespace(q="fast", only="gor,mog", device="AUTO", body_tris=34000, head_tris=10000))
import build_boss_weapons as weapons
sys.argv = [__file__, "--", "--fast", "--only", "hammer_gor,hammer_mog"]
weapons.main()
