import {
  BoxGeometry, CatmullRomCurve3, Color, ConeGeometry, CylinderGeometry, DoubleSide,
  Float32BufferAttribute, Group, LatheGeometry, MathUtils, Mesh, MeshBasicMaterial,
  MeshStandardMaterial, TubeGeometry, Vector2, Vector3,
} from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { PlaneController } from './plane.js';

export const BALLOON_SPEC = Object.freeze({
  create: createBalloon, wingspan: 24, cruise: 6, boost: 14, brake: 0,
  cam: [0, 4, 46], name: 'Red hot-air balloon', flightModel: 'balloon',
  previewVertical: true, collisionRadius: 12, noContrails: true, sound: 'balloon',
  desc: 'Red envelope · wicker basket · heat to climb, cool to descend · wind drift',
});

// Original 24 m balloon: open wicker basket at y=0, envelope above it. All
// dimensions are metres; the normal vehicle loader centres the complete model.
export function createBalloon() {
  const model = new Group(); model.name = 'red-hot-air-balloon';
  const cloth = new MeshStandardMaterial({ name: 'balloon-red-fabric', vertexColors: true, roughness: .88,
    metalness: 0, side: DoubleSide, emissive: 0x9c1606, emissiveIntensity: .025 });
  const wicker = new MeshStandardMaterial({ name: 'balloon-wicker', color: 0xa56a32, roughness: .96 });
  const weave = new MeshStandardMaterial({ name: 'balloon-wicker-weave', color: 0xd3a366, roughness: .95 });
  const leather = new MeshStandardMaterial({ name: 'balloon-leather-rim', color: 0x53321e, roughness: .85 });
  const steel = new MeshStandardMaterial({ name: 'balloon-burner-metal', color: 0x575c62, roughness: .3, metalness: .75 });
  const cable = new MeshStandardMaterial({ name: 'balloon-load-tapes', color: 0x76151e, roughness: .88 });
  const flameMaterial = new MeshBasicMaterial({ color: 0xffa522, transparent: true, opacity: .9, depthWrite: false, toneMapped: false });
  const coreMaterial = new MeshBasicMaterial({ color: 0xfff1ab, toneMapped: false });
  // Keep cloth and wicker matte when applying the shared aircraft finish.
  for (const material of [cloth, wicker, weave, leather, steel, cable]) material.userData.vehicleFinish = true;
  const add = (name, geometry, material, x = 0, y = 0, z = 0) => {
    const mesh = new Mesh(geometry, material); mesh.name = name; mesh.position.set(x, y, z); model.add(mesh); return mesh;
  };
  const combine = (name, geometries, material) => {
    const geometry = mergeGeometries(geometries);
    for (const part of geometries) part.dispose();
    return add(name, geometry, material);
  };
  const profile = new CatmullRomCurve3([[1, 4], [2.5, 6.8], [5.7, 10.5], [8.1, 15], [8.55, 18], [7.25, 21], [4.4, 23], [.08, 24]]
    .map(([r, y]) => new Vector3(r, y, 0)), false, 'centripetal').getPoints(72);
  const geometry = new LatheGeometry(profile.map(p => new Vector2(p.x, p.y)), 144);
  const positions = geometry.attributes.position, colors = [], color = new Color();
  const reds = [0xcc2234, 0xe23240, 0xd12637];
  for (let i = 0; i < positions.count; i++) {
    const angle = Math.atan2(positions.getX(i), positions.getZ(i));
    const gore = (angle + Math.PI * 2) / (Math.PI * 2) * 24;
    const bulge = .986 - .014 * Math.cos(angle * 24);
    positions.setX(i, positions.getX(i) * bulge);
    positions.setZ(i, positions.getZ(i) * bulge);
    color.setHex(reds[Math.floor(gore) % reds.length]);
    color.multiplyScalar(.86 + .14 * Math.sin(Math.PI * (positions.getY(i) - 4) / 20));
    colors.push(color.r, color.g, color.b);
  }
  geometry.setAttribute('color', new Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
  add('red-gored-envelope', geometry, cloth);
  const tapes = [];
  for (let i = 0; i < 24; i++) {
    const angle = i / 24 * Math.PI * 2;
    const curve = new CatmullRomCurve3(profile.map(p => new Vector3(Math.sin(angle) * (p.x * .972 + .022), p.y, Math.cos(angle) * (p.x * .972 + .022))));
    tapes.push(new TubeGeometry(curve, 72, .016, 4, false));
  }
  combine('envelope-load-tapes', tapes, cable);
  add('basket-floor', new BoxGeometry(2.1, .16, 1.65), wicker, 0, .08);
  const walls = [], strands = [], rim = [];
  for (const side of [-1, 1]) {
    walls.push(new BoxGeometry(2.1, 1.05, .12).translate(0, .64, side * .78));
    walls.push(new BoxGeometry(.12, 1.05, 1.56).translate(side * .99, .64, 0));
    rim.push(new BoxGeometry(2.18, .16, .18).translate(0, 1.2, side * .78));
    rim.push(new BoxGeometry(.18, .16, 1.72).translate(side * .99, 1.2, 0));
    for (let row = 0; row < 14; row++) {
      const y = .18 + row * .073;
      strands.push(new BoxGeometry(2.08, .025, .02).translate(0, y, side * .849));
      strands.push(new BoxGeometry(.02, .025, 1.6).translate(side * 1.06, y, 0));
    }
    for (let col = 0; col < 23; col++) strands.push(new BoxGeometry(.025, .99, .026).translate(-.97 + col * .088, .65, side * .846));
    for (let col = 0; col < 18; col++) strands.push(new BoxGeometry(.026, .99, .025).translate(side * 1.057, .65, -.75 + col * .088));
  }
  combine('open-wicker-basket', walls, wicker);
  combine('basket-woven-strands', strands, weave);
  combine('padded-basket-rim', rim, leather);
  const struts = [], ropes = [];
  for (const x of [-.88, .88]) for (const z of [-.67, .67]) {
    struts.push(new CylinderGeometry(.035, .035, 1.45, 6).translate(x, 1.92, z));
    const points = [new Vector3(x, 2.65, z), new Vector3(x * .92, 3.3, z * .92), new Vector3(x * .9, 4.15, z * .9)];
    ropes.push(new TubeGeometry(new CatmullRomCurve3(points), 8, .025, 5, false));
  }
  combine('burner-support-frame', struts, steel);
  combine('basket-suspension-cables', ropes, leather);
  const frame = [new BoxGeometry(1.85, .06, .06).translate(0, 2.66, -.67), new BoxGeometry(1.85, .06, .06).translate(0, 2.66, .67),
    new BoxGeometry(.06, .06, 1.4).translate(-.88, 2.66, 0), new BoxGeometry(.06, .06, 1.4).translate(.88, 2.66, 0)];
  combine('burner-top-frame', frame, steel);
  for (const side of [-1, 1]) {
    add('propane-tank', new CylinderGeometry(.22, .22, .72, 16), steel, side * .66, .55, .4);
    add('burner-nozzle', new CylinderGeometry(.2, .14, .26, 16, 1, true), steel, side * .29, 2.64, 0);
  }
  const flames = new Group(); flames.name = 'balloon-burner-flames'; flames.position.y = 2.77; model.add(flames);
  for (const side of [-1, 1]) {
    const outer = new Mesh(new ConeGeometry(.18, 1.6, 12), flameMaterial); outer.position.set(side * .29, .8, 0);
    const core = new Mesh(new ConeGeometry(.075, .8, 10), coreMaterial); core.position.set(side * .29, .4, 0);
    for (const flame of [outer, core]) { flame.userData.noVehicleShadow = true; flame.raycast = () => {}; flames.add(flame); }
  }
  model.userData.balloon = { flames, cloth, elapsed: 0 };
  return model;
}

export function updateBalloon(root, dt = 0, burner = .5) {
  root?.traverse(node => {
    const state = node.userData.balloon;
    if (!state) return;
    state.elapsed += Math.max(0, dt);
    const power = MathUtils.clamp(burner, 0, 1);
    state.flames.visible = power > .02;
    state.flames.scale.set(.7 + power * .3, (.3 + power * .7) * (1 + .09 * Math.sin(state.elapsed * 29)), .7 + power * .3);
    state.cloth.emissiveIntensity = .005 + power * .11;
  });
}

// A deterministic illustrative wind field, not live weather. Wind varies by
// altitude, so changing height changes drift without providing airplane thrust.
export function balloonWind(lat, lon, height) {
  const layer = Math.max(0, height) / 500;
  return { north: 2.4 + 1.5 * Math.sin(layer + lon * 2), east: 4.5 + 1.8 * Math.cos(layer * .8 + lat * 2) };
}

export class BalloonController extends PlaneController {
  constructor(lat, lon, height, heading, spec = BALLOON_SPEC) {
    super(lat, lon, height, heading, spec);
    this.isBalloon = true;
    this.cruiseT = this.throttle = this.heat = .5;
    this.verticalSpeed = 0;
    const wind = balloonWind(this.lat, this.lon, height);
    this.northSpeed = wind.north; this.eastSpeed = wind.east;
    this.speed = Math.hypot(this.northSpeed, this.eastSpeed);
    this.elapsed = 0;
  }

  update(dt, ctrl = {}) {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    // Fixed small substeps make thermal lag and wind integration consistent
    // across desktop/mobile frame rates; dt=0 preserves the entire state.
    const count = Math.max(1, Math.ceil(dt * 120)), step = dt / count;
    for (let i = 0; i < count; i++) this.step(step, ctrl);
  }

  step(dt, ctrl) {
    this.elapsed += dt;
    const blend = rate => 1 - Math.exp(-rate * dt);
    const input = Number.isFinite(ctrl.throttle) ? ctrl.throttle : this.cruiseT;
    const burner = ctrl.pitch > .1 ? 1 : ctrl.pitch < -.1 ? 0 : MathUtils.clamp(input, 0, 1);
    this.throttle += (burner - this.throttle) * blend(4);
    this.heat += (this.throttle - this.heat) * blend(.12);
    const neutralHeat = .5 + Math.max(0, this.height - 2500) / 18000;
    const targetClimb = MathUtils.clamp((this.heat - neutralHeat) * 9, -4.5, 4.5);
    this.verticalSpeed += (targetClimb - this.verticalSpeed) * blend(.45);
    const wind = balloonWind(this.lat, this.lon, this.height);
    this.northSpeed += (wind.north - this.northSpeed) * blend(.35);
    this.eastSpeed += (wind.east - this.eastSpeed) * blend(.35);
    this.heading += (ctrl.roll || 0) * .3 * dt;
    this.pitch = Math.sin(this.elapsed * .55) * .009;
    this.roll = Math.sin(this.elapsed * .43) * .012;
    this.lat = MathUtils.clamp(this.lat + this.northSpeed * dt / 6378137, -Math.PI / 2 + 1e-6, Math.PI / 2 - 1e-6);
    this.lon += this.eastSpeed * dt / (6378137 * Math.max(1e-6, Math.cos(this.lat)));
    this.lon = ((this.lon + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    this.height += this.verticalSpeed * dt;
    this.speed = Math.hypot(this.northSpeed, this.eastSpeed);
  }
}
