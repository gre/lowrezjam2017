//@flow
import { LEVEL_SAFE_MULT } from "./genTrack";
export default (level: number): number =>
  level === -1
    ? 20 * LEVEL_SAFE_MULT
    : level === 0
      ? LEVEL_SAFE_MULT
      : LEVEL_SAFE_MULT * Math.floor(level + 0.2 * level * level);
