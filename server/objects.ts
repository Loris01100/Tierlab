import { HttpError, type Env } from './api';

/** Champs utilisés d'une liaison Durable Object (wrangler.jsonc : durable_objects.bindings). */
export interface ObjectStub {
  fetch(input: Request | string, init?: RequestInit): Promise<Response>;
}
interface ObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): ObjectStub;
}

/** L'instance `name` du Durable Object lié sous `binding`. */
export function objectStub(env: Env, binding: string, name: string): ObjectStub {
  const ns = env[binding] as ObjectNamespace | undefined;
  if (!ns) throw new HttpError(500, `Configuration manquante : ${binding}`);
  return ns.get(ns.idFromName(name));
}

/** Identifiant aléatoire en base 36 (32 caractères ≈ 165 bits : impossible à deviner). */
export function randomId(length: number): string {
  const b = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(b, (x) => (x % 36).toString(36)).join('');
}
