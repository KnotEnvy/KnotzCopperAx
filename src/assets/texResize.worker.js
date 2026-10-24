// Texture downscale worker (perf-1650 r2): createImageBitmap(ImageBitmap, { resize… }) runs synchronously on the
// calling thread in Chrome — on the main thread it froze the map interlude for 0.35–0.56 s per GLB while the next
// stage's enemies loaded. Here it runs on this worker; the bitmaps are transferred both ways (zero-copy).
self.onmessage = async (e) => {
  const { id, bmp, w, h } = e.data;
  try {
    const out = await createImageBitmap(bmp, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    bmp.close();
    self.postMessage({ id, out }, [out]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err), bmp }, [bmp]);
  }
};
