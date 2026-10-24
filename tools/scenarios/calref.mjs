// perf-1650 r4: CPU calibration reference — runs the bench's fixed JS kernel 12× in the page while the Windows
// "% Processor Performance" counter is read, so cal_ms × perf/100 = the kernel time at nominal clock.
import { spawnSync } from 'node:child_process';
export default async function (api) {
  const { page, log } = api;
  // Windows only: Linux/WSL2 exposes no "% Processor Performance" counter, so report raw kernel times there (perf = 100).
  const perf = () => process.platform !== 'win32' ? 100 : Number((spawnSync('powershell', ['-NoProfile', '-Command', "(Get-Counter '\Processor Information(_Total)\% Processor Performance' -SampleInterval 1 -MaxSamples 1).CounterSamples.CookedValue"], { encoding: 'utf8' }).stdout || '').trim());
  for (let k = 0; k < 4; k++) {
    const p0 = perf();
    const cals = await page.evaluate(() => { const b = new Float64Array(4096); const one = () => { const t = performance.now(); let s = 0.5; for (let r = 0; r < 60; r++) for (let i = 0; i < 4096; i++) { s = (s * 1.0000003 + b[(i * 7 + r) & 4095]) % 97.13; b[i] = Math.sqrt(s + i) * 0.5; } b[0] += s * 1e-12; return performance.now() - t; }; const a = []; for (let i = 0; i < 12; i++) a.push(one()); return a.sort((x, y) => x - y); });
    log(`perf ${p0.toFixed(0)}% · kernel ms min ${cals[0].toFixed(2)} med ${cals[6].toFixed(2)} → nominal-equivalent min ${(cals[0] * p0 / 100).toFixed(2)}`);
  }
}
