import { TOWER } from '../../config/map';
import type { Entity } from '../entity';
import { dist } from './collision';

/** Standing at ground level within the tower's capture circle. */
export function nearTowerBase(e: Entity, extra = 0): boolean {
  return dist(e, TOWER) < TOWER.r + extra && e.y < 30;
}
