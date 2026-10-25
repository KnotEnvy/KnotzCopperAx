// Verified fixed head views followed by the turn clip in one browser/session.
// capture: showcase hero/seraphine, cam=face, yaw=0, spin=0, warm600, --mp4 --sheet.
import heads from './seraphine_head_views.mjs';
import turn from './seraphine_turn.mjs';
export default async api => {
  await heads(api);
  await turn(api);
};
