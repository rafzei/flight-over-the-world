// Shared, deterministic simulation, NOT an observation/forecast service.
// Coordinates are radians, heights metres AMSL, UTC milliseconds, velocities m/s.
const R = 6378137, TAU = Math.PI * 2, BANDS = 4500, CELL = Math.PI * R / BANDS;
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const smooth = (a, b, x) => { const t = clamp((x-a)/(b-a)); return t*t*(3-2*t); };
export const wrapRadians = x => ((x + Math.PI) % TAU + TAU) % TAU - Math.PI;
function random(a, b, c = 0) {
  let n = Math.imul(a + 17, 374761393) ^ Math.imul(b + 53, 668265263) ^ Math.imul(c + 97, 1274126177);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}
function region(lat, lon, utcMs) {
  // Cartesian phases are continuous across the dateline and near either pole.
  const x = Math.cos(lat)*Math.cos(lon), y = Math.cos(lat)*Math.sin(lon), z = Math.sin(lat);
  const t = utcMs / 1000;
  const phase = 3*x + 4*y - 2*z + t/18000;
  return { phase, cloudBase: 1600 + 650*(.5+.5*Math.sin(phase*.7)), coverage: .32 + .25*(.5+.5*Math.sin(phase)) };
}
export function windAt(lat, lon, height, utcMs, ground = 0) {
  const agl = Math.max(0, height-ground), { phase } = region(lat,lon,utcMs);
  const atmosphere = 1-smooth(15000,24000,height);
  const surface = .25+.75*smooth(0,80,agl);
  const angle = phase + 1.25*Math.log1p(agl/500);
  const speed = (4.5+2*Math.sin(phase*.6)**2+Math.min(35,agl*.0025))*surface*atmosphere;
  const t = utcMs/1000;
  const gust = (Math.sin(t*.37+phase*4)+.5*Math.sin(t*.83-phase*7))*1.35*surface*atmosphere;
  return { north: Math.cos(angle)*speed+Math.sin(t*.17+phase)*gust,
    east: Math.sin(angle)*speed+Math.cos(t*.23-phase)*gust, gust: Math.abs(gust) };
}
export function moveGeo(lat, lon, north, east) {
  const d = Math.hypot(north,east)/R;
  if (!d) return { lat, lon: wrapRadians(lon) };
  const bearing = Math.atan2(east,north), sinLat = Math.sin(lat), cosLat = Math.cos(lat);
  const nextLat = Math.asin(clamp(sinLat*Math.cos(d)+cosLat*Math.sin(d)*Math.cos(bearing),-1,1));
  return { lat: nextLat, lon: wrapRadians(lon+Math.atan2(Math.sin(bearing)*Math.sin(d)*cosLat,Math.cos(d)-sinLat*Math.sin(nextLat))) };
}
export function thermalCenter(cell, altitude, utcMs) {
  const agl = clamp(altitude-cell.ground,0,cell.cloudBase);
  const wind = windAt(cell.lat,cell.lon,cell.ground+agl*.5,utcMs,cell.ground);
  // A continuously replenished, downwind-leaning plume rooted in a ground source.
  return moveGeo(cell.lat,cell.lon,wind.north*agl/6,wind.east*agl/6);
}
export function nearbyThermals({ lat, lon, ground = 0, utcMs, solar, range = 11000 }) {
  const band = Math.floor((lat+Math.PI/2)/Math.PI*BANDS), reach = Math.ceil(range/CELL)+1;
  const cells = [];
  for (let row=Math.max(0,band-reach);row<=Math.min(BANDS-1,band+reach);row++) {
    const mid = -Math.PI/2+(row+.5)*Math.PI/BANDS;
    const count = Math.max(1,Math.round(TAU*R*Math.cos(mid)/CELL));
    const index = Math.floor((wrapRadians(lon)+Math.PI)/TAU*count);
    const width = Math.min(Math.floor(count/2),Math.ceil(range/Math.max(1,CELL*Math.cos(lat)/Math.cos(mid)))+1);
    const visited = new Set();
    for(let offset=-width;offset<=width;offset++) {
      const col = ((index+offset)%count+count)%count;
      if (visited.has(col)) continue; visited.add(col);
      const p = -Math.PI/2+(row+.2+.6*random(row,col))*Math.PI/BANDS;
      const l = -Math.PI+(col+.2+.6*random(row,col,1))*TAU/count;
      const a = Math.sin((p-lat)/2)**2+Math.cos(lat)*Math.cos(p)*Math.sin((l-lon)/2)**2;
      const distance = 2*R*Math.asin(Math.sqrt(clamp(a)));
      if(distance>range) continue;
      const { cloudBase, coverage } = region(p,l,utcMs);
      const sun = solar?.sunECEF;
      const heating = sun ? smooth(.03,.7,Math.cos(p)*Math.cos(l)*sun.x+Math.cos(p)*Math.sin(l)*sun.y+Math.sin(p)*sun.z) : 0;
      const life = .3+.7*Math.sin(utcMs/1000/220+random(row,col,7)*TAU)**2;
      const strength = heating*(2.8+2.5*random(row,col,2))*life;
      cells.push({ id: `${row}:${col}`, lat:p, lon:l, ground, cloudBase, distance,
        radius: 190+110*random(row,col,3), strength,
        cloud: random(row,col,4)<coverage+.2, cloudAmount: .3+.7*life });
    }
  }
  return cells.sort((a,b)=>a.distance-b.distance).slice(0,64);
}
export function sampleWeather({ lat, lon, height, ground = 0, utcMs = Date.now(), solar }) {
  const agl = Math.max(0,height-ground), wind = windAt(lat,lon,height,utcMs,ground);
  const area = region(lat,lon,utcMs);
  const thermals = height < 15000 ? nearbyThermals({lat,lon,ground,utcMs,solar}) : [];
  let up = 0, nearest = null;
  for (const cell of thermals) {
    const center = thermalCenter(cell,height,utcMs);
    const north = (center.lat-lat)*R, east = wrapRadians(center.lon-lon)*R*Math.cos(lat);
    const distance = Math.hypot(north,east), ratio = distance/cell.radius;
    const vertical = smooth(20,180,agl)*(1-smooth(cell.cloudBase*.78,cell.cloudBase,agl));
    // Strong narrow core, weak surrounding sink; no thermal below ground or cloud top.
    up += cell.strength*vertical*(Math.exp(-ratio*ratio*1.4)-.12*Math.exp(-ratio*ratio*.18));
    if(cell.strength>.5 && (!nearest || distance<nearest.distance)) nearest = {
      distance, bearing: (Math.atan2(east,north)*180/Math.PI+360)%360, strength:cell.strength, ...center,
    };
  }
  up = clamp(up,-2,6);
  return { ...wind, up, speed: Math.hypot(wind.north,wind.east),
    from: (Math.atan2(-wind.east,-wind.north)*180/Math.PI+360)%360,
    cloudBase: ground+area.cloudBase, coverage: area.coverage, thermals, nearest, utcMs };
}

// Remove the previous air-mass component before controllers smooth their own
// climb rate. This prevents a thermal from being accumulated on every frame.
export function beginAirMotion(controller) {
  controller.verticalSpeed -= controller.weatherVertical ?? 0;
  controller.weatherVertical = 0;
}
export function advanceAirMotion(controller, dt, north, east, up, weather) {
  north += weather?.north ?? 0; east += weather?.east ?? 0;
  controller.weatherVertical = weather?.up ?? 0;
  controller.verticalSpeed = up+controller.weatherVertical;
  controller.groundSpeed = Math.hypot(north,east);
  Object.assign(controller,moveGeo(controller.lat,controller.lon,north*dt,east*dt));
  controller.height += controller.verticalSpeed*dt;
}
