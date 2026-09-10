// ICAO type designators, not airline callsigns. Only explicitly supported types get a model.
export const AIRLINERS = Object.freeze({
  b738: { name: "Boeing 737-800", length: 39.47, span: 35.8, diameter: 3.76 },
  a320: { name: "Airbus A320", length: 37.57, span: 35.8, diameter: 3.95 },
  a321: { name: "Airbus A321", length: 44.51, span: 35.8, diameter: 3.95 },
  e195: { name: "Embraer E195LR", length: 38.66, span: 28.73, diameter: 3.01 },
});
const BOEING_LENGTHS = { B731: 28.65, B732: 30.53, B733: 33.4, B734: 36.45, B735: 31.01, B736: 31.24, B737: 33.63, B738: 39.47, B739: 42.11, B37M: 35.56, B38M: 39.52, B39M: 42.16, B3XM: 43.8 };
export function aircraftVisual(typeCode, modelName) {
  const type = typeof typeCode === "string" ? typeCode.trim().toUpperCase() : "";
  if (Object.hasOwn(BOEING_LENGTHS, type)) return { model: "b738", length: BOEING_LENGTHS[type], typeCode: type };
  // Match aircraft metadata only. Callsigns (e.g. LOT195) carry no type information.
  // E195LR, ERJ 190-200 LR, A321-231, A21N and full manufacturer names are common.
  // E2 uses a different wing/engine: deliberately exclude it from the first-gen E195.
  for (const value of [type, modelName]) {
    if (typeof value !== "string") continue;
    const name = value.trim().toUpperCase().replace(/^(AIRBUS|EMBRAER)\s+/, "");
    let model;
    if (/^(A321|A21N)(?=$|[\s-]|NEO|LR|XLR|\d)/.test(name)) model = "a321";
    else if (/^(A320|A20N)(?=$|[\s-]|NEO|\d)/.test(name)) model = "a320";
    else if (!/E2|E295/.test(name) && /^(E[ -]?195|ERJ[ -]?195|ERJ[ -]?190[ -]200)(?=$|[\s-]|LR|AR|STD)/.test(name)) model = "e195";
    if (model) return { model, length: AIRLINERS[model].length, typeCode: type || name };
    // An explicit unsupported ICAO type takes precedence over a conflicting name.
    if (value === type && /^[A-Z][A-Z0-9]{2,3}$/.test(type)) return null;
  }
  return null;
}
