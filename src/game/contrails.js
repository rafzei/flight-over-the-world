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
  Vector3,
} from "three";

const START_KMH = 1000;
const LIFE = 2.5;
const SAMPLE_INTERVAL = 1 / 40;
const CAPACITY = 128;

function wingTips(root) {
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
  const margin = (box.max.x - box.min.x) * 0.02;
  const tips = [new Vector3(0, 0, -Infinity), new Vector3(0, 0, -Infinity)];
  for (const { positions, transform } of meshes) {
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(transform);
      // Trailing edge of each outer wing, after model normalization.
      if (point.x <= box.min.x + margin && point.z > tips[0].z) tips[0].copy(point);
      if (point.x >= box.max.x - margin && point.z > tips[1].z) tips[1].copy(point);
    }
  }
  return tips;
}

function trailTexture() {
  const data = new Uint8Array(32 * 4);
  for (let x = 0; x < 32; x++) {
    const t = Math.abs((x + 0.5) / 32 * 2 - 1);
    data[x * 4] = data[x * 4 + 1] = data[x * 4 + 2] = 255;
    data[x * 4 + 3] = Math.round((1 - t * t) ** 2 * 255);
  }
  const texture = new DataTexture(data, 32, 1);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// Call on the centered model before its first placement in the world.
export function attachContrails(root, scene) {
  if (root.userData.contrails) return;
  const tips = wingTips(root);
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
    const positions = new Float32BufferAttribute(new Float32Array(CAPACITY * 6), 3);
    const colors = new Float32BufferAttribute(new Float32Array(CAPACITY * 8), 4);
    const uvs = new Float32Array(CAPACITY * 4);
    for (let i = 0; i < CAPACITY; i++) uvs[i * 4 + 2] = 1;
    positions.setUsage(DynamicDrawUsage);
    colors.setUsage(DynamicDrawUsage);
    geometry.setAttribute("position", positions);
    geometry.setAttribute("color", colors);
    geometry.setAttribute("uv", new Float32BufferAttribute(uvs, 2));
    geometry.setIndex(Array((CAPACITY - 1) * 6).fill(0));
    geometry.index.setUsage(DynamicDrawUsage);
    geometry.setDrawRange(0, 0);
    const mesh = new Mesh(geometry, material);
    mesh.frustumCulled = false;
    group.add(mesh);
    return { geometry, positions, colors };
  });
  // World positions remain doubles. GPU vertices are relative to the aircraft
  // to avoid jitter at Earth-sized coordinates.
  const samples = Array.from({ length: CAPACITY }, () => ({
    points: [new Vector3(), new Vector3()],
    at: 0,
    start: false,
  }));
  const current = [new Vector3(), new Vector3()];
  const cameraPos = new Vector3();
  const origin = new Vector3();
  const tangent = new Vector3();
  const view = new Vector3();
  const side = new Vector3();
  const vertex = new Vector3();
  let first = 0;
  let count = 0;
  let time = 0;
  let nextSampleAt = 0;
  let emitting = false;

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
      while (count && time - samples[first].at >= LIFE) {
        first = (first + 1) % CAPACITY;
        count--;
      }
      root.updateWorldMatrix(true, false);
      root.getWorldPosition(origin);
      for (let wing = 0; wing < 2; wing++) current[wing].copy(tips[wing]).applyMatrix4(root.matrixWorld);
      const last = count ? samples[(first + count - 1) % CAPACITY] : null;
      if (emitting && last && current[0].distanceTo(last.points[0]) > Math.max(100, kmh / 3.6 * dt * 5)) reset();
      const fast = Number.isFinite(kmh) && kmh > START_KMH;
      if (fast) {
        let head;
        if (!emitting || !count || time >= nextSampleAt) {
          if (count === CAPACITY) { first = (first + 1) % CAPACITY; count--; }
          head = samples[(first + count++) % CAPACITY];
          head.start = !emitting;
          nextSampleAt = time + SAMPLE_INTERVAL;
        } else head = samples[(first + count - 1) % CAPACITY];
        head.at = time;
        for (let wing = 0; wing < 2; wing++) head.points[wing].copy(current[wing]);
      }
      emitting = fast;
      group.visible = count >= 2;
      if (!group.visible) return;
      group.position.copy(origin);
      camera.getWorldPosition(cameraPos);
      for (let wing = 0; wing < 2; wing++) {
        const { geometry, positions, colors } = ribbons[wing];
        let indexCount = 0;
        for (let i = 0; i < count; i++) {
          const sample = samples[(first + i) % CAPACITY];
          const prev = i > 0 ? samples[(first + i - 1) % CAPACITY] : null;
          const next = i + 1 < count ? samples[(first + i + 1) % CAPACITY] : null;
          const point = sample.points[wing];
          if (next && !next.start) tangent.subVectors(next.points[wing], point);
          else if (prev && !sample.start) tangent.subVectors(point, prev.points[wing]);
          else tangent.set(0, 0, 1);
          view.subVectors(cameraPos, point);
          side.crossVectors(tangent, view);
          if (side.lengthSq() < 1e-10) side.setFromMatrixColumn(camera.matrixWorld, 0);
          const age = Math.min(1, (time - sample.at) / LIFE);
          side.normalize().multiplyScalar(0.07 + age * 0.55);
          const alpha = (1 - age) ** 1.5;
          vertex.copy(point).sub(origin).sub(side);
          positions.setXYZ(i * 2, vertex.x, vertex.y, vertex.z);
          vertex.copy(point).sub(origin).add(side);
          positions.setXYZ(i * 2 + 1, vertex.x, vertex.y, vertex.z);
          colors.setXYZW(i * 2, 1, 1, 1, alpha);
          colors.setXYZW(i * 2 + 1, 1, 1, 1, alpha);
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
        positions.needsUpdate = colors.needsUpdate = geometry.index.needsUpdate = true;
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
