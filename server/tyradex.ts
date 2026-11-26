import type { CatalogHit } from '../shared/catalog';
import { HttpError } from './api';
import type { CatalogSource } from './catalog';
import { getJson } from './http';
import { fold } from '../shared/rules';

/**
 * Pokémon via Tyradex : API publique française, gratuite, sans clé (noms en français et en anglais).
 * Documentation : https://tyradex.app
 * Pas de recherche côté Tyradex : on charge le Pokédex complet (≈ 1,6 Mo) et on filtre ici.
 */

const HOST = 'tyradex.app';
/** Le Pokédex ne change qu'à la sortie d'un jeu : une copie par isolate suffit (optimisation, pas une garantie). */
const TTL = 6 * 3600_000;
const MAX_HITS = 30;

interface TxPokemon {
  pokedex_id: number;
  generation: number;
  category?: string;
  name: { fr: string; en: string };
  sprites: { regular: string | null };
}

interface Mon {
  hit: CatalogHit;
  gen: number;
  keys: string[];
}

let cache: { at: number; mons: Promise<Mon[]> } | null = null;

async function load(): Promise<Mon[]> {
  const raw = await getJson<TxPokemon[]>(new URL(`https://${HOST}/api/v1/pokemon`), { service: 'Tyradex', host: HOST });
  if (!Array.isArray(raw)) throw new HttpError(502, 'Réponse Tyradex illisible');
  return raw
    .filter((p) => p.pokedex_id > 0) // 0 = MissingNo.
    .map((p) => ({
      gen: p.generation,
      keys: [fold(p.name.fr), fold(p.name.en), String(p.pokedex_id)],
      hit: {
        id: String(p.pokedex_id),
        name: p.name.fr,
        image: p.sprites.regular,
        detail: `n° ${p.pokedex_id}${p.category ? ` · ${p.category}` : ''}`,
      },
    }));
}

function pokedex(): Promise<Mon[]> {
  if (!cache || Date.now() - cache.at > TTL) {
    const mons = load();
    cache = { at: Date.now(), mons };
    // Un échec ne doit pas rester en cache : la requête suivante réessaiera.
    mons.catch(() => (cache = null));
  }
  return cache.mons;
}

export const pokemonSource: CatalogSource = {
  images: [{ host: 'raw.githubusercontent.com', path: '/Yarkis01/TyraDex/' }],

  async search(q) {
    const term = fold(q);
    const found = (await pokedex()).filter((m) => m.keys.some((k) => k.includes(term)));
    // Les noms qui commencent par la saisie d'abord, puis l'ordre du Pokédex.
    const starts = (m: Mon) => (m.keys.some((k) => k.startsWith(term)) ? 0 : 1);
    return found
      .sort((a, b) => starts(a) - starts(b))
      .slice(0, MAX_HITS)
      .map((m) => m.hit);
  },

  async list(id) {
    const gen = Number(id.replace('gen', ''));
    return (await pokedex()).filter((m) => m.gen === gen).map((m) => m.hit);
  },
};
