import {
  AdditiveBlending,
  Box3,
  BufferGeometry,
  Color,
  DataTexture,
  DynamicDrawUsage,
  Float32BufferAttribute,
  Group,
  LinearFilter,
  Points,
  PointsMaterial,
  Vector3,
} from "three";

const IGNITION_KMH = 5000;

function glowTexture() {
  const size = 32;
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const radius = Math.hypot((x + 0.5) / size * 2 - 1, (y + 0.5) / size * 2 - 1);
      const i = (y * size + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = 255;
      data[i + 3] = Math.round(Math.max(0, 1 - radius) ** 2 * 255);
    }
  }
  const texture = new DataTexture(data, size, size);
  texture.magFilter = texture.minFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

// Attach to a centered model, including a stage already placed on Earth.
// Flight points toward -Z, so the engine plume extends along local +Z.
export function attachRocketExhaust(root, { axis = "z", ignitionKmh = IGNITION_KMH } = {}) {
  if (root.userData.rocketExhaust) return;
  root.updateWorldMatrix(true, true);
  const inverse = root.matrixWorld.clone().invert(), box = new Box3();
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    mesh.geometry.computeBoundingBox();
    box.union(mesh.geometry.boundingBox.clone().applyMatrix4(inverse.clone().multiply(mesh.matrixWorld)));
  });
  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const bodyLength = size[axis];
  const nozzleRadius = Math.min(size.x, axis === "y" ? size.z : size.y) * (axis === "y" ? .3 : .12);
  const group = new Group();
  group.name = "rocket-exhaust";
  group.position.set(center.x, center.y, box.max.z - bodyLength * 0.025);
  if (axis === "y") {
    group.position.set(center.x, box.min.y + .15, center.z);
    group.rotation.x = Math.PI / 2;
  }
  group.visible = false;
  root.add(group);

  const texture = glowTexture();
  const hot = new Color(0xfff1b0);
  const warm = new Color(0xff8a16);
  const ember = new Color(0xe52d06);
  const color = new Color();
  const layers = [
    { count: 96, length: 1, width: 1, size: nozzleRadius * 2.2, core: false },
    { count: 40, length: 0.42, width: 0.48, size: nozzleRadius * 1.6, core: true },
  ].map((layer) => {
    const geometry = new BufferGeometry();
    const positions = new Float32BufferAttribute(new Float32Array(layer.count * 3), 3);
    const colors = new Float32BufferAttribute(new Float32Array(layer.count * 3), 3);
    positions.setUsage(DynamicDrawUsage);
    colors.setUsage(DynamicDrawUsage);
    geometry.setAttribute("position", positions);
    geometry.setAttribute("color", colors);
    const material = new PointsMaterial({
      map: texture,
      size: layer.size,
      vertexColors: true,
      transparent: true,
      opacity: layer.core ? 0.26 : 0.4,
      blending: AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    });
    const points = new Points(geometry, material);
    points.frustumCulled = false;
    group.add(points);
    return {
      ...layer,
      geometry,
      material,
      positions,
      colors,
      seeds: Array.from({ length: layer.count }, (_, i) => ({
        phase: i / layer.count,
        angle: Math.random() * Math.PI * 2,
        radius: Math.sqrt(Math.random()),
        rate: 1.2 + Math.random() * 0.8,
      })),
    };
  });

  let time = 0;
  root.userData.rocketExhaust = {
    update(dt, kmh, active) {
      group.visible = active && Number.isFinite(kmh) && kmh > ignitionKmh;
      if (!group.visible) return;
      time += dt;
      const power = Math.min(1, (kmh - ignitionKmh) / 15000);
      const flicker = 1 + Math.sin(time * 43) * 0.045 + Math.sin(time * 71) * 0.025;
      const length = bodyLength * (0.4 + power * 0.35) * flicker;
      for (const layer of layers) {
        layer.material.size = layer.size * (1 + power * 0.25) * flicker;
        for (let i = 0; i < layer.count; i++) {
          const seed = layer.seeds[i];
          const t = (seed.phase + time * seed.rate) % 1;
          const radius = nozzleRadius * layer.width * seed.radius *
            (0.65 + Math.sin(t * Math.PI) * 0.45) * (1 - t * 0.6);
          const angle = seed.angle + time * 3;
          layer.positions.setXYZ(i,
            Math.cos(angle) * radius + Math.sin(t * 12 - time * 20) * t * nozzleRadius * 0.2,
            Math.sin(angle) * radius,
            t * length * layer.length,
          );
          if (layer.core) color.copy(hot).lerp(warm, t);
          else color.copy(warm).lerp(ember, t);
          color.multiplyScalar((1 - t) ** 1.2 * (layer.core ? 1.4 : 0.9));
          layer.colors.setXYZ(i, color.r, color.g, color.b);
        }
        layer.positions.needsUpdate = true;
        layer.colors.needsUpdate = true;
      }
    },
    dispose() {
      group.removeFromParent();
      for (const layer of layers) {
        layer.geometry.dispose();
        layer.material.dispose();
      }
      texture.dispose();
      delete root.userData.rocketExhaust;
    },
  };
}

export function updateRocketExhaust(root, dt, kmh, active = true) {
  root?.userData.rocketExhaust?.update(dt, kmh, active);
}

export function disposeRocketExhaust(root) {
  root?.userData.rocketExhaust?.dispose();
}
