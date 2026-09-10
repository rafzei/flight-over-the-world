import { advanceAirMotion } from "./weather.js";
import {
  BoxGeometry, BufferGeometry, CylinderGeometry, Float32BufferAttribute,
  Group, LatheGeometry, MathUtils, Mesh, MeshStandardMaterial, SphereGeometry, Vector2, Vector3,
} from "three";
import { PlaneController } from "./plane.js";

// Original 18 m sailplane: -Z points forward, +Y points up. No powerplant.
export const SAILPLANE_SPEC = Object.freeze({
  create: createSailplane, wingspan: 18, cruise: 28, boost: 75, brake: 19,
  cam: [0, 5, 21], name: "Sailplane", flightModel: "sailplane", sound: "wind",
  desc: "Unpowered glider · 18 m wings · grass landings · Cessna aerotow",
});

// Closed, tapered airfoil built from spanwise sections: x, y, leading edge, chord.
function wingGeometry(sections, side) {
  const vertices = [], indices = [], profile = [[0, 0], [.22, .06], [.7, .035], [1, 0], [.7, -.02], [.22, -.025]];
  for (const [x, y, z, chord] of sections) {
    for (const [along, height] of profile) vertices.push(side * x, y + height * chord, z + along * chord);
  }
  const triangle = (a, b, c) => indices.push(...(side > 0 ? [a, b, c] : [a, c, b]));
  for (let s = 0; s < sections.length - 1; s++) {
    for (let p = 0; p < profile.length; p++) {
      const a = s * 6 + p, b = s * 6 + (p + 1) % 6;
      triangle(a, b, a + 6); triangle(b, b + 6, a + 6);
    }
  }
  for (let p = 1; p < 5; p++) {
    triangle(0, p + 1, p);
    const end = (sections.length - 1) * 6;
    triangle(end, end + p, end + p + 1);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(vertices, 3));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

export function createSailplane() {
  const model = new Group(); model.name = "sailplane";
  const white = new MeshStandardMaterial({ name: "glider-composite", color: 0xf5f3ea, roughness: .3, metalness: .08 });
  const orange = new MeshStandardMaterial({ name: "glider-markings", color: 0xe65f24, roughness: .38 });
  const glass = new MeshStandardMaterial({ name: "glider-glass", color: 0x234c64, roughness: .1, metalness: .25 });
  const rubber = new MeshStandardMaterial({ name: "glider-rubber", color: 0x20252a, roughness: .9 });
  const add = (name, geometry, material, position = [0, 0, 0]) => {
    const mesh = new Mesh(geometry, material); mesh.name = name; mesh.position.set(...position); model.add(mesh); return mesh;
  };
  const profile = [[.01, 0], [.13, .22], [.27, .7], [.34, 1.3], [.36, 2.1], [.28, 2.9], [.16, 3.8], [.09, 5.6], [.055, 7.4], [.01, 7.55]];
  const body = add("glider-fuselage", new LatheGeometry(profile.map(p => new Vector2(...p)), 24), white, [0, 0, -4.1]);
  body.rotation.x = Math.PI / 2;
  const canopy = add("glider-canopy", new SphereGeometry(1, 24, 16), glass, [0, .24, -2.36]);
  canopy.scale.set(.315, .38, 1.05);
  const spoilers = [];
  for (const side of [-1, 1]) {
    add("glider-wing", wingGeometry([[.23, .13, -1.05, 1.35], [3.5, .24, -.96, 1.05], [7.8, .43, -.52, .46], [8.5, .518, -.421, .326]], side), white);
    add("glider-wingtip", wingGeometry([[8.5, .518, -.421, .326], [9, .58, -.35, .23]], side), orange);
    add("glider-tailplane", wingGeometry([[0, 1.23, 2.3, .77], [1.35, 1.27, 2.64, .34]], side), white);
    const spoiler = add("glider-airbrake", new BoxGeometry(1.65, .24, .055), orange, [side * 3.1, .21, -.38]);
    spoiler.visible = false; spoilers.push(spoiler);
  }
  const fin = add("glider-fin", wingGeometry([[0, 0, 2.24, 1.11], [1.24, .04, 2.59, .53]], 1), white, [0, .015, 0]);
  fin.rotation.z = Math.PI / 2;
  const finTip = add("glider-fin-tip", new BoxGeometry(.08, .14, .5), orange, [-.04, 1.2, 2.87]);
  finTip.rotation.x = -.12;
  for (const [name, radius, y, z, width] of [["main", .23, -.43, -.25, .15], ["tail", .09, -.17, 3.12, .08]]) {
    const wheel = add(`glider-${name}-wheel`, new CylinderGeometry(radius, radius, width, 20), rubber, [0, y, z]);
    wheel.rotation.z = Math.PI / 2;
  }
  model.userData.sailplane = { spoilers };
  model.userData.landingBodyPoints = [
    [0, -.03, -4.08], [0, -.35, -2], [0, -.055, 3.4], [-8.9, .54, -.15], [8.9, .54, -.15],
  ].map(p => new Vector3(...p));
  return model;
}

export function updateSailplane(root, airbrake = 0) {
  root?.traverse(node => {
    for (const spoiler of node.userData.sailplane?.spoilers ?? []) {
      spoiler.visible = airbrake > .01;
      spoiler.scale.y = Math.max(.01, airbrake);
      spoiler.position.y = .27 + .12 * airbrake;
    }
  });
}

// Pitch exchanges height and airspeed. Drag always removes energy; neither
// the throttle input nor the airbrakes can provide thrust, even near a runway.
export class SailplaneController extends PlaneController {
  constructor(lat, lon, height, heading, spec = SAILPLANE_SPEC) {
    super(lat, lon, height, heading, spec);
    this.isSailplane = true;
    this.cruiseT = this.throttle = this.airbrake = 0;
    this.verticalSpeed = -this.speed / 38;
  }

  update(dt, ctrl) {
    const steps = Math.max(1, Math.ceil(dt * 120)), step = dt / steps;
    for (let i = 0; i < steps; i++) this.step(step, ctrl);
  }

  step(dt, ctrl) {
    const blend = rate => 1 - Math.exp(-rate * dt);
    this.throttle = 0;
    const brake = Number.isFinite(ctrl.airbrake) ? MathUtils.clamp(ctrl.airbrake, 0, 1) : 0;
    this.airbrake += (brake - this.airbrake) * blend(4);
    const authority = MathUtils.clamp(this.speed / this.brake, .25, 1);
    this.roll += (-ctrl.roll * .85 * authority - this.roll) * blend(2.4);
    this.pitch += (ctrl.pitch * (ctrl.approach ? .2 : .32) * authority - this.pitch) * blend(2);
    const load = 1 / Math.max(.5, Math.cos(this.roll));
    const stallSpeed = this.brake * Math.sqrt(load);
    const stall = MathUtils.clamp((stallSpeed - this.speed) / (stallSpeed * .45), 0, 1);
    const glideAngle = this.pitch * (1 - stall * .85) - Math.atan(1 / 38)
      - this.airbrake * .075 - stall * .65 - (load - 1) * .025;
    const ratio = Math.max(.3, this.speed / this.cruise);
    const drag = 9.81 / 38 * (.65 * ratio ** 2 + .35 * load ** 2 / ratio ** 2)
      + this.airbrake * .85 * ratio ** 2;
    const previousSpeed = this.speed;
    this.speed = MathUtils.clamp(this.speed + (-9.81 * Math.sin(glideAngle) - drag) * dt, 1, this.boost);
    const speed = (previousSpeed + this.speed) / 2;
    this.verticalSpeed = speed * Math.sin(glideAngle);
    this.heading -= 9.81 * Math.tan(this.roll) / Math.max(12, speed) * dt;
    const horizontal = speed * Math.cos(glideAngle);
    advanceAirMotion(this, dt, Math.cos(this.heading)*horizontal, Math.sin(this.heading)*horizontal, this.verticalSpeed, ctrl.weather);
  }
}
