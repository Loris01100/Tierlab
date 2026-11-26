/**
 * Bornes et validations communes au navigateur et au serveur (édition partagée).
 * Fichier neutre : ni DOM ni Node.
 */

export const LIMITS = { title: 80, tierName: 40, tileText: 80, tiers: 30, importImages: 200, importApi: 400, history: 80 } as const;

export const isColor = (c: unknown): c is string => typeof c === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c);
