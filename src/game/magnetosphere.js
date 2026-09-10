import * as THREE from 'three';

// Educational model, not a space-weather forecast. Distances are geocentric.
// External vectors are metres in an equatorial inertial frame with +Z north.
export const EARTH_SPACE_CONSTANTS = Object.freeze({
  meanRadius: 6_371_000,
  equatorialRadius: 6_378_137,
  siderealPeriod: 86_164.09053,
  angularVelocity: 7.292115e-5,
  obliquity: 23.44 * Math.PI / 180,
  magneticTilt: 11 * Math.PI / 180,
  nominalSolarPressure: 2,
  solarWindSpeed: 450_000,
  tracerTimeScale: 100,
  renderedTailRadii: 1000,
});

const RE = EARTH_SPACE_CONSTANTS.meanRadius;
const TAU = Math.PI * 2;
const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const COLORS = {
  plasmasphere: 0x50e5bc, innerBelt: 0xffbe52, outerBelt: 0xff826c,
  magnetopause: 0x51cbe8, magnetosheath: 0x8b8bcf, bowShock: 0xdcc9ff,
  magnetotail: 0x58a6df, solarWind: 0xffdb84, magneticAxis: 0xffb666,
};

export const SPACE_ZONE_LABELS = Object.freeze({
  earth: 'Earth', atmosphere: 'Near Earth / atmosphere',
  plasmasphere: 'Plasmasphere', innerBelt: 'Inner Van Allen belt',
  outerBelt: 'Outer Van Allen belt', magnetosphere: 'Magnetosphere',
  magnetopause: 'Magnetopause', magnetosheath: 'Magnetosheath',
  bowShock: 'Bow shock', magnetotail: 'Magnetotail',
  solarWind: 'Solar wind / interplanetary magnetic field',
  unmodeledTail: 'Distant tail — extent uncertain',
});

export function earthRadiiToDistance(radii) {
  return { centerMeters: radii * RE, altitudeMeters: (radii - 1) * RE };
}

export function magnetosphereParameters(solarPressure = 2) {
  const pressure = THREE.MathUtils.clamp(Number.isFinite(solarPressure) ? solarPressure : 2, 0.1, 30);
  // Dipole magnetic pressure ~ r^-6 balanced by solar-wind dynamic pressure.
  // IMF orientation, reconnection and storm history are deliberately not solved.
  const pressureScale = (2 / pressure) ** (1 / 6);
  return {
    solarPressure: pressure, pressureScale,
    magnetopauseRadii: 10 * pressureScale,
    bowShockRadii: 14 * pressureScale,
    plasmasphereRadii: 4.5,
    innerBeltRadii: [1.5, 3.5], outerBeltRadii: [3, 7],
    outerBeltPossibleRadii: 10,
    renderedTailRadii: EARTH_SPACE_CONSTANTS.renderedTailRadii,
    magneticTilt: EARTH_SPACE_CONSTANTS.magneticTilt,
  };
}

function solarBasis(direction) {
  const x = new THREE.Vector3(direction?.x ?? 1, direction?.y ?? 0, direction?.z ?? 0);
  if (x.lengthSq() < 1e-12) x.copy(X);
  x.normalize();
  const z = Math.abs(x.dot(Z)) > 0.98 ? new THREE.Vector3(0, 1, 0) : Z.clone();
  z.addScaledVector(x, -z.dot(x)).normalize();
  const y = z.clone().cross(x).normalize();
  return { x, y, z, rotation: new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z)) };
}

function magneticRotation(siderealTime = 0) {
  return new THREE.Quaternion().setFromAxisAngle(Z, siderealTime)
    .multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), EARTH_SPACE_CONSTANTS.magneticTilt));
}

// Cross-section radius in RE for a compressed dayside and long open tail.
// There is no cap at the remote tail end: 1000 RE is a drawing extent only.
export function boundaryRadiusAt(x, parameters = magnetosphereParameters(), bowShock = false) {
  const nose = bowShock ? parameters.bowShockRadii : parameters.magnetopauseRadii;
  const flank = (bowShock ? 19 : 15) * parameters.pressureScale;
  if (x >= nose) return 0;
  if (x >= 0) return flank * Math.sqrt(Math.max(0, 1 - (x / nose) ** 2));
  return flank * (1 + 0.65 * (1 - Math.exp(x / (80 * parameters.pressureScale))));
}

function insideBelt(point, radius, tube, flattening) {
  return ((Math.hypot(point.x, point.y) - radius) / tube) ** 2 + (point.z / (tube * flattening)) ** 2 <= 1;
}

export function classifySpaceEnvironment(positionMeters, options = {}) {
  const parameters = magnetosphereParameters(options.solarPressure);
  const position = new THREE.Vector3(positionMeters.x, positionMeters.y, positionMeters.z).divideScalar(RE);
  const radius = position.length();
  const basis = solarBasis(options.sunDirection);
  const alongSun = position.dot(basis.x);
  const crossSun = Math.sqrt(Math.max(0, radius * radius - alongSun * alongSun));
  const inMagnetopause = alongSun <= parameters.magnetopauseRadii && crossSun <= boundaryRadiusAt(alongSun, parameters);
  const inBowShock = alongSun <= parameters.bowShockRadii && crossSun <= boundaryRadiusAt(alongSun, parameters, true);
  let region = 'solarWind';
  if (radius < 1) region = 'earth';
  else if (radius < 1 + 100_000 / RE) region = 'atmosphere';
  else if (inMagnetopause) region = alongSun < -1000 ? 'unmodeledTail' : alongSun < -8 ? 'magnetotail' : 'magnetosphere';
  else if (inBowShock) region = 'magnetosheath';
  const magneticPoint = position.clone().applyQuaternion(magneticRotation(options.siderealTime).invert());
  const zones = [region];
  if (radius >= 1 && inMagnetopause) {
    if (Math.hypot(magneticPoint.x, magneticPoint.y, magneticPoint.z / 0.72) <= parameters.plasmasphereRadii) zones.push('plasmasphere');
    if (insideBelt(magneticPoint, 2.5, 1, 0.8)) zones.push('innerBelt');
    if (insideBelt(magneticPoint, 5, 2, 0.6)) zones.push('outerBelt');
  }
  // Boundary neighbourhoods are teaching labels, not precise measured surfaces.
  if (radius > 1) {
    if (Math.abs(alongSun - parameters.magnetopauseRadii) < 0.15 && crossSun < 0.3) zones.push('magnetopause');
    if (Math.abs(alongSun - parameters.bowShockRadii) < 0.15 && crossSun < 0.3) zones.push('bowShock');
  }
  return {
    region, label: SPACE_ZONE_LABELS[region], zones,
    zoneLabels: zones.map(zone => SPACE_ZONE_LABELS[zone]),
    radiusEarthRadii: radius, centerMeters: radius * RE, altitudeMeters: (radius - 1) * RE,
    magneticLatitude: radius ? Math.asin(THREE.MathUtils.clamp(magneticPoint.z / radius, -1, 1)) : 0,
    solarPressure: parameters.solarPressure,
    magnetopause: earthRadiiToDistance(parameters.magnetopauseRadii),
    bowShock: earthRadiiToDistance(parameters.bowShockRadii),
    approximate: true,
    note: 'Schematic plasma regions; crossing a boundary does not make the magnetic field zero.',
  };
}

function transparentMaterial(color, opacity) {
  return new THREE.MeshBasicMaterial({ color, opacity, transparent: true, depthWrite: false, side: THREE.DoubleSide });
}

function shellGeometry(parameters, bowShock = false) {
  const positions = [], indices = [];
  const nose = bowShock ? parameters.bowShockRadii : parameters.magnetopauseRadii;
  const sections = [];
  // Concentrate detail near Earth; keep a finite, open and asymmetric tail.
  for (let i = 0; i <= 24; i++) sections.push(nose * Math.cos(i / 24 * Math.PI / 2));
  for (let i = 1; i <= 42; i++) sections.push(-1000 * (i / 42) ** 2.3);
  const sides = 40;
  for (const x of sections) {
    const radius = boundaryRadiusAt(x, parameters, bowShock);
    for (let j = 0; j <= sides; j++) {
      const angle = j / sides * TAU;
      positions.push(x, radius * Math.cos(angle), radius * Math.sin(angle));
    }
  }
  for (let i = 0; i < sections.length - 1; i++) for (let j = 0; j < sides; j++) {
    const a = i * (sides + 1) + j, b = a + sides + 1;
    indices.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeBoundingSphere();
  return geometry;
}

function boundaryLines(parameters, bowShock = false) {
  const coordinates = [];
  const nose = bowShock ? parameters.bowShockRadii : parameters.magnetopauseRadii;
  const sections = [];
  for (let i = 0; i <= 40; i++) sections.push(nose * (1 - i / 40));
  for (let i = 1; i <= 52; i++) sections.push(-1000 * (i / 52) ** 2.3);
  for (let spoke = 0; spoke < 8; spoke++) {
    const angle = spoke / 8 * TAU;
    for (let i = 1; i < sections.length; i++) {
      for (const x of [sections[i - 1], sections[i]]) {
        const radius = boundaryRadiusAt(x, parameters, bowShock);
        coordinates.push(x, radius * Math.cos(angle), radius * Math.sin(angle));
      }
    }
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
}

function dipoleLines() {
  const coordinates = [];
  for (const lShell of [2, 3.5, 5, 7]) for (let meridian = 0; meridian < 8; meridian++) {
    const phi = meridian / 8 * TAU;
    const maxLatitude = Math.acos(Math.sqrt(1 / lShell));
    for (let i = 0; i < 42; i++) for (const step of [i, i + 1]) {
      const latitude = -maxLatitude + 2 * maxLatitude * step / 42;
      const r = lShell * Math.cos(latitude) ** 2;
      coordinates.push(r * Math.cos(latitude) * Math.cos(phi), r * Math.cos(latitude) * Math.sin(phi), r * Math.sin(latitude));
    }
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(coordinates, 3));
}

function labelSprite(text, color) {
  if (typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = 512; canvas.height = 80;
  const context = canvas.getContext('2d');
  context.fillStyle = 'rgba(5,12,25,.8)'; context.fillRect(0, 0, 512, 80);
  context.font = '500 30px sans-serif'; context.fillStyle = `#${new THREE.Color(color).getHexString()}`;
  context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText(text, 256, 40, 492);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(8, 1.25, 1);
  sprite.name = `label:${text}`;
  return sprite;
}

/**
 * Add root to the caller's scene. update receives Earth-centre render position,
 * equatorial-inertial -> render quaternion, and render units per metre.
 * For a far scene with 1 unit = 1000 km, use metersToWorld: 1e-6.
 * siderealTime is an ANGLE in radians; time is simulation time in seconds.
 */
export function createMagnetosphereOverlay() {
  const root = new THREE.Group(); root.name = 'magnetosphere-teaching-overlay'; root.visible = false;
  const solarFrame = new THREE.Group(), dipoleFrame = new THREE.Group();
  root.add(solarFrame, dipoleFrame);
  let parameters = magnetosphereParameters(), lastOptions = {}, disposed = false;
  const boundaryObjects = [];
  function rebuildBoundaries() {
    for (const object of boundaryObjects) { solarFrame.remove(object); object.geometry.dispose(); object.material.dispose(); }
    boundaryObjects.length = 0;
    for (const bowShock of [false, true]) {
      const color = bowShock ? COLORS.bowShock : COLORS.magnetopause;
      const mesh = new THREE.Mesh(shellGeometry(parameters, bowShock), transparentMaterial(color, bowShock ? 0.025 : 0.045));
      mesh.name = bowShock ? 'bow-shock-surface' : 'magnetopause-and-open-magnetotail';
      const lines = new THREE.LineSegments(boundaryLines(parameters, bowShock), new THREE.LineBasicMaterial({ color, transparent: true, opacity: bowShock ? 0.24 : 0.4, depthWrite: false }));
      lines.name = bowShock ? 'bow-shock-contours' : 'magnetopause-contours';
      solarFrame.add(mesh, lines); boundaryObjects.push(mesh, lines);
    }
  }
  rebuildBoundaries();
  const plasmasphere = new THREE.Mesh(new THREE.SphereGeometry(4.5, 36, 24), transparentMaterial(COLORS.plasmasphere, 0.045));
  plasmasphere.scale.z = 0.72; plasmasphere.name = 'plasmasphere'; dipoleFrame.add(plasmasphere);
  for (const [name, radius, tube, flattening] of [['innerBelt', 2.5, 1, 0.8], ['outerBelt', 5, 2, 0.6]]) {
    const belt = new THREE.Mesh(new THREE.TorusGeometry(radius, tube, 14, 56), transparentMaterial(COLORS[name], 0.16));
    belt.scale.z = flattening; belt.name = name; dipoleFrame.add(belt);
  }
  const dipole = new THREE.LineSegments(dipoleLines(), new THREE.LineBasicMaterial({ color: COLORS.magneticAxis, transparent: true, opacity: 0.22, depthWrite: false }));
  dipole.name = 'tilted-dipole-field-lines'; dipoleFrame.add(dipole);
  function axis(group, name, color, halfLength) {
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0, 0, -halfLength), new THREE.Vector3(0, 0, halfLength)]);
    const line = new THREE.Line(geometry, new THREE.LineDashedMaterial({ color, dashSize: 0.3, gapSize: 0.15, transparent: true, opacity: 0.65 }));
    line.computeLineDistances(); line.name = name; group.add(line);
  }
  axis(root, 'rotation-axis', 0xf1f5ff, 8);
  axis(dipoleFrame, 'magnetic-axis-11-degrees', COLORS.magneticAxis, 8);
  const windCount = 200;
  const windPositions = new Float32Array(windCount * 2 * 3);
  const windGeometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(windPositions, 3).setUsage(THREE.DynamicDrawUsage));
  const wind = new THREE.LineSegments(windGeometry, new THREE.LineBasicMaterial({ color: COLORS.solarWind, transparent: true, opacity: 0.65, depthWrite: false }));
  wind.name = 'animated-solar-wind-tracers'; wind.frustumCulled = false; solarFrame.add(wind);
  const labels = [];
  function addLabel(name, color, parent, position) {
    const sprite = labelSprite(SPACE_ZONE_LABELS[name], color);
    if (sprite) { parent.add(sprite); labels.push({ name, sprite, position }); }
  }
  addLabel('plasmasphere', COLORS.plasmasphere, dipoleFrame, () => [0, -4.5, 2]);
  addLabel('innerBelt', COLORS.innerBelt, dipoleFrame, () => [0, 2.5, 2]);
  addLabel('outerBelt', COLORS.outerBelt, dipoleFrame, () => [0, 6, 3]);
  addLabel('magnetopause', COLORS.magnetopause, solarFrame, () => [parameters.magnetopauseRadii, 0, 2]);
  addLabel('magnetosheath', COLORS.magnetosheath, solarFrame, () => [(parameters.magnetopauseRadii + parameters.bowShockRadii) / 2, 0, -3]);
  addLabel('bowShock', COLORS.bowShock, solarFrame, () => [parameters.bowShockRadii, 0, 5]);
  addLabel('magnetotail', COLORS.magnetotail, solarFrame, () => [-65, 0, 18]);
  addLabel('solarWind', COLORS.solarWind, solarFrame, () => [30, 0, 15]);

  function update(options = {}) {
    if (disposed) return;
    lastOptions = { ...lastOptions, ...options };
    const next = magnetosphereParameters(lastOptions.solarPressure);
    if (Math.abs(next.solarPressure - parameters.solarPressure) > 1e-6) { parameters = next; rebuildBoundaries(); }
    root.position.copy(lastOptions.origin ?? new THREE.Vector3());
    root.quaternion.copy(lastOptions.orientation ?? new THREE.Quaternion());
    root.scale.setScalar(RE * (lastOptions.metersToWorld ?? 1));
    solarFrame.quaternion.copy(solarBasis(lastOptions.sunDirection).rotation);
    dipoleFrame.quaternion.copy(magneticRotation(lastOptions.siderealTime));
    for (const label of labels) label.sprite.position.set(...label.position());
    if (!root.visible) return;
    const time = Number.isFinite(lastOptions.time) ? lastOptions.time : 0;
    const flow = time * EARTH_SPACE_CONSTANTS.solarWindSpeed / RE * EARTH_SPACE_CONSTANTS.tracerTimeScale;
    for (let i = 0; i < windCount; i++) {
      const angle = i * 2.399963229728653;
      const baseRadius = 2 + 34 * Math.sqrt((i + 0.5) / windCount);
      const headX = 40 - ((i * 19.379 + flow) % 180 + 180) % 180;
      for (let end = 0; end < 2; end++) {
        const x = headX - end * 0.7;
        const shockRadius = boundaryRadiusAt(x, parameters, true);
        // Tracers divert around the sheath; they do not stream through Earth.
        const radius = Math.hypot(baseRadius, shockRadius + (shockRadius ? 0.4 : 0));
        const index = (i * 2 + end) * 3;
        windPositions[index] = x; windPositions[index + 1] = radius * Math.cos(angle); windPositions[index + 2] = radius * Math.sin(angle);
      }
    }
    windGeometry.attributes.position.needsUpdate = true;
  }

  return {
    root,
    setVisible(visible) { root.visible = Boolean(visible); },
    update,
    classify(positionMeters) { return classifySpaceEnvironment(positionMeters, lastOptions); },
    diagnostics() {
      return {
        visible: root.visible, ...parameters,
        magnetopause: earthRadiiToDistance(parameters.magnetopauseRadii),
        bowShock: earthRadiiToDistance(parameters.bowShockRadii),
        tailExtentIsDrawingLimit: true,
        solarWindSpeed: EARTH_SPACE_CONSTANTS.solarWindSpeed,
        tracerTimeScale: EARTH_SPACE_CONSTANTS.tracerTimeScale,
        labels: { ...SPACE_ZONE_LABELS },
      };
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      root.traverse(object => { object.geometry?.dispose(); object.material?.map?.dispose(); object.material?.dispose(); });
      root.removeFromParent();
    },
  };
}
