import { BoxGeometry, CanvasTexture, Group, Mesh, MeshBasicMaterial, MeshStandardMaterial, Matrix4, PlaneGeometry, Vector3 } from 'three';
import { CAMERA_FRAME, WGS84_ELLIPSOID } from '3d-tiles-renderer';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const DEG = Math.PI / 180;

class RunwayFrame {
  constructor() {
    this.frame = new Matrix4();
    this.inverse = new Matrix4();
    this.local = new Vector3();
    this.cartographic = {};
  }
  coordinates(pose, target = new Vector3()) {
    return WGS84_ELLIPSOID.getCartographicToPosition(pose.lat, pose.lon, pose.height, target).applyMatrix4(this.inverse);
  }
  pose(x, along, y = 0) {
    this.local.set(x, y, -along).applyMatrix4(this.frame);
    WGS84_ELLIPSOID.getPositionToCartographic(this.local, this.cartographic);
    return { lat: this.cartographic.lat, lon: this.cartographic.lon, height: this.cartographic.height };
  }
  contains(point, { landing = false, margin = 0 } = {}) {
    const d = this.definition, along = -point.z;
    return Math.abs(point.x) <= d.width / 2 - margin && along >= (landing ? d.threshold : 0) + margin && along <= d.length - margin;
  }
  get groundPitch() { return this.physical.slope * (this.physical === this ? 1 : -1); }
}

class ReverseRunway extends RunwayFrame {
  constructor(physical) {
    super();
    this.physical = physical;
    this.definition = directionDefinition(physical.data, 1);
    this.rebuildFrame();
  }
  get elevation() { return this.physical.elevation; }
  set elevation(value) { this.physical.elevation = value; }
  get calibrated() { return this.physical.calibrated; }
  calibrate(probe) { return this.physical.calibrate(probe); }
  rebuildFrame() {
    this.frame.copy(this.physical.frame).multiply(new Matrix4().makeTranslation(0, 0, -this.definition.length)).multiply(new Matrix4().makeRotationY(Math.PI));
    this.inverse.copy(this.frame).invert();
  }
}

function directionDefinition(data, end) {
  const d = data.ends[end];
  return { ...data, id: `${data.id}:${d.ident}`, ident: d.ident, threshold: d.threshold,
    heading: (data.heading + end * 180) % 360,
    name: `${data.airportName} · ${data.airportId} RWY ${d.ident}`,
    aimingPoint: Math.min(300, (data.length - d.threshold) * .2) };
}

/** One physical pavement, two directional frames sharing exactly the same surface. */
export class Runway extends RunwayFrame {
  constructor(data) {
    super();
    this.data = data;
    this.physical = this;
    this.definition = directionDefinition(data, 0);
    this.elevation = data.elevation;
    this.slope = 0;
    this.calibrated = false;
    this.rebuildFrame();
    this.opposite = new ReverseRunway(this);
    this.directions = [this, this.opposite];
  }
  rebuildFrame() {
    const d = this.data;
    WGS84_ELLIPSOID.getObjectFrame(d.lat * DEG, d.lon * DEG, this.elevation, d.heading * DEG, this.slope, 0, this.frame, CAMERA_FRAME);
    this.inverse.copy(this.frame).invert();
    this.opposite?.rebuildFrame();
  }
  calibrate(probe) {
    if (this.calibrated) return false;
    const length = this.data.length;
    const samples = [30, length / 2, length - 30].map(along => {
      const p = this.pose(0, along);
      const h = probe(p.lat, p.lon, Math.max(3000, this.elevation + 1000));
      // Reject missing / coarse sea-level tiles using the airport's published elevation.
      return Number.isFinite(h) && Math.abs(h - this.data.elevation) < 70 ? { along, height: h - (p.height - this.elevation) } : null;
    });
    if (samples.some(p => !p)) return false;
    const slope = (samples[2].height - samples[0].height) / (length - 60);
    if (Math.abs(slope) > .04) return false;
    this.elevation = Math.max(...samples.map(p => p.height - slope * p.along)) + .35;
    this.slope = Math.atan(slope);
    this.calibrated = true;
    this.rebuildFrame();
    return true;
  }
}

export function createRunwayVisual(scene, runway, mapRoot) {
  const root = new Group();
  root.name = runway.data.id;
  root.matrixAutoUpdate = false;
  scene.add(root);
  const asphalt = new MeshStandardMaterial({ color: 0x3b4144, roughness: .96 });
  const white = new MeshBasicMaterial({ color: 0xf5f0dc });
  const green = new MeshBasicMaterial({ color: 0x72ff9a });
  const red = new MeshBasicMaterial({ color: 0xff3b28 });
  const light = new MeshBasicMaterial({ color: 0xffebae });
  const textures = [], materials = [asphalt, white, green, red, light];
  const d = runway.data;
  function rectangle(x, along, width, length, material = white, y = .025, reverse = false) {
    const mesh = new Mesh(new PlaneGeometry(width, length), material);
    mesh.rotation.x = -Math.PI / 2;
    if (reverse) mesh.rotation.z = Math.PI;
    mesh.position.set(reverse ? -x : x, y, reverse ? -d.length + along : -along);
    root.add(mesh);
  }
  rectangle(0, d.length / 2, d.width, d.length, asphalt, 0);
  for (const side of [-1, 1]) rectangle(side * (d.width / 2 - .5), d.length / 2, .3, d.length);
  const scale = Math.min(1, d.width / 45, d.length / 1500);
  const stripeLength = 30 * scale, thresholdInset = 8 + stripeLength / 2;
  for (let along = d.ends[0].threshold + 130 * scale; along < d.length - d.ends[1].threshold - 130 * scale; along += 70 * scale) {
    rectangle(0, along, Math.max(.3, .7 * scale), 25 * scale);
  }
  for (let end = 0; end < 2; end++) {
    const threshold = d.ends[end].threshold, reverse = end === 1;
    const count = Math.max(2, Math.floor(d.width / 10));
    for (const side of [-1, 1]) {
      for (let i = 0; i < count; i++) rectangle(side * (d.width * .08 + i * d.width * .36 / count), threshold + thresholdInset, Math.max(.5, d.width * .025), stripeLength, white, .025, reverse);
      rectangle(side * d.width * .21, threshold + runway.directions[end].definition.aimingPoint, d.width * .09, 35 * scale, white, .025, reverse);
    }
    if (d.lighted) for (let x = -d.width / 2 + 2; x < d.width / 2; x += 3) {
      rectangle(x, threshold, .8, .8, green, .05, reverse);
      rectangle(x, d.length - 2, .8, .8, red, .05, reverse);
    }
    const canvas = document.createElement('canvas'); canvas.width = 256; canvas.height = 256;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f5f0dc'; ctx.font = 'bold 130px monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(d.ends[end].ident, 128, 128);
    const texture = new CanvasTexture(canvas); textures.push(texture);
    const material = new MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }); materials.push(material);
    rectangle(0, threshold + 80 * scale, Math.min(16, d.width * .45), 24 * scale, material, .04, reverse);
  }
  if (d.lighted) for (const side of [-1, 1]) for (let along = 0; along <= d.length; along += 60) {
    const bulb = new Mesh(new BoxGeometry(.5, .22, .5), light);
    bulb.position.set(side * (d.width / 2 + .3), .15, -along); root.add(bulb);
  }
  root.updateMatrixWorld(true);
  for (const material of materials) {
    const parts = root.children.filter(o => o.material === material);
    const geometries = parts.map(o => { const g = o.geometry.toNonIndexed(); g.applyMatrix4(o.matrix); return g; });
    if (!geometries.length) continue;
    root.add(new Mesh(mergeGeometries(geometries), material));
    for (const o of parts) { o.removeFromParent(); o.geometry.dispose(); }
    for (const g of geometries) g.dispose();
  }
  root.traverse(o => { if (o.isMesh) { o.receiveShadow = true; o.userData.runway = true; } });
  return {
    root,
    update() { root.matrix.multiplyMatrices(mapRoot.matrixWorld, runway.frame); root.updateMatrixWorld(true); },
    dispose() {
      root.removeFromParent();
      root.traverse(o => o.geometry?.dispose());
      for (const resource of [...materials, ...textures]) resource.dispose();
    },
  };
}
