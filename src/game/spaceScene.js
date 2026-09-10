import {
  AmbientLight, BufferGeometry, DirectionalLight, Float32BufferAttribute,
  Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, RepeatWrapping,
  Points, PointsMaterial, Quaternion, Scene, SphereGeometry, SRGBColorSpace,
  TextureLoader, Vector3,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SPACE_CONSTANTS, MOON_ORBIT_NORMAL, inertialToECEF } from './spacePhysics.js';

// Distant bodies use millions of metres per render unit. The ship, terrain and
// nearby lunar surface retain metre units in the original scene.
export const SPACE_RENDER_SCALE = 1e-6;
const { MOON_RADIUS, EARTH_EQUATORIAL_RADIUS, EARTH_POLAR_RADIUS } = SPACE_CONSTANTS;

export class SpaceScene {
  constructor(mainScene, canvas, { baseUrl = '/', simple = false } = {}) {
    this.canvas = canvas;
    this.scene = new Scene();
    this.camera = new PerspectiveCamera(70, 1, .000001, 20000);
    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enabled = false;
    this.controls.enableDamping = true;
    this.controls.minDistance = 2;
    this.controls.maxDistance = 15000;
    this.overview = false;
    this.ecefOrientation = new Quaternion();
    this.inertialOrientation = new Quaternion();
    this.simulationTime = 0;
    this.moonECEF = new Vector3();
    this.moonOrientation = new Quaternion();
    this.moonWorld = new Vector3();
    this.shipWorld = new Vector3();
    this.patchAnchor = new Vector3(Infinity, Infinity, Infinity);
    this._resources = [];
    const loader = new TextureLoader();
    const earthTexture = loader.load(`${baseUrl}textures/earth-blue-marble-2k.jpg`);
    const moonTexture = loader.load(`${baseUrl}textures/moon-lroc-2k.jpg`);
    moonTexture.wrapS = RepeatWrapping;
    for (const texture of [earthTexture, moonTexture]) { texture.colorSpace = SRGBColorSpace; this._resources.push(texture); }
    const earthGeometry = new SphereGeometry(EARTH_EQUATORIAL_RADIUS * SPACE_RENDER_SCALE, 128, 64);
    earthGeometry.rotateX(Math.PI / 2);
    this.earth = new Mesh(earthGeometry, new MeshStandardMaterial({ map: earthTexture, roughness: 1 }));
    this.earth.scale.z = EARTH_POLAR_RADIUS / EARTH_EQUATORIAL_RADIUS;
    this.earth.name = 'physical-earth';
    const moonGeometry = new SphereGeometry(MOON_RADIUS * SPACE_RENDER_SCALE, 128, 64);
    moonGeometry.rotateX(Math.PI / 2);
    this.moon = new Mesh(moonGeometry, new MeshStandardMaterial({ map: moonTexture, roughness: 1, color: 0xcacaca }));
    this.moon.name = 'physical-moon';
    this.scene.add(this.earth, this.moon, new AmbientLight(0xc8d6ef, .14));
    this.sun = new DirectionalLight(0xffffff, 2.8); this.scene.add(this.sun, this.sun.target);
    this.shipMarker = new Mesh(new SphereGeometry(.5, 12, 8), new MeshBasicMaterial({ color: 0xffc35c }));
    this.shipMarker.name = 'spacecraft-overview-marker'; this.scene.add(this.shipMarker);
    this.sunDisc = new Mesh(new SphereGeometry(4.65, 24, 12), new MeshBasicMaterial({ color: 0xfff2c5, toneMapped: false, depthWrite: false }));
    this.scene.add(this.sunDisc);

    const stars = [], colors = []; let seed = 4720;
    const rand = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    for (let i = 0; i < (simple ? 2500 : 5000); i++) {
      const z = rand() * 2 - 1, a = rand() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      stars.push(Math.cos(a) * r * 9000, Math.sin(a) * r * 9000, z * 9000);
      const c = .3 + rand() * .7; colors.push(c, c, Math.min(1, c + .12));
    }
    const starGeometry = new BufferGeometry();
    starGeometry.setAttribute('position', new Float32BufferAttribute(stars, 3));
    starGeometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
    this.stars = new Points(starGeometry, new PointsMaterial({ size: 1.4, sizeAttenuation: false, vertexColors: true, depthWrite: false, toneMapped: false }));
    this.stars.frustumCulled = false; this.stars.renderOrder = -100; this.scene.add(this.stars);

    this.patch = new Mesh(new BufferGeometry(), new MeshStandardMaterial({ map: moonTexture, roughness: 1, color: 0xcacaca, fog: false }));
    this.patch.name = 'local-lunar-surface'; this.patch.frustumCulled = false; this.patch.visible = false;
    this.patch.userData.noVehicleShadow = true;
    mainScene.add(this.patch);
    this.markerElements = new Map();
    for (const [key, label] of [['earth', 'Earth'], ['moon', 'Moon'], ['ship', 'Rocket']]) {
      const el = document.createElement('span'); el.className = 'space-body-label'; el.textContent = label; el.hidden = true;
      if (key === 'moon') el.style.transform = 'translate(-50%, -32px)';
      document.getElementById('space-labels')?.append(el); this.markerElements.set(key, el);
    }
  }

  setOverview(enabled) {
    this.overview = enabled;
    this.controls.enabled = enabled;
    if (enabled) this.resetOverview = true;
  }

  update({ camera, mapMatrix, moonECEF, sunECEF, altitude, active, observerECEF, siderealAngle = 0 }) {
    const mapOrientation = new Quaternion().setFromRotationMatrix(mapMatrix);
    const spin = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), siderealAngle);
    if (this.overview) {
      // Overview is fixed to the ecliptic; Earth visibly spins under an axis tilted 23.44°.
      this.inertialOrientation.copy(mapOrientation).multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -23.44 * Math.PI / 180));
      this.ecefOrientation.copy(this.inertialOrientation).multiply(spin);
    } else {
      this.ecefOrientation.copy(mapOrientation);
      this.inertialOrientation.copy(mapOrientation).multiply(spin.clone().invert());
    }
    this.moonECEF.copy(moonECEF);
    this.moonWorld.copy(moonECEF).applyQuaternion(this.ecefOrientation).multiplyScalar(SPACE_RENDER_SCALE);
    this.shipWorld.copy(observerECEF).applyQuaternion(this.ecefOrientation).multiplyScalar(SPACE_RENDER_SCALE);
    this.earth.quaternion.copy(this.ecefOrientation);
    // Tidal lock: local +X (the centre of the map) always faces Earth.
    const x = moonECEF.clone().negate().normalize();
    const z = inertialToECEF(MOON_ORBIT_NORMAL, siderealAngle / SPACE_CONSTANTS.EARTH_ANGULAR_SPEED);
    const y = z.clone().cross(x).normalize(); z.crossVectors(x, y).normalize();
    this.moonOrientation.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
    this.moon.position.copy(this.moonWorld);
    this.moon.quaternion.copy(this.ecefOrientation).multiply(this.moonOrientation);
    this.earth.visible = active && (this.overview || altitude > 120000);
    this.moon.visible = active && (this.overview || altitude > 20000);
    this.shipMarker.position.copy(this.shipWorld); this.shipMarker.visible = active && this.overview;
    this.sun.position.copy(sunECEF).applyQuaternion(this.ecefOrientation).multiplyScalar(1000);
    this.sun.target.position.set(0, 0, 0); this.sun.target.updateMatrixWorld();
    this.camera.aspect = camera.aspect; this.camera.fov = camera.fov; this.camera.updateProjectionMatrix();
    if (this.overview) {
      if (this.resetOverview) {
        const centre = this.moonWorld.clone().multiplyScalar(.45);
        this.controls.target.copy(centre);
        const fitDistance = Math.max(440, this.moonWorld.length() * .8 / (Math.tan(this.camera.fov * Math.PI / 360) * Math.min(1, this.camera.aspect)));
        // Start on the illuminated side so both globes can be recognized.
        // The user can orbit freely to inspect the night sides afterwards.
        const viewpoint = sunECEF.clone().applyQuaternion(this.ecefOrientation).add(new Vector3(0, .65, 0)).setLength(fitDistance);
        this.camera.position.copy(centre).add(viewpoint);
        this.camera.up.set(0, 1, 0); this.camera.lookAt(centre);
        this.resetOverview = false;
      }
      this.camera.near = 1; this.camera.far = 20000; this.camera.updateProjectionMatrix();
      const width = this.canvas.clientWidth || 1280, height = this.canvas.clientHeight || 800;
      this.camera.setViewOffset(width, height, width > 700 ? 180 : 0, width <= 700 ? -height * .17 : 0, width, height);
      this.controls.update();
    }
    else {
      this.camera.clearViewOffset();
      this.camera.position.copy(camera.position).multiplyScalar(SPACE_RENDER_SCALE);
      this.camera.quaternion.copy(camera.quaternion); this.camera.up.copy(camera.up);
    }
    this.stars.visible = active && this.overview;
    this.stars.position.copy(this.camera.position);
    this.stars.quaternion.copy(this.inertialOrientation);
    this.sunDisc.visible = active && this.overview;
    this.sunDisc.position.copy(this.sun.position).add(this.camera.position);
    const relative = observerECEF.clone().sub(moonECEF);
    const lunarAltitude = relative.length() - MOON_RADIUS;
    this.patch.visible = active && !this.overview && lunarAltitude < 60000 && lunarAltitude > -1000;
    if (this.patch.visible) this.updatePatch(relative, mapMatrix);
    this.updateLabels(active);
  }

  updatePatch(relative, mapMatrix) {
    const surface = relative.clone().normalize().multiplyScalar(MOON_RADIUS);
    // Rebuild only after appreciable lateral movement, keeping local vertices small.
    const moved = surface.distanceTo(this.patchAnchor) > 800;
    if (moved) {
      this.patchAnchor.copy(surface);
      const up = surface.clone().normalize();
      const right = new Vector3(0, 0, 1).cross(up);
      if (right.lengthSq() < .001) right.set(1, 0, 0).cross(up);
      right.normalize();
      const back = right.clone().cross(up).normalize();
      this.patchBasis = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, back));
      const inverseMoon = this.moonOrientation.clone().invert();
      const anchorBody = surface.clone().applyQuaternion(inverseMoon);
      const anchorU = .5 + Math.atan2(anchorBody.y, anchorBody.x) / (2 * Math.PI);
      const positions = [], normals = [], uvs = [], indices = [], count = 64, size = 60000;
      for (let row = 0; row <= count; row++) for (let col = 0; col <= count; col++) {
        const x = (col / count - .5) * size, z = (row / count - .5) * size;
        const y = Math.sqrt(MOON_RADIUS ** 2 - x * x - z * z) - MOON_RADIUS;
        positions.push(x, y, z);
        const normal = new Vector3(x, y + MOON_RADIUS, z).normalize(); normals.push(...normal.toArray());
        const body = new Vector3(x, y, z).applyQuaternion(this.patchBasis).add(surface).applyQuaternion(inverseMoon).normalize();
        let u = .5 + Math.atan2(body.y, body.x) / (2 * Math.PI);
        u += Math.round(anchorU - u); // unwrap the far-side texture seam
        uvs.push(u, .5 + Math.asin(body.z) / Math.PI);
        if (row < count && col < count) { const a = row * (count + 1) + col, b = a + count + 1; indices.push(a, b, a + 1, b, b + 1, a + 1); }
      }
      // Bury the outer edge in the coarser distant sphere. Near touchdown the
      // edge lies beyond the horizon; higher up, the skirt prevents a gap.
      const edge = [];
      for (let col = 0; col <= count; col++) edge.push(col);
      for (let row = 1; row <= count; row++) edge.push(row * (count + 1) + count);
      for (let col = count - 1; col >= 0; col--) edge.push(count * (count + 1) + col);
      for (let row = count - 1; row > 0; row--) edge.push(row * (count + 1));
      const skirtStart = positions.length / 3;
      for (const a of edge) {
        positions.push(positions[a * 3], positions[a * 3 + 1] - 2000, positions[a * 3 + 2]);
        normals.push(...normals.slice(a * 3, a * 3 + 3)); uvs.push(...uvs.slice(a * 2, a * 2 + 2));
      }
      for (let i = 0; i < edge.length; i++) {
        const j = (i + 1) % edge.length;
        indices.push(edge[i], skirtStart + j, skirtStart + i, edge[i], edge[j], skirtStart + j);
      }
      this.patch.geometry.dispose();
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.setAttribute('normal', new Float32BufferAttribute(normals, 3));
      geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices);
      this.patch.geometry = geometry;
    }
    this.patch.position.copy(this.patchAnchor).add(this.moonECEF).applyMatrix4(mapMatrix);
    this.patch.quaternion.copy(this.ecefOrientation).multiply(this.patchBasis);
  }

  updateLabels(active) {
    this.camera.updateMatrixWorld();
    for (const [key, position] of [['earth', new Vector3()], ['moon', this.moonWorld], ['ship', this.shipWorld]]) {
      const el = this.markerElements.get(key), ndc = position.clone().project(this.camera);
      el.hidden = !active || !this.overview || ndc.z < -1 || ndc.z > 1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1;
      if (!el.hidden) { el.style.left = `${(ndc.x * .5 + .5) * 100}%`; el.style.top = `${(-ndc.y * .5 + .5) * 100}%`; }
    }
  }

  render(renderer, scene, camera) {
    const clear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.overview ? 0x010208 : 0x8ec8e8);
    renderer.clear();
    if (!this.overview) {
      camera.layers.set(1);
      renderer.render(scene, camera);
      camera.layers.set(0);
    }
    if (this.overview) renderer.render(this.scene, this.camera);
    else {
      // Separate body passes avoid sharing a 1 m–400,000 km depth range. Each
      // sphere gets a useful near plane; painter order handles mutual occlusion.
      const bodies = [this.earth, this.moon].filter(body => body.visible)
        .sort((a, b) => b.position.distanceToSquared(this.camera.position) - a.position.distanceToSquared(this.camera.position));
      for (const body of bodies) body.visible = false;
      for (const body of bodies) {
        const distance = body.position.distanceTo(this.camera.position);
        const radius = (body === this.earth ? EARTH_EQUATORIAL_RADIUS : MOON_RADIUS) * SPACE_RENDER_SCALE;
        this.camera.near = Math.max(.000001, (distance - radius) * .5);
        this.camera.far = Math.max(20, distance + radius * 2);
        this.camera.updateProjectionMatrix();
        body.visible = true; renderer.clearDepth(); renderer.render(this.scene, this.camera); body.visible = false;
      }
      for (const body of bodies) body.visible = true;
    }
    if (!this.overview) { renderer.clearDepth(); renderer.render(scene, camera); }
    renderer.autoClear = clear;
  }

  dispose() {
    this.controls.dispose(); this.patch.removeFromParent();
    const resources = new Set(this._resources);
    for (const root of [this.scene, this.patch]) root.traverse(o => { if (o.geometry) resources.add(o.geometry); if (o.material) resources.add(o.material); });
    for (const r of resources) r.dispose();
    for (const el of this.markerElements.values()) el.remove();
  }
}
