import { ArcadeGameDefinition } from '../core/types';
import { trainGameDefinition } from './train';
import { carWashGameDefinition } from './carwash';

/**
 * Register all games/apps available in the Toddler Arcade grid here.
 * Each game defines its own cover illustration and button mapping.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const GAME_REGISTRY: ArcadeGameDefinition<any>[] = [
  trainGameDefinition,
  carWashGameDefinition,
];
