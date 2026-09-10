import { Vector3, Vector4 } from 'three';

const RAD = Math.PI / 180;
const DAY_MS = 86400000;
const J2000 = 2451545;
const wrap = (degrees) => ((degrees % 360) + 360) % 360;
const smooth = (a, b, value) => {
  const t = Math.max(0, Math.min(1, (value - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// Low-order Meeus/NOAA solar coordinates, evaluated from UTC (not flight dt).
// ECEF: +X Greenwich, +Y 90°E, +Z north. GMST turns east with the Earth.
export function solarPosition(utcMs = Date.now()) {
  const jd = utcMs / DAY_MS + 2440587.5;
  const days = jd - J2000, t = days / 36525;
  const meanLongitude = wrap(280.46646 + t * (36000.76983 + .0003032 * t));
  const anomaly = wrap(357.52911 + t * (35999.05029 - .0001537 * t)) * RAD;
  const centre = (1.914602 - t * (.004817 + .000014 * t)) * Math.sin(anomaly)
    + (.019993 - .000101 * t) * Math.sin(2 * anomaly) + .000289 * Math.sin(3 * anomaly);
  const omega = (125.04 - 1934.136 * t) * RAD;
  const longitude = (meanLongitude + centre - .00569 - .00478 * Math.sin(omega)) * RAD;
  const obliquity = (23 + (26 + (21.448 - t * (46.815 + t * (.00059 - .001813 * t))) / 60) / 60
    + .00256 * Math.cos(omega)) * RAD;
  const siderealAngle = wrap(280.46061837 + 360.98564736629 * days + .000387933 * t * t - t * t * t / 38710000) * RAD;
  const sunInertial = new Vector3(Math.cos(longitude), Math.cos(obliquity) * Math.sin(longitude), Math.sin(obliquity) * Math.sin(longitude));
  const sunECEF = sunInertial.clone().applyAxisAngle(new Vector3(0, 0, 1), -siderealAngle);
  return { utcMs, siderealAngle, sunInertial, sunECEF,
    declination: Math.asin(sunECEF.z), subsolarLongitude: Math.atan2(sunECEF.y, sunECEF.x) };
}

// Lat/lon are radians, matching the flight controller. Horizon dip lets an
// aircraft see sunrise before an observer on the ground below it.
export function localSolarState(solar, lat, lon, altitudeM = 0) {
  const up = new Vector3(Math.cos(lat) * Math.cos(lon), Math.cos(lat) * Math.sin(lon), Math.sin(lat));
  const elevation = Math.asin(Math.max(-1, Math.min(1, up.dot(solar.sunECEF)))) / RAD;
  const dip = Math.acos(6371000 / (6371000 + Math.max(0, altitudeM))) / RAD;
  const apparentElevation = elevation + dip;
  const hourAngle = Math.atan2(Math.sin(lon - solar.subsolarLongitude), Math.cos(lon - solar.subsolarLongitude));
  const daylight = smooth(-8, 6, elevation);
  const sunlight = smooth(-.833, 1, apparentElevation);
  const twilight = smooth(-12, -2, elevation) * (1 - smooth(0, 12, elevation));
  const phase = apparentElevation >= -.833 ? 'Day' : elevation < -18 ? 'Night' : hourAngle < 0 ? 'Dawn' : 'Dusk';
  return { elevation, dip, daylight, sunlight, twilight, phase,
    stars: 1 - smooth(-18, -6, elevation),
    ambientIntensity: .085 + 1.065 * daylight,
    sunIntensity: 2 * sunlight * (.35 + .65 * smooth(0, 25, apparentElevation)),
    environmentIntensity: .025 + .975 * daylight };
}

// Photogrammetry is usually unlit, with daylight baked into its photographs.
// Shade it geographically before fog/tone mapping, including newly loaded tiles.
export function createTerrainDayNight() {
  const uniforms = { daylightSun: { value: new Vector3(1, 0, 0) }, earthCentre: { value: new Vector3() },
    airportLightCount: { value: 0 }, airportLightStart: { value: Array.from({ length: 8 }, () => new Vector4()) },
    airportLightEnd: { value: Array.from({ length: 8 }, () => new Vector4()) } };
  const patched = new WeakSet();
  return {
    setAirportLights(regions = []) {
      uniforms.airportLightCount.value = Math.min(8, regions.length);
      for (let i = 0; i < uniforms.airportLightCount.value; i++) {
        uniforms.airportLightStart.value[i].copy(regions[i].start);
        uniforms.airportLightEnd.value[i].copy(regions[i].end);
      }
    },
    update(sunWorld, earthCentre) {
      uniforms.daylightSun.value.copy(sunWorld);
      uniforms.earthCentre.value.copy(earthCentre);
    },
    add(root) {
      root.traverse(mesh => {
        if (!mesh.isMesh || mesh.userData.vehicleShadowReceiver) return;
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (!material || patched.has(material) || (!material.isMeshBasicMaterial && !material.isMeshStandardMaterial)) continue;
          patched.add(material);
          const previous = material.onBeforeCompile, cacheKey = material.customProgramCacheKey();
          material.onBeforeCompile = function(shader, renderer) {
            previous.call(this, shader, renderer);
            Object.assign(shader.uniforms, uniforms);
            shader.vertexShader = 'varying vec3 vDayNightPosition;\n' + shader.vertexShader;
            shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvDayNightPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;');
            shader.fragmentShader = `uniform vec3 daylightSun;
              uniform vec3 earthCentre;
              uniform int airportLightCount;
              uniform vec4 airportLightStart[8];
              uniform vec4 airportLightEnd[8];
              varying vec3 vDayNightPosition;\n` + shader.fragmentShader;
            shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', `
              float solarHeight = dot(normalize(vDayNightPosition - earthCentre), daylightSun);
              float day = smoothstep(-0.139173, 0.104528, solarHeight);
              float airportGlow = 0.0;
              for (int i = 0; i < 8; i++) {
                if (i >= airportLightCount) break;
                vec3 lightAxis = airportLightEnd[i].xyz - airportLightStart[i].xyz;
                vec3 delta = vDayNightPosition - airportLightStart[i].xyz;
                float along = clamp(dot(delta, lightAxis) / max(1.0, dot(lightAxis, lightAxis)), 0.0, 1.0);
                float distanceToLight = length(delta - along * lightAxis);
                float pool = 1.0 - smoothstep(airportLightStart[i].w * .2, airportLightStart[i].w, distanceToLight);
                airportGlow = max(airportGlow, pool * airportLightEnd[i].w);
              }
              vec3 naturalLight = mix(vec3(0.018, 0.027, 0.055), vec3(1.0), day);
              outgoingLight *= mix(naturalLight, vec3(.52, .46, .32), airportGlow * (1.0 - day));
              #include <opaque_fragment>
            `);
          };
          material.customProgramCacheKey = () => `${cacheKey}|earth-day-night-airports-v2`;
          material.needsUpdate = true;
        }
      });
    },
  };
}
