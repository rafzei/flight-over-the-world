import { BackSide, BufferGeometry, Color, Float32BufferAttribute, Mesh, Points, PointsMaterial, ShaderMaterial, SphereGeometry, Vector3 } from "three";

// Defaults for standalone previews; flight supplies the live solar direction.
export const SUN_DIR = new Vector3(-0.52, 0.62, 0.26).normalize();
export const MOON_DIR = new Vector3(0.60, 0.42, -0.52).normalize();
export const SPACE_SKY_ALTITUDE_M = 20_000;
const SPACE_FOG_COLOR = new Color(0x02040b);
export function spaceSkyBlend(altitudeM) {
  const t = Math.max(0, Math.min(1, (altitudeM - SPACE_SKY_ALTITUDE_M) / 2000));
  return t * t * (3 - 2 * t);
}

// Proceduralne niebo: gradient zenit→horyzont + tarcza słońca + chmury FBM.
// Horyzont ma DOKŁADNIE kolor mgły (w przestrzeni liniowej, przez ten sam
// tone mapping ACES co teren), więc nie ma żadnej przerwy ani poświaty.
export function createSky(fogColorHex, { simple = false, physicalBodies = false } = {}) {
  const dayZenith = new Color(0x2a63b8), dayMid = new Color(0x7db3e2), dayHorizon = new Color(fogColorHex);
  const nightZenith = new Color(0x02040d), nightMid = new Color(0x080e20), nightHorizon = new Color(0x121b2e);
  const sunsetHorizon = new Color(0xb86542), sunsetSun = new Color(0xff9455), daySun = new Color(0xfff2dd);
  const uniforms = {
    uZenith: { value: new Color(0x2a63b8) },
    uMid: { value: new Color(0x7db3e2) },
    uHorizon: { value: new Color(fogColorHex) },
    uSunDir: { value: SUN_DIR.clone() },
    uSunColor: { value: new Color(0xfff2dd) },
    uTime: { value: 0 },
    uSpace: { value: 0 },
    uAirglow: { value: 1 },
    uMoonDir: { value: MOON_DIR },
    uDaylight: { value: 1 },
    uTwilight: { value: 0 },
    uSunVisibility: { value: 1 },
  };

  const mat = new ShaderMaterial({
    uniforms,
    side: BackSide,
    depthWrite: false,
    fog: false,
    vertexShader: /* glsl */ `
      varying vec3 vDir;
      void main() {
        vDir = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3 vDir;
      uniform vec3 uZenith;
      uniform vec3 uMid;
      uniform vec3 uHorizon;
      uniform vec3 uSunDir;
      uniform vec3 uSunColor;
      uniform float uTime;
      uniform float uSpace;
      uniform float uAirglow;
      uniform vec3 uMoonDir;
      uniform float uDaylight;
      uniform float uTwilight;
      uniform float uSunVisibility;

      vec3 spaceSky(vec3 d) {
        vec3 col = vec3(0.0005, 0.001, 0.003);
        col += uHorizon * pow(1.0 - abs(d.y), 36.0) * 0.035 * uAirglow;
        float sunAngle = acos(clamp(dot(d, uSunDir), -1.0, 1.0));
        float aa = max(fwidth(sunAngle), 0.0003);
        col += uSunColor * (18.0 * (1.0 - smoothstep(0.012, 0.012 + aa, sunAngle)) + 0.6 * exp(-sunAngle * 48.0));
        // Artistic Moon direction, with a shaded surface and dark maria.
        vec3 right = normalize(cross(vec3(0.0, 1.0, 0.0), uMoonDir));
        vec3 up = cross(uMoonDir, right);
        vec2 p = vec2(dot(d, right), dot(d, up)) / 0.026;
        float r = length(p), edge = max(fwidth(r), 0.01);
        if (${physicalBodies ? 'false' : 'true'} && dot(d, uMoonDir) > 0.99 && r < 1.0 + edge) {
          vec3 normal = normalize(right * p.x + up * p.y - uMoonDir * sqrt(max(0.0, 1.0 - r * r)));
          float shade = 0.16 + 0.84 * max(0.0, dot(normal, uSunDir));
          float maria = 0.70 + 0.18 * sin(p.x * 15.0 + sin(p.y * 12.0)) * sin(p.y * 19.0);
          float crater = smoothstep(0.22, 0.40, length(p - vec2(-0.25, 0.12)));
          vec3 moon = vec3(0.72, 0.76, 0.82) * shade * maria * mix(0.56, 1.0, crater);
          col = mix(col, moon, 1.0 - smoothstep(1.0 - edge, 1.0 + edge, r));
        }
        return col;
      }

      ${simple ? "" : `
      float hash(vec2 p) {
        return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
      }
      float vnoise(vec2 p) {
        vec2 i = floor(p), f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(
          mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
          mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
          u.y
        );
      }
      float fbm(vec2 p) {
        float v = 0.0, a = 0.5;
        for (int i = 0; i < 5; i++) {
          v += a * vnoise(p);
          p = p * 2.03 + 17.1;
          a *= 0.5;
        }
        return v;
      }
      `}

      void main() {
        vec3 d = normalize(vDir);
        float h = d.y;

        // gradient nieba — bardzo łagodny przy horyzoncie, żeby nie było pasma
        float t = clamp(h, 0.0, 1.0);
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.12, t));
        col = mix(col, uZenith, smoothstep(0.12, 0.65, t));
        if (h < 0.0) col = uHorizon; // pod horyzontem czysta mgła

        // słońce: tarcza + poświata
        float s = max(dot(d, uSunDir), 0.0);
        col += uSunColor * (pow(s, 1400.0) * 8.0 + pow(s, 48.0) * 0.25 + pow(s, 6.0) * 0.05) * uSunVisibility;
        col += vec3(0.45, 0.095, 0.025) * uTwilight * pow(s, 3.0) * exp(-abs(h) * 7.0);

        ${simple ? "" : `
        // chmury — rzut kierunku na płaszczyznę, dryf w czasie
        if (h > 0.005) {
          vec2 cuv = d.xz / (h + 0.12) * 0.55;
          cuv += uTime * 0.006;
          float warp = fbm(cuv * 1.7 + 3.1);
          float f = fbm(cuv * 1.15 + warp * 0.9);
          float cov = smoothstep(0.50, 0.74, f);
          float fade = smoothstep(0.02, 0.16, h) * (1.0 - smoothstep(0.75, 1.0, h) * 0.35);
          float shade = fbm(cuv * 2.6 + 8.7);
          vec3 cloud = mix(vec3(0.60, 0.64, 0.70), vec3(1.18, 1.14, 1.07), smoothstep(0.3, 0.9, shade));
          cloud += uSunColor * pow(s, 4.0) * 0.22;
          cloud *= mix(vec3(0.006, 0.010, 0.020), vec3(1.0), uDaylight);
          col = mix(col, cloud, cov * fade * 0.85);
        }
        `}

        if (uSpace > 0.0) col = mix(col, spaceSky(d), uSpace);
        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }
    `,
  });

  const mesh = new Mesh(new SphereGeometry(5e6, simple ? 16 : 48, simple ? 12 : 24), mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -100;
  // Uniform directions on a sphere avoid equirectangular star streaks at the poles.
  let seed = 737320;
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
  const positions = [], colors = [], direction = new Vector3(), starColor = new Color();
  for (let i = 0; i < (simple ? 2800 : 6000); i++) {
    const y = random() * 2 - 1, phi = random() * Math.PI * 2, r = Math.sqrt(1 - y * y);
    direction.set(r * Math.cos(phi), y, r * Math.sin(phi));
    if (direction.dot(SUN_DIR) > .9995 || direction.dot(MOON_DIR) > .9995) continue;
    positions.push(...direction.multiplyScalar(4.9e6).toArray());
    starColor.setHex(random() > .8 ? 0xffe1af : random() > .4 ? 0xffffff : 0xb6d0ff).multiplyScalar(.3 + random() * .7);
    colors.push(starColor.r, starColor.g, starColor.b);
  }
  const starGeometry = new BufferGeometry();
  starGeometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  starGeometry.setAttribute("color", new Float32BufferAttribute(colors, 3));
  const starMaterial = new PointsMaterial({ size: 1.6, sizeAttenuation: false, vertexColors: true, transparent: true, opacity: 0, depthTest: true, depthWrite: false, fog: false, toneMapped: false });
  const starUp = { value: new Vector3(0, 1, 0) };
  starMaterial.onBeforeCompile = shader => {
    shader.uniforms.starUp = starUp;
    shader.uniforms.uSpace = uniforms.uSpace;
    shader.vertexShader = 'uniform vec3 starUp;\nvarying float vStarHeight;\n' + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvStarHeight = dot(normalize(mat3(modelMatrix) * position), starUp);');
    shader.fragmentShader = 'uniform float uSpace;\nvarying float vStarHeight;\n' + shader.fragmentShader;
    shader.fragmentShader = shader.fragmentShader.replace('#include <opaque_fragment>', 'diffuseColor.a *= mix(smoothstep(0.0, 0.08, vStarHeight), 1.0, uSpace);\n#include <opaque_fragment>');
  };
  const stars = new Points(starGeometry, starMaterial); stars.name = "space-stars"; stars.frustumCulled = false; stars.visible = false; stars.renderOrder = -99; stars.raycast = () => {}; mesh.add(stars);
  return { mesh, uniforms,
    update(altitudeM, elapsedSeconds, fog, solar) {
      const blend = spaceSkyBlend(Number.isFinite(altitudeM) ? altitudeM : 0);
      const daylight = solar?.daylight ?? 1, twilight = solar?.twilight ?? 0;
      uniforms.uDaylight.value = daylight;
      uniforms.uTwilight.value = twilight;
      uniforms.uSunVisibility.value = solar?.sunlight ?? 1;
      uniforms.uZenith.value.copy(nightZenith).lerp(dayZenith, daylight);
      uniforms.uMid.value.copy(nightMid).lerp(dayMid, daylight);
      uniforms.uHorizon.value.copy(nightHorizon).lerp(dayHorizon, daylight).lerp(sunsetHorizon, twilight * .45);
      uniforms.uSunColor.value.copy(sunsetSun).lerp(daySun, Math.max(0, Math.min(1, (solar?.elevation ?? 30) / 25)));
      uniforms.uSpace.value = blend;
      uniforms.uAirglow.value = Math.max(0, Math.min(1, (120000 - altitudeM) / 100000));
      starMaterial.opacity = Math.max(blend, solar?.stars ?? 0);
      stars.visible = starMaterial.opacity > 0;
      starUp.value.set(0, 1, 0).applyQuaternion(mesh.quaternion);
      uniforms.uTime.value = elapsedSeconds;
      if (fog?.isFogExp2) {
        fog.density = 0.00007 * (1 - blend) + 0.00000015 * blend;
        fog.color.copy(uniforms.uHorizon.value).lerp(SPACE_FOG_COLOR, blend);
      }
    },
    dispose() { mesh.removeFromParent(); mesh.geometry.dispose(); mat.dispose(); starGeometry.dispose(); starMaterial.dispose(); },
  };
}
