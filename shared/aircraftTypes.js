// ICAO type designators, not airline callsigns. Only explicitly supported types get a model.
export const AIRLINERS = Object.freeze({
  b738: { name: "Boeing 737-800", length: 39.47, span: 35.8, diameter: 3.76 },
  a320: { name: "Airbus A320", length: 37.57, span: 35.8, diameter: 3.95 },
});
const BOEING_LENGTHS = { B731: 28.65, B732: 30.53, B733: 33.4, B734: 36.45, B735: 31.01, B736: 31.24, B737: 33.63, B738: 39.47, B739: 42.11, B37M: 35.56, B38M: 39.52, B39M: 42.16, B3XM: 43.8 };
export function aircraftVisual(typeCode) {
  const type = typeof typeCode === "string" ? typeCode.trim().toUpperCase() : "";
  if (Object.hasOwn(BOEING_LENGTHS, type)) return { model: "b738", length: BOEING_LENGTHS[type], typeCode: type };
  if (type === "A320" || type === "A20N") return { model: "a320", length: AIRLINERS.a320.length, typeCode: type };
  return null;
}
