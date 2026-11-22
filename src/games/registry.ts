import { ArcadeGameDefinition } from '../core/types';
import { animalDoorsGameDefinition } from './animaldoors';
import { musicGardenGameDefinition } from './musicgarden';
import { shapeStackerGameDefinition } from './shapesorter';
import { stuntRampGameDefinition } from './stuntramp';
import { shapeColorMatchGameDefinition } from './shapematch';
import { trainGameDefinition } from './train';
import { conductorGameDefinition } from './conductor';
import { carWashGameDefinition } from './carwash';

/**
 * Register all 8 games/apps available in the Toddler Arcade 4x2 grid:
 * - Top row (4): Immediate cause-and-effect & button-mashing favorites
 *   (Peekaboo Doors, Music & Bubbles, Block Stacker, Stunt Ramp Garage)
 * - Bottom row (4): Matching, Trains & Vehicle Routines
 *   (Shape & Color Match, Choo-Choo Train, Cab Conductor, Bubble Car Wash)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const GAME_REGISTRY: ArcadeGameDefinition<any>[] = [
  animalDoorsGameDefinition,
  musicGardenGameDefinition,
  shapeStackerGameDefinition,
  stuntRampGameDefinition,
  shapeColorMatchGameDefinition,
  trainGameDefinition,
  conductorGameDefinition,
  carWashGameDefinition,
];
