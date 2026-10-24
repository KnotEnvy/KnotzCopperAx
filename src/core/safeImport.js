// safeImport + Registry: content discovery by dropping files into a folder.
//
// A Registry wraps a Vite `import.meta.glob(..., { eager:false })` map. Module ids are the file basenames
// (src/enemies/types/marauder.js → 'marauder'). Each module is imported lazily, once, inside try/catch:
// one broken file logs an error (visible in capture pageErrors/consoleErrors and __KCA.info().errors)
// but never takes down unrelated modes.
import { reportError } from './log.js';

/** Import a module through a loader function, never throwing. Returns the module or null. */
export async function safeImport(loader, label = 'module') {
  try {
    return await loader();
  } catch (e) {
    reportError(`import:${label}`, e);
    return null;
  }
}

export class Registry {
  /**
   * @param {string} name        registry name (for logs)
   * @param {Record<string, () => Promise<any>>} globMap  result of import.meta.glob('./dir/*.js')
   */
  constructor(name, globMap) {
    this.name = name;
    /** @type {Map<string, () => Promise<any>>} */
    this.loaders = new Map();
    /** @type {Map<string, Promise<any>>} */
    this.pending = new Map();
    /** @type {Map<string, any>} id → module.default (or the module namespace if no default) */
    this.cache = new Map();
    for (const [path, loader] of Object.entries(globMap)) {
      const id = path.split('/').pop().replace(/\.(m?js|ts)$/, '');
      if (id.startsWith('_')) continue; // _helpers.js etc. are private to the folder
      this.loaders.set(id, loader);
    }
  }

  /** All discovered ids (sorted). */
  ids() { return [...this.loaders.keys()].sort(); }
  has(id) { return this.loaders.has(id); }
  /** Synchronous access to an already-loaded module (null if not loaded yet). */
  get(id) { return this.cache.get(id) || null; }

  /** Load one module (cached). Resolves to module.default ?? module, or null on failure / unknown id. */
  load(id) {
    if (this.cache.has(id)) return Promise.resolve(this.cache.get(id));
    if (this.pending.has(id)) return this.pending.get(id);
    const loader = this.loaders.get(id);
    if (!loader) {
      reportError(`registry:${this.name}`, new Error(`unknown id '${id}' (known: ${this.ids().join(', ') || 'none'})`));
      return Promise.resolve(null);
    }
    const p = safeImport(loader, `${this.name}/${id}`).then((m) => {
      const v = m ? (m.default !== undefined ? m.default : m) : null;
      if (v) this.cache.set(id, v);
      this.pending.delete(id);
      return v;
    });
    this.pending.set(id, p);
    return p;
  }

  /** Load every module in the folder. Resolves to Map id → module (failed ones omitted). */
  async loadAll() {
    const out = new Map();
    await Promise.all(this.ids().map(async (id) => { const m = await this.load(id); if (m) out.set(id, m); }));
    return out;
  }
}
