import {
  Box3,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  RepeatWrapping,
  Vector3,
} from "three";

const START_KMH = 1000;
const SAMPLE_INTERVAL = 1 / 40;

// Seconds from emission to disappearance; fading occupies the end of that time.
export const CONTRAIL_DEFAULTS = {
  lifetimeSeconds: 15,
  fadeSeconds: 5,
  spreadMetersPerSecond: 0.35,
  driftMetersPerSecond: 0.12,
};

function wingTips(root, wingAxes) {
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert();
  const point = new Vector3();
  const box = new Box3();
  const meshes = [];
  root.traverse((mesh) => {
    const positions = mesh.isMesh && mesh.geometry?.attributes.position;
    if (!positions) return;
    const transform = new Matrix4().multiplyMatrices(inverse, mesh.matrixWorld);
    meshes.push({ positions, transform });
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(transform);
      box.expandByPoint(point);
    }
  });
  // Use the same mesh vertices and aircraft-local frame for bounds and tips.
  // Sprite halos extend beyond the wings but cannot emit a contrail.
  const wings = wingAxes.flatMap((axis) => {
    const margin = (box.max[axis] - box.min[axis]) * 0.02;
    return [
      { axis, edge: box.min[axis] + margin, side: -1 },
      { axis, edge: box.max[axis] - margin, side: 1 },
    ];
  });
  const tips = wings.map(() => new Vector3(0, 0, -Infinity));
  for (const { positions, transform } of meshes) {
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(transform);
      // Trailing edge of each outer wing, after model normalization.
      for (let wing = 0; wing < wings.length; wing++) {
        const { axis, edge, side } = wings[wing];
        if (side * (point[axis] - edge) >= 0 && point.z > tips[wing].z) tips[wing].copy(point);
      }
    }
  }
  return tips;
}

function trailTexture() {
  const size = 64;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const across = (x + 0.5) / size * 2 - 1;
    const along = (y + 0.5) / size * Math.PI * 2;
    const center = Math.sin(along) * 0.16 + Math.sin(along * 3) * 0.06;
    const softness = 0.5 + Math.sin(along * 2) * 0.1;
    const cloud = Math.exp(-2 * ((across - center) / softness) ** 2);
    const wisps = 0.55 + Math.sin(along * 3 + across * 7) * 0.25 + Math.cos(along * 5 - across * 11) * 0.2;
    const edge = Math.max(0, 1 - Math.abs(across) ** 4);
    const i = (y * size + x) * 4;
    data[i] = data[i + 1] = data[i + 2] = 255;
    data[i + 3] = Math.round(cloud * wisps * edge * 255);
  }
  const texture = new DataTexture(data, size, size);
  texture.wrapT = RepeatWrapping;
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// Call on the centered model before its first placement in the world.
export function attachContrails(root, scene, options = {}) {
  if (root.userData.contrails) return;
  const lifetimeSeconds = options.lifetimeSeconds ?? CONTRAIL_DEFAULTS.lifetimeSeconds;
  const fadeSeconds = Math.min(lifetimeSeconds, options.fadeSeconds ?? CONTRAIL_DEFAULTS.fadeSeconds);
  const spreadRate = options.spreadMetersPerSecond ?? CONTRAIL_DEFAULTS.spreadMetersPerSecond;
  const driftRate = options.driftMetersPerSecond ?? CONTRAIL_DEFAULTS.driftMetersPerSecond;
  if (!Number.isFinite(lifetimeSeconds) || lifetimeSeconds <= 0 ||
      !Number.isFinite(fadeSeconds) || fadeSeconds < 0) {
    throw new RangeError("Contrail lifetime must be positive and fade time non-negative.");
  }
  if (!Number.isFinite(spreadRate) || spreadRate < 0 || !Number.isFinite(driftRate) || driftRate < 0) {
    throw new RangeError("Contrail spreading and drift rates must be non-negative.");
  }
  // Retain a full lifetime even at the highest sampling rate, plus the live tip.
  const capacity = Math.ceil(lifetimeSeconds / SAMPLE_INTERVAL) + 2;
  // Aircraft use left/right wings; rockets also have lower/upper fins.
  const tips = wingTips(root, options.wingAxes ?? ["x"]);
  if (tips.some((tip) => !Number.isFinite(tip.z))) return;
  const group = new Group();
  group.name = "wing-contrails";
  group.visible = false;
  scene.add(group);
  const texture = trailTexture();
  const material = new MeshBasicMaterial({
    color: 0xffffff,
    map: texture,
    vertexColors: true,
    transparent: true,
    opacity: 0.7,
    depthWrite: false,
    side: DoubleSide,
    toneMapped: false,
  });
  const ribbons = tips.map(() => {
    const geometry = new BufferGeometry();
    const positions = new Float32BufferAttribute(new Float32Array(capacity * 6), 3);
    const colors = new Float32BufferAttribute(new Float32Array(capacity * 8), 4);
    const uvs = new Float32Array(capacity * 4);
    for (let i = 0; i < capacity; i++) uvs[i * 4 + 2] = 1;
    positions.setUsage(DynamicDrawUsage);
    colors.setUsage(DynamicDrawUsage);
    geometry.setAttribute("position", positions);
    geometry.setAttribute("color", colors);
    const uv = new Float32BufferAttribute(uvs, 2).setUsage(DynamicDrawUsage);
    geometry.setAttribute("uv", uv);
    geometry.setIndex(Array((capacity - 1) * 6).fill(0));
    geometry.index.setUsage(DynamicDrawUsage);
    geometry.setDrawRange(0, 0);
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    group.add(mesh);
    return { geometry, positions, colors, uv };
  });
  // World positions remain doubles. GPU vertices are relative to the aircraft
  // to avoid jitter at Earth-sized coordinates.
  const samples = Array.from({ length: capacity }, () => ({
    points: tips.map(() => new Vector3()),
    right: new Vector3(),
    up: new Vector3(),
    distance: 0,
    at: 0,
    start: false,
  }));
  const current = tips.map(() => new Vector3());
  const cameraPos = new Vector3();
  const origin = new Vector3();
  const tangent = new Vector3();
  const view = new Vector3();
  const side = new Vector3();
  const vertex = new Vector3();
  const dispersedPoint = new Vector3();
  let first = 0;
  let count = 0;
  let time = 0;
  let nextSampleAt = 0;
  let emitting = false;
  let distance = 0;

  function reset() {
    first = count = 0;
    emitting = false;
    group.visible = false;
    for (const ribbon of ribbons) ribbon.geometry.setDrawRange(0, 0);
  }

  root.userData.contrails = {
    update(dt, kmh, active, camera) {
      if (!active) {
        reset();
        return;
      }
      time += dt;
      while (count && time - samples[first].at >= lifetimeSeconds) {
        first = (first + 1) % capacity;
        count--;
      }
      root.updateWorldMatrix(true, false);
      root.getWorldPosition(origin);
      for (let wing = 0; wing < tips.length; wing++) current[wing].copy(tips[wing]).applyMatrix4(root.matrixWorld);
      const last = count ? samples[(first + count - 1) % capacity] : null;
      if (emitting && last && current[0].distanceTo(last.points[0]) > Math.max(100, kmh / 3.6 * dt * 5)) reset();
      const fast = Number.isFinite(kmh) && kmh > START_KMH;
      if (fast) {
        distance = emitting && last ? distance + current[0].distanceTo(last.points[0]) : 0;
        let head;
        if (!emitting || !count || time >= nextSampleAt) {
          if (count === capacity) { first = (first + 1) % capacity; count--; }
          head = samples[(first + count++) % capacity];
          head.start = !emitting;
          nextSampleAt = time + SAMPLE_INTERVAL;
        } else head = samples[(first + count - 1) % capacity];
        head.at = time;
        head.distance = distance;
        head.right.setFromMatrixColumn(root.matrixWorld, 0).normalize();
        head.up.setFromMatrixColumn(root.matrixWorld, 1).normalize();
        for (let wing = 0; wing < tips.length; wing++) head.points[wing].copy(current[wing]);
      }
      emitting = fast;
      group.visible = count >= 2;
      if (!group.visible) return;
      group.position.copy(origin);
      camera.getWorldPosition(cameraPos);
      for (let wing = 0; wing < tips.length; wing++) {
        const { geometry, positions, colors, uv } = ribbons[wing];
        let indexCount = 0;
        for (let i = 0; i < count; i++) {
          const sample = samples[(first + i) % capacity];
          const prev = i > 0 ? samples[(first + i - 1) % capacity] : null;
          const next = i + 1 < count ? samples[(first + i + 1) % capacity] : null;
          const point = sample.points[wing];
          const ageSeconds = time - sample.at;
          const phase = sample.distance * 0.045 + wing * 0.8;
          const diffusion = 1 - Math.exp(-ageSeconds * 0.4);
          // Drift in the frame recorded at emission, independent of the camera
          // and the aircraft's subsequent turns. Old vapor stays in the air.
          dispersedPoint.copy(point)
            .addScaledVector(sample.right, Math.sin(phase + ageSeconds * 0.35) * driftRate * ageSeconds * diffusion)
            .addScaledVector(sample.up, Math.sin(phase * 0.7 - ageSeconds * 0.24) * driftRate * ageSeconds * diffusion * 0.5);
          if (next && !next.start) tangent.subVectors(next.points[wing], point);
          else if (prev && !sample.start) tangent.subVectors(point, prev.points[wing]);
          else tangent.set(0, 0, 1);
          view.subVectors(cameraPos, dispersedPoint);
          side.crossVectors(tangent, view);
          if (side.lengthSq() < 1e-10) side.setFromMatrixColumn(camera.matrixWorld, 0);
          const width = 0.14 + ageSeconds * spreadRate;
          const irregularity = 1 + Math.sin(phase * 1.7 + ageSeconds * 0.45) * diffusion * 0.12;
          side.normalize().multiplyScalar(width * irregularity * 0.5);
          const fade = fadeSeconds > 0
            ? Math.max(0, Math.min(1, (ageSeconds - (lifetimeSeconds - fadeSeconds)) / fadeSeconds))
            : 0;
          // Smoothstep reaches zero gently, so expiring samples do not pop out.
          const density = 1 / Math.sqrt(1 + ageSeconds * spreadRate * 0.55);
          const endTaper = count > 3 && (!prev || sample.start || (!next && !emitting)) ? 0 : 1;
          const alpha = (1 - fade * fade * (3 - 2 * fade)) * density * endTaper;
          vertex.copy(dispersedPoint).sub(origin).sub(side);
          positions.setXYZ(i * 2, vertex.x, vertex.y, vertex.z);
          vertex.copy(dispersedPoint).sub(origin).add(side);
          positions.setXYZ(i * 2 + 1, vertex.x, vertex.y, vertex.z);
          colors.setXYZW(i * 2, 1, 1, 1, alpha);
          colors.setXYZW(i * 2 + 1, 1, 1, 1, alpha);
          // Anchor the cloud pattern to emitted distance instead of sample index,
          // so it cannot slide when the circular history buffer wraps.
          uv.setY(i * 2, sample.distance / 80);
          uv.setY(i * 2 + 1, sample.distance / 80);
          if (prev && !sample.start) {
            const a = (i - 1) * 2, b = i * 2;
            const indices = geometry.index.array;
            indices[indexCount++] = a;
            indices[indexCount++] = a + 1;
            indices[indexCount++] = b;
            indices[indexCount++] = a + 1;
            indices[indexCount++] = b + 1;
            indices[indexCount++] = b;
          }
        }
        positions.needsUpdate = colors.needsUpdate = uv.needsUpdate = geometry.index.needsUpdate = true;
        geometry.setDrawRange(0, indexCount);
      }
    },
    reset,
    dispose() {
      group.removeFromParent();
      for (const ribbon of ribbons) ribbon.geometry.dispose();
      material.dispose();
      texture.dispose();
      delete root.userData.contrails;
    },
  };
}

export function updateContrails(root, dt, kmh, active, camera) {
  root?.userData.contrails?.update(dt, kmh, active, camera);
}

export function disposeContrails(root) {
  root?.userData.contrails?.dispose();
}
