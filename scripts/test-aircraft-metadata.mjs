import { AircraftMetadata } from "../server/aircraftMetadata.mjs";
import { aircraftVisual } from "../shared/aircraftTypes.js";

// A bounded real API smoke test, independent of the OpenSky daily credit balance.
const db = new AircraftMetadata();
const records = [];
for (const icao24 of ["48c124", "3c66a1"]) {
  const aircraft = await db.get(icao24);
  records.push({ icao24, aircraft, visual: aircraftVisual(aircraft?.typeCode) });
}
console.log(JSON.stringify({ checkedAt: new Date().toISOString(), source: "https://api.adsbdb.com/v0/aircraft/{icao24}", records }, null, 2));
if (!records.every(row => row.aircraft && row.visual)) process.exitCode = 1;
