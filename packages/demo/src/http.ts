// Tiny request router for the demo backend.

export interface Req {
  method: string;
  path: string; // without the API prefix and query, e.g. "/branches/abc/floor"
  query: URLSearchParams;
  body: any;
  headers: Headers;
  params: Record<string, string>;
}

export interface Res {
  status: number;
  body?: unknown;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(String(body["error"] ?? status));
  }
}
export const fail = (status: number, error: string, extra: Record<string, unknown> = {}): never => {
  throw new HttpError(status, { error, ...extra });
};

type Handler = (req: Req) => Res | unknown | Promise<Res | unknown>;
interface Route {
  method: string;
  re: RegExp;
  names: string[];
  fn: Handler;
}

export class Router {
  private routes: Route[] = [];

  on(method: string, pattern: string, fn: Handler) {
    const names: string[] = [];
    const re = new RegExp(
      "^" +
        pattern.replace(/\/:([a-zA-Z]+)/g, (_, n: string) => {
          names.push(n);
          return "/([^/]+)";
        }) +
        "$",
    );
    this.routes.push({ method, re, names, fn });
    return this;
  }
  get(p: string, fn: Handler) {
    return this.on("GET", p, fn);
  }
  post(p: string, fn: Handler) {
    return this.on("POST", p, fn);
  }
  patch(p: string, fn: Handler) {
    return this.on("PATCH", p, fn);
  }
  put(p: string, fn: Handler) {
    return this.on("PUT", p, fn);
  }
  delete(p: string, fn: Handler) {
    return this.on("DELETE", p, fn);
  }

  /** Returns null when no route matches (the caller falls back to documents). */
  async handle(req: Omit<Req, "params">): Promise<Res | null> {
    for (const r of this.routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(req.path);
      if (!m) continue;
      const params = Object.fromEntries(r.names.map((n, i) => [n, decodeURIComponent(m[i + 1]!)]));
      try {
        const out = await r.fn({ ...req, params });
        if (out && typeof out === "object" && "status" in (out as object) && Object.keys(out as object).every((k) => k === "status" || k === "body")) return out as Res;
        return { status: req.method === "POST" ? 200 : 200, body: out };
      } catch (e) {
        if (e instanceof HttpError) return { status: e.status, body: e.body };
        console.error("[demo] handler failed", req.method, req.path, e);
        return { status: 500, body: { error: "internal_error" } };
      }
    }
    return null;
  }
}

export const created = (body: unknown): Res => ({ status: 201, body });
export const noContent = (): Res => ({ status: 204 });
