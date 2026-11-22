import { ArcadeGameDefinition } from '../core/types';
import { shapeSpinnerGameDefinition } from './shapespinner';
import { animalDoorsGameDefinition } from './animaldoors';
import { musicGardenGameDefinition } from './musicgarden';
import { carsHornsGameDefinition } from './carshorns';
import { shapeStackerGameDefinition } from './shapesorter';
import { stuntRampGameDefinition } from './stuntramp';
import { shapeColorMatchGameDefinition } from './shapematch';
import { trainGameDefinition } from './train';
import { conductorGameDefinition } from './conductor';
import { carWashGameDefinition } from './carwash';

/**
 * Register all 10 games/apps available in the Toddler Arcade 5x2 grid:
 * - Slot 0: Shape Spinner (focused single-icon shape, color & joystick spin)
 * - Immediate cause-and-effect & button-mashing favorites
 *   (Peekaboo Doors, Music & Bubbles, Cars & Horns, Block Stacker)
 * - Launching, Matching, Trains & Vehicle Routines
 *   (Stunt Ramp Garage, Shape & Color Match, Choo-Choo Train, Cab Conductor, Bubble Car Wash)
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const GAME_REGISTRY: ArcadeGameDefinition<any>[] = [
  shapeSpinnerGameDefinition,
  animalDoorsGameDefinition,
  musicGardenGameDefinition,
  carsHornsGameDefinition,
  shapeStackerGameDefinition,
  stuntRampGameDefinition,
  shapeColorMatchGameDefinition,
  trainGameDefinition,
  conductorGameDefinition,
  carWashGameDefinition,
];
