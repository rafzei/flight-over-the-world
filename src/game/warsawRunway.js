// Compatibility entry point for existing landing diagnostics and tests.
import { POLISH_RUNWAYS, DEFAULT_APPROACH } from './airportRunways.js';
import { Runway } from './runway.js';
export { createRunwayVisual } from './runway.js';
export class WarsawRunway {
  constructor() {
    return new Runway(POLISH_RUNWAYS.find(r => r.id === 'EPWA-15-33')).directions.find(r => r.definition.id === DEFAULT_APPROACH);
  }
}
export const WARSAW_RUNWAY = new WarsawRunway().definition;
