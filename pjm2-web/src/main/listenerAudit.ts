// src/main/listenerAudit.ts
// Counts LIVE event listeners on window / document / the game canvas (add minus remove, by target+type+fn+capture)
// for the stage-disposal audit (`__pjm2.audit().listeners`). Counting only: never removes anything.
// Installed once at shell boot; negligible overhead.

type Key = string;

class ListenerAudit {
  private readonly live = new Map<string, Set<Key>>();
  private ids = new WeakMap<object, number>();
  private nextId = 1;
  private canvas: EventTarget | null = null;

  private idOf(o: object): number {
    let i = this.ids.get(o);
    if (i === undefined) { i = this.nextId++; this.ids.set(o, i); }
    return i;
  }

  private key(type: string, fn: unknown, opts: unknown): Key {
    const cap = typeof opts === 'boolean' ? opts : (opts as { capture?: boolean } | undefined)?.capture === true;
    const f = typeof fn === 'function' ? this.idOf(fn) : (fn !== null && typeof fn === 'object' ? this.idOf(fn as object) : 0);
    return `${type}#${f}#${cap ? 1 : 0}`;
  }

  patch(name: string, target: EventTarget): void {
    const set = this.live.get(name) ?? new Set<Key>();
    this.live.set(name, set);
    const add = target.addEventListener.bind(target) as EventTarget['addEventListener'];
    const remove = target.removeEventListener.bind(target) as EventTarget['removeEventListener'];
    target.addEventListener = ((type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | AddEventListenerOptions) => {
      const k = this.key(type, fn, opts);
      set.add(k);
      const signal = typeof opts === 'object' ? opts?.signal : undefined;
      if (signal !== undefined && signal !== null) signal.addEventListener('abort', () => { set.delete(k); }, { once: true });
      if (typeof opts === 'object' && opts?.once === true && typeof fn === 'function') {
        add(type, ((e: Event) => { set.delete(k); fn(e); }) as EventListener, opts);
        return;
      }
      add(type, fn, opts);
    }) as EventTarget['addEventListener'];
    target.removeEventListener = ((type: string, fn: EventListenerOrEventListenerObject | null, opts?: boolean | EventListenerOptions) => {
      set.delete(this.key(type, fn, opts));
      remove(type, fn, opts);
    }) as EventTarget['removeEventListener'];
  }

  watchCanvas(c: EventTarget): void {
    if (this.canvas !== null) return;
    this.canvas = c;
    this.patch('canvas', c);
  }

  snapshot(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const [k, s] of this.live) out[k] = s.size;
    return out;
  }
}

export const listenerAudit = new ListenerAudit();

let installed = false;
export function installListenerAudit(): void {
  if (installed || typeof window === 'undefined') return;
  installed = true;
  listenerAudit.patch('window', window);
  listenerAudit.patch('document', document);
}
