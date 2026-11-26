export const TIER_COLORS = ['#ff7f7f', '#ffbf7f', '#ffdf7f', '#ffff7f', '#bfff7f', '#7fff7f', '#7fbfff'];
export const PALETTE = [...TIER_COLORS, '#7fffff', '#bf7fff', '#ff7fbf', '#d0d0d0'];
export const TILE_COLORS = ['#3d5afe', '#e5484d', '#f59e0b', '#10b981', '#8b5cf6', '#ec4899', '#0ea5e9', '#1f2937', '#e7e5e4'];
export const PARTY = ['#ff7f7f', '#ffdf7f', '#7fff7f', '#7fbfff', '#bf7fff', '#3d5afe', '#ec4899', '#ffffff'];

export interface Preset {
  name: string;
  tiers: string[];
}

export const PRESETS: Record<string, Preset> = {
  classic: { name: 'Classique S à F', tiers: ['S', 'A', 'B', 'C', 'D', 'F'] },
  large: { name: 'Étendue S à E', tiers: ['S', 'A', 'B', 'C', 'D', 'E'] },
  notes: { name: 'Notes de 5 à 1', tiers: ['5', '4', '3', '2', '1'] },
  tfm: { name: 'Top, moyen, flop', tiers: ['Top', 'Moyen', 'Flop'] },
};

export { LIMITS } from '../../shared/rules';
