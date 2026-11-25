import type { IncomingMessage, ServerResponse } from 'node:http';
import { Readable } from 'node:stream';
import type { ReadableStream as WebStream } from 'node:stream/web';
import type { Env } from './api';
import { handleApi } from './routes';

/** Adaptateur Connect pour Vite (dev et preview) : convertit la requête Node en Request web et retour. */
export function nodeApi(env: Env) {
  return async (req: IncomingMessage, res: ServerResponse, next: (err?: unknown) => void) => {
    try {
      const url = new URL(req.originalUrl ?? req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
      const headers = new Headers();
      for (const [k, v] of Object.entries(req.headers)) {
        if (typeof v === 'string') headers.set(k, v);
        else if (Array.isArray(v)) for (const x of v) headers.append(k, x);
      }
      const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
      // duplex: 'half' est exigé par Node pour un corps en flux (absent des types RequestInit).
      const init = hasBody ? { body: Readable.toWeb(req), duplex: 'half' } : {};
      const request = new Request(url, { method: req.method, headers, ...(init as RequestInit) });

      const response = await handleApi(request, env);
      if (!response) return next();

      res.statusCode = response.status;
      response.headers.forEach((v, k) => res.setHeader(k, v));
      if (!response.body) return void res.end();
      Readable.fromWeb(response.body as WebStream)
        .on('error', () => res.destroy())
        .pipe(res);
    } catch (e) {
      next(e);
    }
  };
}

declare module 'node:http' {
  interface IncomingMessage {
    /** Ajouté par Connect quand le middleware est monté sous un préfixe. */
    originalUrl?: string;
  }
}
