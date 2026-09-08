import {
  Color,
  DepthTexture,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  OrthographicCamera,
  Raycaster,
  Scene,
  ShaderMaterial,
  UnsignedIntType,
  Vector2,
  Vector3,
  WebGLRenderTarget,
} from "three";

const MAX_HEIGHT = 180;

// Photogrammetry often uses unlit materials. A separate shadow receiver keeps
// its baked lighting intact and projects only nearby vehicles onto the terrain.
export function createVehicleGroundShadows(renderer, { mobile = false } = {}) {
  const size = mobile ? 512 : 1024;
  const target = new WebGLRenderTarget(size, size, { minFilter: NearestFilter, magFilter: NearestFilter });
  target.depthTexture = new DepthTexture(size, size, UnsignedIntType);
  const casters = new Scene();
  const lightCamera = new OrthographicCamera(-60, 60, 60, -60, 1, 1000);
  const vehicles = new Map();
  const receivers = new Set();
  const receiverBySource = new Map();
  const ray = new Raycaster();
  ray.firstHitOnly = true;
  ray.far = MAX_HEIGHT + 1;
  const position = new Vector3();
  const direction = new Vector3();
  const center = new Vector3();
  const heightOffset = new Vector3();
  const savedClear = new Color();
  const uniforms = {
    shadowColor: { value: target.texture },
    shadowDepth: { value: target.depthTexture },
    viewToShadow: { value: new Matrix4() },
    texel: { value: new Vector2(1 / size, 1 / size) },
    softness: { value: 1 },
  };
  const receiverMaterial = new ShaderMaterial({
    uniforms,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    toneMapped: false,
    vertexShader: `
      uniform mat4 viewToShadow;
      varying vec4 shadowPosition;
      void main() {
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        shadowPosition = viewToShadow * viewPosition;
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D shadowColor;
      uniform sampler2D shadowDepth;
      uniform vec2 texel;
      uniform float softness;
      varying vec4 shadowPosition;
      void main() {
        vec3 p = shadowPosition.xyz / shadowPosition.w * 0.5 + 0.5;
        if (p.x < 0.0 || p.x > 1.0 || p.y < 0.0 || p.y > 1.0 || p.z < 0.0 || p.z > 1.0) discard;
        float shade = 0.0;
        for (int y = -1; y <= 1; y++) {
          for (int x = -1; x <= 1; x++) {
            vec2 uv = p.xy + vec2(float(x), float(y)) * texel * softness;
            float depth = texture2D(shadowDepth, uv).x;
            if (p.z > depth + 0.00008) shade += texture2D(shadowColor, uv).r;
          }
        }
        float alpha = shade / 9.0 * 0.48;
        if (alpha < 0.002) discard;
        gl_FragColor = vec4(0.0, 0.0, 0.0, alpha);
      }
    `,
  });

  function addTerrain(root) {
    const meshes = [];
    root.traverse((mesh) => {
      if (mesh.isMesh && !mesh.userData.vehicleShadowReceiver && !receiverBySource.has(mesh)) meshes.push(mesh);
    });
    for (const mesh of meshes) {
      const overlay = new Mesh(mesh.geometry, receiverMaterial);
      overlay.name = "vehicle-ground-shadow";
      overlay.userData.vehicleShadowReceiver = true;
      overlay.raycast = () => {}; // Ground probes must hit the actual tile only.
      overlay.renderOrder = 2;
      overlay.visible = false;
      mesh.receiveShadow = false;
      mesh.add(overlay);
      receivers.add(overlay);
      receiverBySource.set(mesh, overlay);
    }
  }

  function removeTerrain(root) {
    const overlays = [];
    root.traverse((mesh) => {
      if (receiverBySource.has(mesh)) {
        overlays.push(receiverBySource.get(mesh));
        receiverBySource.delete(mesh);
      }
    });
    for (const overlay of overlays) {
      receivers.delete(overlay);
      overlay.removeFromParent();
    }
  }

  function addVehicle(root) {
    if (vehicles.has(root)) return;
    const material = new MeshBasicMaterial({ color: 0xff0000, toneMapped: false });
    const parts = [];
    root.traverse((source) => {
      if (!source.isMesh || !source.castShadow) return;
      const proxy = new Mesh(source.geometry, material);
      proxy.matrixAutoUpdate = false;
      proxy.frustumCulled = false;
      casters.add(proxy);
      parts.push({ source, proxy });
    });
    vehicles.set(root, { parts, material, probeAt: -Infinity, probePos: new Vector3(), ground: null });
  }

  function removeVehicle(root) {
    const entry = vehicles.get(root);
    if (!entry) return;
    for (const { proxy } of entry.parts) proxy.removeFromParent();
    entry.material.dispose();
    vehicles.delete(root);
  }

  let time = 0;
  function update(dt, { terrain, camera, up, sunDirection, active }) {
    time += dt;
    let visible = 0;
    let radius = 60;
    let maxHeight = 0;
    camera.updateMatrixWorld();
    direction.copy(up).normalize().negate();
    for (const [root, entry] of vehicles) {
      for (const { proxy } of entry.parts) proxy.visible = false;
      if (!active || !root.parent || !root.visible || !receivers.size) continue;
      root.updateWorldMatrix(true, true);
      root.getWorldPosition(position);
      if (position.distanceTo(camera.position) > 600) continue;
      if (visible && position.distanceTo(center) > 300) continue;
      if (time - entry.probeAt >= 0.1 || position.distanceToSquared(entry.probePos) > 16 * 16) {
        ray.set(position, direction);
        const hit = ray.intersectObject(terrain, true)[0];
        entry.ground = hit ? hit.point.clone() : null;
        entry.probeAt = time;
        entry.probePos.copy(position);
      }
      if (!entry.ground) continue;
      const height = Math.max(0, heightOffset.copy(position).sub(entry.ground).dot(up));
      if (height >= MAX_HEIGHT) continue;
      const t = Math.max(0, Math.min(1, (height - 20) / (MAX_HEIGHT - 20)));
      const opacity = 1 - t * t * (3 - 2 * t);
      entry.material.color.setRGB(opacity, 0, 0);
      if (!visible) center.copy(position);
      radius = Math.max(radius, position.distanceTo(center) + 35);
      maxHeight = Math.max(maxHeight, height);
      visible++;
      for (const { source, proxy } of entry.parts) {
        let node = source;
        let shown = true;
        while (node && node !== root) { shown &&= node.visible; node = node.parent; }
        proxy.visible = shown && node === root;
        proxy.matrix.copy(source.matrixWorld);
      }
    }
    for (const receiver of receivers) receiver.visible = visible > 0;
    if (!visible) return;

    lightCamera.position.copy(sunDirection).normalize().multiplyScalar(500).add(center);
    lightCamera.up.copy(up);
    lightCamera.lookAt(center);
    lightCamera.left = lightCamera.bottom = -radius;
    lightCamera.right = lightCamera.top = radius;
    lightCamera.updateProjectionMatrix();
    lightCamera.updateMatrixWorld();
    uniforms.viewToShadow.value.copy(lightCamera.projectionMatrix)
      .multiply(lightCamera.matrixWorldInverse).multiply(camera.matrixWorld);
    uniforms.softness.value = 1 + maxHeight * 0.025;

    const oldTarget = renderer.getRenderTarget();
    const oldAlpha = renderer.getClearAlpha();
    renderer.getClearColor(savedClear);
    const oldAutoClear = renderer.autoClear;
    try {
      renderer.autoClear = false;
      renderer.setRenderTarget(target);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(casters, lightCamera);
    } finally {
      renderer.setRenderTarget(oldTarget);
      renderer.setClearColor(savedClear, oldAlpha);
      renderer.autoClear = oldAutoClear;
    }
  }

  return {
    addTerrain, removeTerrain, addVehicle, removeVehicle, update,
    dispose() {
      for (const root of [...vehicles.keys()]) removeVehicle(root);
      for (const overlay of receivers) {
        overlay.removeFromParent();
      }
      receivers.clear();
      receiverBySource.clear();
      receiverMaterial.dispose();
      target.dispose();
    },
  };
}
