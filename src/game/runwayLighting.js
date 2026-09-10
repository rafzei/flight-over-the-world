import {
  AdditiveBlending, BoxGeometry, BufferGeometry, Color, Float32BufferAttribute,
  Group, InstancedMesh, MathUtils, Matrix4, MeshStandardMaterial, Points,
  ShaderMaterial, Vector2, Vector3, Vector4,
} from 'three';

const WHITE = 0xfff2d8, GREEN = 0x32ff7c, RED = 0xff3425, AMBER = 0xffc54c;
const DEG = Math.PI / 180;

export function runwayNightStrength(elevationDeg) {
  return 1 - MathUtils.smoothstep(elevationDeg, -6, 3);
}

export function papiWhites(angleDeg) {
  return [0, 1, 2, 3].filter(index => angleDeg >= 2.5 + index / 3).length;
}

// Game lighting is provided on every selectable runway, including those whose
// source catalogue has no lighting. Coordinates use the physical runway frame.
export function runwayLightLayout(data, { beacon = true } = {}) {
  const lamps = [], fixtures = [];
  const add = (x, along, color, kind = 0, face = 0, phase = 0, height = .35, size = 5) => {
    lamps.push({ position: [x, height, -along], color, kind, face, phase, size });
  };
  const width = data.width, length = data.length, step = length < 1000 ? 30 : 60;
  for (let along = 0; along <= length; along += step) {
    for (const side of [-1, 1]) {
      // Directional yellow caution lights mark the final part of each rollout.
      for (let end = 0; end < 2; end++) {
        const remaining = end ? along : length - along;
        add(side * (width / 2 + .6), along, remaining < Math.min(600, length / 3) ? AMBER : WHITE, 0, end ? -1 : 1);
      }
      fixtures.push({ x: side * (width / 2 + .6), along, height: .22, width: .32 });
    }
  }
  for (let end = 0; end < 2; end++) {
    const face = end ? -1 : 1, threshold = data.ends[end].threshold;
    const along = value => end ? length - value : value;
    const xAt = x => end ? -x : x;
    for (let x = -width / 2; x <= width / 2 + .01; x += Math.max(2, width / 16)) {
      add(xAt(x), along(threshold), GREEN, 0, face, 0, .16, 6);
      add(xAt(x), along(length), RED, 0, face, 0, .16, 6);
    }
    const available = length - data.ends[0].threshold - data.ends[1].threshold;
    const centerStep = length > 1500 ? 30 : 20;
    for (let n = 0, distance = 15; distance < available; distance += centerStep, n++) {
      const remaining = available - distance;
      const color = remaining < Math.min(300, available / 6) ? RED
        : remaining < Math.min(900, available / 2) && n % 2 ? RED : WHITE;
      add(0, along(threshold + distance), color, 0, face, 0, .09, 4);
    }
    const approachLength = length >= 1500 ? 600 : 240;
    for (let distance = 30; distance <= approachLength; distance += 30) {
      for (const x of [-1.4, 0, 1.4]) add(xAt(x), along(threshold - distance), WHITE, 0, face, 0, .7, 6);
      if (distance >= approachLength / 2) add(0, along(threshold - distance), WHITE, 3, face, distance / approachLength, .85, 9);
    }
    for (let x = -15; x <= 15; x += 3) add(xAt(x), along(threshold - Math.min(300, approachLength)), WHITE, 0, face, 0, .7, 6);
    const papiAlong = threshold + Math.min(300, available * .2);
    for (let i = 0; i < 4; i++) {
      const x = xAt(-width / 2 - 12 - i * 5);
      add(x, along(papiAlong), WHITE, 2, face, i, .8, 8);
      fixtures.push({ x, along: along(papiAlong), height: .6, width: 1.3 });
    }
  }
  // Floodlight masts stand outside the pavement; the terrain wash is handled
  // by the geographic day/night shader, without dozens of dynamic spotlights.
  for (const side of [-1, 1]) for (const ratio of [.18, .82]) {
    const x = side * (width / 2 + 24), along = length * ratio;
    fixtures.push({ x, along, height: 7, width: .22 });
    for (const dx of [-.7, 0, .7]) add(x + dx, along, WHITE, 0, 0, 0, 7.1, 7);
  }
  if (beacon) {
    const x = width / 2 + 55, along = data.ends[0].threshold + 100;
    fixtures.push({ x, along, height: 12, width: .4 });
    add(x, along, WHITE, 4, 0, 0, 12.2, 12);
  }
  return { lamps, fixtures };
}

export function createRunwayLighting(data, options) {
  const { lamps, fixtures } = runwayLightLayout(data, options);
  const root = new Group(); root.name = 'runway-night-lights';
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(lamps.flatMap(p => p.position), 3));
  const color = new Color();
  geometry.setAttribute('lampColor', new Float32BufferAttribute(lamps.flatMap(p => color.setHex(p.color).toArray()), 3));
  for (const [name, key] of [['lampSize', 'size'], ['lampKind', 'kind'], ['lampFace', 'face'], ['lampPhase', 'phase']]) {
    geometry.setAttribute(name, new Float32BufferAttribute(lamps.map(p => p[key]), 1));
  }
  const uniforms = {
    night: { value: 0 }, time: { value: 0 }, pixelRatio: { value: 1 }, resolutionHeight: { value: 800 },
    observer: { value: new Vector3() }, papiAngles: { value: new Vector2(3, 3) }, fogDensity: { value: .00007 },
  };
  const material = new ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, depthTest: true, blending: AdditiveBlending, toneMapped: false,
    vertexShader: `
      attribute vec3 lampColor;
      attribute float lampSize, lampKind, lampFace, lampPhase;
      uniform float night, time, pixelRatio, resolutionHeight;
      uniform vec3 observer;
      uniform vec2 papiAngles;
      varying vec3 vColor;
      varying float vAlpha, vDistance;
      void main() {
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        vDistance = length(mvPosition.xyz);
        float pixels = lampSize * resolutionHeight * projectionMatrix[1][1] / max(1.0, -mvPosition.z);
        gl_PointSize = clamp(pixels, 2.4 * pixelRatio, 32.0 * pixelRatio);
        vAlpha = night;
        if (lampFace != 0.0) vAlpha *= smoothstep(-3.0, 15.0, (observer.z - position.z) * lampFace);
        vColor = lampColor;
        if (lampKind == 2.0) {
          float angle = lampFace > 0.0 ? papiAngles.x : papiAngles.y;
          float transition = 2.5 + lampPhase / 3.0;
          vColor = mix(vec3(1.0, .025, .009), vec3(1.0, .94, .80), smoothstep(transition - .025, transition + .025, angle));
          gl_PointSize *= 1.25;
        }
        if (lampKind == 3.0) vAlpha *= step(fract(time * 1.6 + lampPhase), .12);
        if (lampKind == 4.0) {
          float phase = mod(time, 2.4);
          vColor = phase < 1.2 ? vec3(1.0, 1.0, .85) : vec3(.06, 1.0, .28);
          vAlpha *= .15 + .85 * pow(max(0.0, cos(phase * 5.23599)), 16.0);
        }
      }
    `,
    fragmentShader: `
      uniform float fogDensity;
      varying vec3 vColor;
      varying float vAlpha, vDistance;
      void main() {
        float r = length(gl_PointCoord - .5) * 2.0;
        if (r > 1.0) discard;
        float core = 1.0 - smoothstep(.08, .38, r);
        float halo = pow(1.0 - r, 2.3) * .65;
        float visibility = exp(-pow(vDistance * fogDensity * .65, 2.0));
        gl_FragColor = vec4(vColor * (1.0 + core * .5), (core + halo) * vAlpha * visibility);
        #include <colorspace_fragment>
      }
    `,
  });
  const points = new Points(geometry, material); points.name = 'runway-light-glows';
  points.renderOrder = 3; root.add(points);
  const housingMaterial = new MeshStandardMaterial({ color: 0x5f6569, roughness: .72, metalness: .35 });
  const housings = new InstancedMesh(new BoxGeometry(1, 1, 1), housingMaterial, fixtures.length);
  housings.name = 'runway-lamp-fixtures';
  const matrix = new Matrix4();
  fixtures.forEach((f, i) => {
    matrix.makeScale(f.width, f.height, f.width).setPosition(f.x, f.height / 2, -f.along);
    housings.setMatrixAt(i, matrix);
  });
  housings.instanceMatrix.needsUpdate = true; root.add(housings);
  const available = data.length - data.ends[0].threshold - data.ends[1].threshold;
  const papiAlong = Math.min(300, available * .2);
  const region = { start: new Vector4(), end: new Vector4() }, position = new Vector3();
  let strength = 0;
  return {
    root, lampCount: lamps.length, uniforms,
    update({ night = 0, camera, pixelRatio = 1, height = 800, fogDensity = .00007, time = 0 } = {}) {
      strength = MathUtils.clamp(night, 0, 1);
      points.visible = strength > .001; uniforms.night.value = strength; uniforms.time.value = time;
      uniforms.pixelRatio.value = pixelRatio; uniforms.resolutionHeight.value = height * pixelRatio;
      uniforms.fogDensity.value = fogDensity;
      if (camera) {
        root.worldToLocal(uniforms.observer.value.copy(camera.position));
        const p = uniforms.observer.value;
        uniforms.papiAngles.value.set(
          Math.atan2(p.y - .8, Math.max(1, p.z + data.ends[0].threshold + papiAlong)) / DEG,
          Math.atan2(p.y - .8, Math.max(1, -p.z - data.length + data.ends[1].threshold + papiAlong)) / DEG,
        );
      }
    },
    region() {
      position.set(0, 3, 0).applyMatrix4(root.matrixWorld);
      region.start.set(position.x, position.y, position.z, data.width / 2 + 100);
      position.set(0, 3, -data.length).applyMatrix4(root.matrixWorld);
      region.end.set(position.x, position.y, position.z, strength);
      return region;
    },
    dispose() { root.removeFromParent(); geometry.dispose(); material.dispose(); housings.geometry.dispose(); housingMaterial.dispose(); housings.dispose(); },
  };
}
