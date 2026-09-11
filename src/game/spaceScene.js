import {
  AmbientLight, BufferGeometry, DirectionalLight, Float32BufferAttribute,
  Matrix4, Mesh, MeshBasicMaterial, MeshStandardMaterial, PerspectiveCamera, RepeatWrapping,
  Group, LineLoop, LineBasicMaterial, Quaternion, Scene, SphereGeometry, SRGBColorSpace,
  TextureLoader, Vector3,
} from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { SPACE_CONSTANTS, MOON_ORBIT_NORMAL, inertialToECEF } from './spacePhysics.js';
import { SOLAR_BODIES, SOLAR_BODY_BY_ID, bodyPositionInertial, heliocentricPosition } from './solarSystem.js';
import { createPlanetVisual } from './planetVisuals.js';
import { createStarfield } from './starfield.js';
import { lunarTerrainHeight } from './lunarTerrain.js';

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
    this.controls.maxDistance = 2e7;
    this.overview = false;
    this.overviewMode = "earth-moon";
    this.focusBodyId = "moon";
    this.simple = simple;
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
    this.bodies = new Map([['earth', this.earth], ['moon', this.moon]]);
    for (const body of SOLAR_BODIES) {
      if (this.bodies.has(body.id)) continue;
      const mesh = createPlanetVisual(body, SPACE_RENDER_SCALE);
      this.bodies.set(body.id, mesh); this.scene.add(mesh);
    }
    for (const [id, mesh] of this.bodies) { mesh.userData.body = SOLAR_BODY_BY_ID[id]; mesh.userData.radius = SOLAR_BODY_BY_ID[id].radius * SPACE_RENDER_SCALE; }
    this.sunDisc = this.bodies.get('sun');
    this.orbits = new Group(); this.orbits.name = 'solar-orbit-paths'; this.scene.add(this.orbits);
    for (const body of SOLAR_BODIES.filter(b => b.au)) {
      const vertices = [];
      for (let i = 0; i < 256; i++) vertices.push(...heliocentricPosition(body, body.days * 86400 * i / 256).multiplyScalar(SPACE_RENDER_SCALE).toArray());
      const geometry = new BufferGeometry(); geometry.setAttribute('position', new Float32BufferAttribute(vertices, 3));
      this.orbits.add(new LineLoop(geometry, new LineBasicMaterial({ color: body.color, transparent: true, opacity: .24, depthWrite: false })));
    }
    this.stars = createStarfield({ count: simple ? 2800 : 6000, radius: 2e7, seed: 4720 });
    this.scene.add(this.stars);

    this.patch = new Mesh(new BufferGeometry(), new MeshStandardMaterial({ map: moonTexture, roughness: 1, color: 0xcacaca, fog: false, vertexColors: true }));
    this.patch.name = 'local-lunar-surface'; this.patch.frustumCulled = false; this.patch.visible = false;
    this.patch.userData.noVehicleShadow = true;
    this.patch.material.onBeforeCompile = shader => {
      shader.vertexShader = 'varying vec3 vRegolith;\n' + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\nvRegolith = position;');
      shader.fragmentShader = 'varying vec3 vRegolith;\n' + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
        float grain = fract(sin(dot(floor(vRegolith * 9.0), vec3(12.9898,78.233,39.425))) * 43758.5453);
        float detail = 1.0 - smoothstep(.015, .3, length(fwidth(vRegolith)));
        diffuseColor.rgb *= mix(1.0, .76 + grain * .36, detail);`);
    };
    this.surfaceLightEnabled = true;
    this.surfaceLight = new DirectionalLight(0xf4f1e7, 1.8);
    this.surfaceLight.name = 'lunar-survey-light'; this.surfaceLight.visible = false;
    mainScene.add(this.patch, this.surfaceLight, this.surfaceLight.target);
    this.markerElements = new Map();
    for (const [key, label] of [...SOLAR_BODIES.map(b => [b.id, b.name]), ['ship', 'Rocket']]) {
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

  setOverviewMode(mode, bodyId = this.focusBodyId) {
    if (!['earth-moon', 'solar', 'body'].includes(mode)) return;
    this.overviewMode = mode;
    if (SOLAR_BODY_BY_ID[bodyId]) this.focusBodyId = bodyId;
    this.resetOverview = true;
  }

  update({ camera, mapMatrix, moonECEF, sunECEF, altitude, active, observerECEF, siderealAngle = 0, moonSiderealAngle = siderealAngle, elapsedSeconds = 0 }) {
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
    this.simulationTime = moonSiderealAngle / SPACE_CONSTANTS.EARTH_ANGULAR_SPEED;
    this.moonECEF.copy(moonECEF);
    this.moonWorld.copy(moonECEF).applyQuaternion(this.ecefOrientation).multiplyScalar(SPACE_RENDER_SCALE);
    this.shipWorld.copy(observerECEF).applyQuaternion(this.ecefOrientation).multiplyScalar(SPACE_RENDER_SCALE);
    this.earth.quaternion.copy(this.ecefOrientation);
    // Tidal lock: local +X (the centre of the map) always faces Earth.
    const x = moonECEF.clone().negate().normalize();
    const z = inertialToECEF(MOON_ORBIT_NORMAL, moonSiderealAngle / SPACE_CONSTANTS.EARTH_ANGULAR_SPEED);
    const y = z.clone().cross(x).normalize(); z.crossVectors(x, y).normalize();
    this.moonOrientation.setFromRotationMatrix(new Matrix4().makeBasis(x, y, z));
    this.moon.position.copy(this.moonWorld);
    this.moon.quaternion.copy(this.ecefOrientation).multiply(this.moonOrientation);
    for (const [id, mesh] of this.bodies) {
      if (id !== 'earth' && id !== 'moon') {
        mesh.position.copy(inertialToECEF(bodyPositionInertial(id, this.simulationTime), this.simulationTime)).applyQuaternion(this.ecefOrientation).multiplyScalar(SPACE_RENDER_SCALE);
        mesh.quaternion.copy(this.ecefOrientation)
          .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -moonSiderealAngle))
          .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), (mesh.userData.body.tilt ?? 0) * Math.PI / 180));
      }
      mesh.visible = active && (this.overview || altitude > 20000);
      mesh.scale.set(1, 1, id === 'earth' ? EARTH_POLAR_RADIUS / EARTH_EQUATORIAL_RADIUS : 1);
    }
    this.orbits.visible = active && this.overview && this.overviewMode === 'solar';
    this.orbits.position.copy(this.sunDisc.position);
    this.orbits.quaternion.copy(this.ecefOrientation).multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), -moonSiderealAngle));
    this.sunDisc.visible = active && (this.overview || observerECEF.length() > SPACE_CONSTANTS.MOON_DISTANCE * 2);
    this.earth.visible = active && (this.overview || altitude > 120000);
    this.moon.visible = active && (this.overview || altitude > 20000);
    this.shipMarker.position.copy(this.shipWorld); this.shipMarker.visible = active && this.overview;
    this.sun.position.copy(sunECEF).applyQuaternion(this.ecefOrientation).multiplyScalar(1000);
    this.sun.target.position.set(0, 0, 0); this.sun.target.updateMatrixWorld();
    this.earthSunPosition = this.sun.position.clone();
    if (this.overview && this.overviewMode === 'body' && !['earth', 'moon'].includes(this.focusBodyId)) {
      this.sun.position.copy(this.sunDisc.position); this.sun.target.position.copy(this.bodies.get(this.focusBodyId).position); this.sun.target.updateMatrixWorld();
    }
    this.camera.aspect = camera.aspect; this.camera.fov = camera.fov; this.camera.updateProjectionMatrix();
    if (this.overview) {
      if (this.resetOverview) {
        const focus = this.bodies.get(this.focusBodyId);
        const mode = this.overviewMode;
        const centre = mode === 'solar' ? this.sunDisc.position.clone() : mode === 'body' ? focus.position.clone() : this.moonWorld.clone().multiplyScalar(.45);
        this.controls.target.copy(centre);
        const extent = mode === 'solar' ? 5.2e6 : mode === 'body' ? focus.userData.radius * 3.8 : 440;
        const fitDistance = extent / (Math.tan(this.camera.fov * Math.PI / 360) * Math.min(1, this.camera.aspect));
        const lightDirection = mode === 'earth-moon' ? sunECEF.clone().applyQuaternion(this.ecefOrientation) : this.sunDisc.position.clone().sub(centre).normalize();
        if (lightDirection.lengthSq() < .1) lightDirection.set(0, 1, 1);
        let viewpoint = lightDirection.add(new Vector3(.12, .65, .18));
        this.camera.up.set(0, 1, 0);
        if (mode === 'solar') {
          const tilt = SPACE_CONSTANTS.EARTH_AXIAL_TILT;
          viewpoint = new Vector3(.18, -Math.sin(tilt), Math.cos(tilt)).applyQuaternion(this.orbits.quaternion);
          this.camera.up.set(0, Math.cos(tilt), Math.sin(tilt)).applyQuaternion(this.orbits.quaternion);
        }
        this.camera.position.copy(centre).add(viewpoint.setLength(fitDistance)); this.camera.lookAt(centre);
        this.previousFocus = centre.clone();
        this.resetOverview = false;
      }
      if (this.overviewMode === 'body') {
        const current = this.bodies.get(this.focusBodyId).position;
        if (this.previousFocus) {
          const delta = current.clone().sub(this.previousFocus);
          this.camera.position.add(delta); this.controls.target.add(delta);
        }
        this.previousFocus = current.clone();
      }
      this.camera.near = Math.max(.00001, this.camera.position.distanceTo(this.controls.target) * .00001); this.camera.far = 4e7; this.camera.updateProjectionMatrix();
      const width = this.canvas.clientWidth || 1280, height = this.canvas.clientHeight || 800;
      this.camera.setViewOffset(width, height, width > 700 ? 180 : 0, width <= 700 ? -height * .17 : 0, width, height);
      this.controls.update();
      const pixelsToWorld = this.camera.position.distanceTo(this.controls.target) * Math.tan(this.camera.fov * Math.PI / 360) * 2 / height;
      this.shipMarker.scale.setScalar(Math.max(.04, pixelsToWorld * 3));
      if (this.overviewMode === 'solar') for (const [id, mesh] of this.bodies) {
        mesh.scale.multiplyScalar(Math.max(1, pixelsToWorld * (id === 'sun' ? 9 : 4) / mesh.userData.radius));
      }
    }
    else {
      this.camera.clearViewOffset();
      this.camera.position.copy(camera.position).multiplyScalar(SPACE_RENDER_SCALE);
      this.camera.quaternion.copy(camera.quaternion); this.camera.up.copy(camera.up);
    }
    this.stars.userData.update(elapsedSeconds, active && this.overview ? 1 : 0);
    this.stars.position.copy(this.camera.position);
    this.stars.quaternion.copy(this.inertialOrientation);

    const relative = observerECEF.clone().sub(moonECEF);
    const lunarAltitude = relative.length() - MOON_RADIUS;
    this.patch.visible = active && !this.overview && lunarAltitude < 60000 && lunarAltitude > -1000;
    if (this.patch.visible) this.updatePatch(relative, mapMatrix);
    this.surfaceLight.visible = this.patch.visible && this.surfaceLightEnabled;
    if (this.surfaceLight.visible) {
      this.surfaceLight.position.set(-600, 450, 250).applyQuaternion(this.patch.quaternion).add(this.patch.position);
      this.surfaceLight.target.position.copy(this.patch.position); this.surfaceLight.target.updateMatrixWorld();
    }
    this.updateLabels(active);
  }

  updatePatch(relative, mapMatrix) {
    const inverseMoon = this.moonOrientation.clone().invert();
    const surface = relative.clone().applyQuaternion(inverseMoon).normalize().multiplyScalar(MOON_RADIUS);
    const altitude = relative.length() - MOON_RADIUS;
    // Body-fixed anchors move with the tidally locked Moon even during time warp.
    const moved = surface.distanceTo(this.patchAnchor) > (altitude < 2000 ? 24 : 500);
    if (moved) {
      this.patchAnchor.copy(surface);
      const up = surface.clone().normalize();
      const right = new Vector3(0, 0, 1).cross(up);
      if (right.lengthSq() < .001) right.set(1, 0, 0).cross(up);
      right.normalize();
      const back = right.clone().cross(up).normalize();
      this.patchBasis = new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(right, up, back));
      const inverseBasis = this.patchBasis.clone().invert();
      const anchorU = .5 + Math.atan2(surface.y, surface.x) / (2 * Math.PI);
      const positions = [], colors = [], uvs = [], indices = [], count = this.simple ? 128 : 192, size = 60000;
      // Nonuniform spacing resolves the landing area below one metre while
      // extending the same continuous mesh 30 km towards the horizon.
      const coordinate = i => {
        const t = i / count * 2 - 1, a = Math.abs(t), inner = 2 / 3;
        return Math.sign(t) * (a <= inner ? 24 * (a / inner) + 1176 * (a / inner) ** 3 : 1200 + (size / 2 - 1200) * ((a - inner) / (1 - inner)) ** 2);
      };
      const body = new Vector3(), local = new Vector3();
      for (let row = 0; row <= count; row++) for (let col = 0; col <= count; col++) {
        const x = coordinate(col), z = coordinate(row);
        const y = Math.sqrt(MOON_RADIUS ** 2 - x * x - z * z) - MOON_RADIUS;
        body.set(x, y, z).applyQuaternion(this.patchBasis).add(surface).normalize();
        const height = lunarTerrainHeight(body);
        local.copy(body).multiplyScalar(MOON_RADIUS + height).sub(surface).applyQuaternion(inverseBasis);
        positions.push(local.x, local.y, local.z);
        const shade = .86 + .10 * Math.sin(height * .024) + .035 * Math.sin(body.y * MOON_RADIUS / 33) * Math.sin(body.z * MOON_RADIUS / 29);
        colors.push(shade, shade, shade);
        let u = .5 + Math.atan2(body.y, body.x) / (2 * Math.PI);
        u += Math.round(anchorU - u);
        uvs.push(u, .5 + Math.asin(body.z) / Math.PI);
        if (row < count && col < count) { const a = row * (count + 1) + col, b = a + count + 1; indices.push(a, b, a + 1, b, b + 1, a + 1); }
      }
      const edge = [];
      for (let col = 0; col <= count; col++) edge.push(col);
      for (let row = 1; row <= count; row++) edge.push(row * (count + 1) + count);
      for (let col = count - 1; col >= 0; col--) edge.push(count * (count + 1) + col);
      for (let row = count - 1; row > 0; row--) edge.push(row * (count + 1));
      const skirtStart = positions.length / 3;
      for (const a of edge) {
        positions.push(positions[a * 3], positions[a * 3 + 1] - 2000, positions[a * 3 + 2]);
        colors.push(...colors.slice(a * 3, a * 3 + 3)); uvs.push(...uvs.slice(a * 2, a * 2 + 2));
      }
      for (let i = 0; i < edge.length; i++) {
        const j = (i + 1) % edge.length;
        indices.push(edge[i], skirtStart + j, skirtStart + i, edge[i], edge[j], skirtStart + j);
      }
      this.patch.geometry.dispose();
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
      geometry.setAttribute('color', new Float32BufferAttribute(colors, 3));
      geometry.setAttribute('uv', new Float32BufferAttribute(uvs, 2)); geometry.setIndex(indices); geometry.computeVertexNormals();
      geometry.userData.gridCount = count;
      this.patch.geometry = geometry;
    }
    this.patch.position.copy(this.patchAnchor).applyQuaternion(this.moonOrientation).add(this.moonECEF).applyMatrix4(mapMatrix);
    this.patch.quaternion.copy(this.ecefOrientation).multiply(this.moonOrientation).multiply(this.patchBasis);
  }

  updateLabels(active) {
    this.camera.updateMatrixWorld();
    const placed = [], width = this.canvas.clientWidth || 1280, height = this.canvas.clientHeight || 800;
    for (const [key, position] of [...Array.from(this.bodies, ([id, mesh]) => [id, mesh.position]), ['ship', this.shipWorld]]) {
      const el = this.markerElements.get(key), ndc = position.clone().project(this.camera);
      const bodyVisible = key === 'ship' || this.bodies.get(key)?.visible;
      const relevant = this.overviewMode === 'solar' ? key !== 'moon' : this.overviewMode === 'body' ? key === this.focusBodyId || key === 'ship' : ['earth', 'moon', 'ship'].includes(key);
      el.hidden = !bodyVisible || !relevant || !active || !this.overview || ndc.z < -1 || ndc.z > 1 || Math.abs(ndc.x) > 1 || Math.abs(ndc.y) > 1;
      if (!el.hidden) {
        let x = (ndc.x * .5 + .5) * width, y = (-ndc.y * .5 + .5) * height + 16;
        const initialY = y;
        if (this.overviewMode === 'solar') {
          let attempt = 0;
          while (placed.some(p => Math.abs(p.x - x) < 78 && Math.abs(p.y - y) < 22) && attempt++ < 16) y += 23;
          x = Math.max(45, Math.min(width - 45, x)); y = Math.min(height - 30, y);
        }
        el.style.setProperty?.("--leader-length", `${Math.max(0, y - initialY)}px`);
        placed.push({x, y});
        el.style.transform = 'translate(-50%, 0)'; el.style.left = `${x}px`; el.style.top = `${y}px`;
      }
    }
  }

  render(renderer, scene, camera) {
    const clear = renderer.autoClear;
    renderer.autoClear = false;
    renderer.setClearColor(this.overview ? 0x010208 : scene.fog?.color ?? 0x8ec8e8);
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
      const bodies = Array.from(this.bodies.values()).filter(body => body.visible)
        .sort((a, b) => b.position.distanceToSquared(this.camera.position) - a.position.distanceToSquared(this.camera.position));
      for (const body of bodies) body.visible = false;
      for (const body of bodies) {
        const distance = body.position.distanceTo(this.camera.position);
        const radius = body.userData.radius * (body.userData.body.rings?.[1] ?? 1);
        this.camera.near = Math.max(.000001, (distance - radius) * .5);
        this.camera.far = Math.max(20, distance + radius * 2);
        this.camera.updateProjectionMatrix();
        if (body === this.earth || body === this.moon) {
          this.sun.position.copy(this.earthSunPosition); this.sun.target.position.set(0, 0, 0); this.sun.target.updateMatrixWorld();
        } else {
          this.sun.position.copy(this.sunDisc.position); this.sun.target.position.copy(body.position); this.sun.target.updateMatrixWorld();
        }
        body.visible = true; renderer.clearDepth(); renderer.render(this.scene, this.camera); body.visible = false;
      }
      for (const body of bodies) body.visible = true;
    }
    if (!this.overview) { renderer.clearDepth(); renderer.render(scene, camera); }
    renderer.autoClear = clear;
  }

  dispose() {
    this.controls.dispose(); this.patch.removeFromParent(); this.surfaceLight.removeFromParent(); this.surfaceLight.target.removeFromParent(); this.surfaceLight.dispose();
    const resources = new Set(this._resources);
    for (const root of [this.scene, this.patch]) root.traverse(o => { if (o.geometry) resources.add(o.geometry); if (o.material) { resources.add(o.material); for (const v of Object.values(o.material)) if (v?.isTexture) resources.add(v); } });
    for (const r of resources) r.dispose();
    for (const el of this.markerElements.values()) el.remove();
  }
}
