// Stage1 idle clip + both-mesh skin checks, then fixed cameras in the same stage lighting.
// Only idle contributes video frames; face views are stills after the clip.
import idle from './seraphine_idle.mjs';
import face from './seraphine_face.mjs';
export default async api => {
  await idle(api);
  await api.shot('stage_idle');
  await face(api);
};
