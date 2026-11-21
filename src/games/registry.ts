import { ArcadeGameDefinition } from '../core/types';
import { animalDoorsGameDefinition } from './animaldoors';
import { musicGardenGameDefinition } from './musicgarden';
import { shapeColorMatchGameDefinition } from './shapematch';
import { shapeStackerGameDefinition } from './shapesorter';
import { trainGameDefinition } from './train';
import { conductorGameDefinition } from './conductor';
import { carWashGameDefinition } from './carwash';

/**
 * Register all games/apps available in the Toddler Arcade grid here.
 * Top row (4): Exploration, Music, Matching & Early Math worlds.
 * Bottom row (3, centered): Vehicles, Paths & Routines worlds.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const GAME_REGISTRY: ArcadeGameDefinition<any>[] = [
  animalDoorsGameDefinition,
  musicGardenGameDefinition,
  shapeColorMatchGameDefinition,
  shapeStackerGameDefinition,
  trainGameDefinition,
  conductorGameDefinition,
  carWashGameDefinition,
];
