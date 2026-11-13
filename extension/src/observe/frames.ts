// Maps <iframe> elements to extension frame ids (D-0016).
// The background tells every frame its own id; a parent then asks each child window through
// postMessage and matches the reply by event.source, which works across origins.
const PROBE_KEY = "__braiserFrameProbe";
const REPLY_KEY = "__braiserFrameReply";

let ownFrameId: number | undefined;
let listening = false;

export function setOwnFrameId(frameId: number): void {
  ownFrameId = frameId;
  if (listening) return;
  listening = true;
  window.addEventListener("message", event => {
    const data = event.data as Record<string, unknown> | null;
    if (!data || typeof data[PROBE_KEY] !== "string" || ownFrameId === undefined || !event.source) return;
    (event.source as Window).postMessage({ [REPLY_KEY]: data[PROBE_KEY], frameId: ownFrameId }, "*");
  });
}

export async function resolveChildFrameIds(frames: Element[], timeoutMs = 500): Promise<Map<Element, number>> {
  const result = new Map<Element, number>();
  const pending = new Map<Window, Element>();
  for (const frame of frames) {
    const child = (frame as HTMLIFrameElement).contentWindow;
    if (child) pending.set(child, frame);
  }
  if (!pending.size) return result;

  const nonce = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  await new Promise<void>(resolve => {
    const timer = setTimeout(done, timeoutMs);
    function done() {
      clearTimeout(timer);
      window.removeEventListener("message", onMessage);
      resolve();
    }
    function onMessage(event: MessageEvent) {
      const data = event.data as Record<string, unknown> | null;
      if (!data || data[REPLY_KEY] !== nonce || typeof data.frameId !== "number") return;
      const frame = pending.get(event.source as Window);
      if (!frame) return;
      result.set(frame, data.frameId);
      pending.delete(event.source as Window);
      if (!pending.size) done();
    }
    window.addEventListener("message", onMessage);
    for (const child of pending.keys()) child.postMessage({ [PROBE_KEY]: nonce }, "*");
  });
  return result;
}
