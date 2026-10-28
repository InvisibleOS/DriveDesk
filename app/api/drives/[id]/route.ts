import { dispatch, guard, get, payload, ready, remove } from '@/lib/store';

type Ctx = { params: Promise<{ id: string }> };
const missing = () => Response.json({ error: 'Drive not found' }, { status: 404 });

// GET ?once=1 → the drive as JSON. GET → live stream (Server-Sent Events) of every change to it.
export async function GET(req: Request, { params }: Ctx) {
  const no = guard(req);
  if (no) return no;
  const l = get((await params).id);
  if (!l) return missing();
  if (new URL(req.url).searchParams.has('once')) { await ready(); return new Response(payload(l), { headers: { 'Content-Type': 'application/json' } }) }

  const enc = new TextEncoder();
  let send: (p: string) => void, ping: ReturnType<typeof setInterval>;
  const stop = () => { l.subs.delete(send); clearInterval(ping) };
  const stream = new ReadableStream({
    start(c) {
      send = p => { try { c.enqueue(enc.encode(`data: ${p}\n\n`)) } catch { stop() } };
      l.subs.add(send);
      send(payload(l));
      ping = setInterval(() => { try { c.enqueue(enc.encode(': ping\n\n')) } catch { stop() } }, 20000);
      req.signal.addEventListener('abort', stop);
    },
    cancel: stop,
  });
  return new Response(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive' } });
}

export async function POST(req: Request, { params }: Ctx) {
  const no = guard(req);
  if (no) return no;
  try {
    return Response.json({ msg: dispatch((await params).id, await req.json()) });
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 400 });
  }
}

// moves the drive's file to data/trash (recoverable) and drops it from the calendar
export async function DELETE(req: Request, { params }: Ctx) {
  const no = guard(req);
  if (no) return no;
  try {
    remove((await params).id);
    return Response.json({ ok: true });
  } catch {
    return missing();
  }
}
