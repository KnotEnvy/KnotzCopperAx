#!/usr/bin/env python3
"""Save one critic seat's JSON verdict: python3 tools/board/save_seat.py <item>-r<N> <seat>  (JSON on stdin).
Writes progress/qa/board-<wave>/<item>-r<N>/seat-<seat>.json (KCA_WAVE, default c2)."""
import json, os, sys
d, seat = sys.argv[1], sys.argv[2]
wave = os.environ.get('KCA_WAVE', 'c2').lower()
obj = json.loads(sys.stdin.read())
p = f'progress/qa/board-{wave}/{d}/seat-{seat}.json'
os.makedirs(os.path.dirname(p), exist_ok=True)
json.dump(obj, open(p, 'w'), indent=1)
print('saved', p, obj.get('verdict'), obj.get('avg'))
