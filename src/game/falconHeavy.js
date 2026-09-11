import {
  BoxGeometry, CylinderGeometry, DoubleSide, ExtrudeGeometry, Group, LatheGeometry,
  Mesh, MeshStandardMaterial, Shape, SphereGeometry, TorusGeometry, Vector2, Vector3,
} from "three";
import { markingsTexture, mergeStatic } from "./falcon9.js";

// Metres, +Y nose. References and the fictional cabin are documented in
// docs/falcon-heavy-research.md. Overall standard-fairing envelope: 70 × 12.2 m.
export const FALCON_HEAVY_DIMENSIONS = Object.freeze({ height: 70, width: 12.2, coreDiameter: 3.66, fairingDiameter: 5.2, fairingHeight: 13.1 });

export function createFalconHeavy() {
  const root = new Group(); root.name = "spacex-falcon-heavy";
  function material(name, color, metalness = .2, roughness = .45, extra = {}) {
    const m = new MeshStandardMaterial({ name, color, metalness, roughness, ...extra });
    m.userData.vehicleFinish = true; return m;
  }
  const white = material("heavy-white", 0xe9eceb, .18, .4);
  const carbon = material("heavy-carbon", 0x1b1c20, .25, .55);
  const seam = material("heavy-seams", 0x9ba1a4, .45, .5);
  const steel = material("heavy-titanium", 0x667078, .8, .3);
  const engine = material("heavy-merlin-bells", 0x252b30, .65, .44, { side: DoubleSide });
  const glass = material("heavy-cabin-windows", 0x102d43, .5, .16);
  const markings = material("heavy-markings", 0xffffff, .1, .6, { map: markingsTexture("HEAVY"), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const part = (parent, geometry, mat, x = 0, y = 0, z = 0) => {
    const mesh = new Mesh(geometry, mat); mesh.position.set(x, y, z);
    mesh.castShadow = mesh.receiveShadow = true; parent.add(mesh); return mesh;
  };
  const cylinder = (parent, top, bottom, height, mat, y) => part(parent, new CylinderGeometry(top, bottom, height, 48), mat, 0, y);
  const ring = (parent, radius, y, mat = seam, thickness = .018) => {
    const mesh = part(parent, new TorusGeometry(radius, thickness, 6, 48), mat, 0, y); mesh.rotation.x = Math.PI / 2; return mesh;
  };
  const lathe = (parent, points, mat, y = 0) => part(parent, new LatheGeometry(points.map(([r, h]) => new Vector2(r, h)), 48), mat, 0, y);
  const mount = (parent, y, length, radius, enabled = true) => {
    const node = new Group(); node.name = "heavy-engine-mount"; node.position.y = y;
    node.userData.rocketNozzle = { length, radius }; node.userData.engineEnabled = enabled; parent.add(node); return node;
  };

  function core(id, x) {
    const booster = new Group(); booster.name = `heavy-${id}`; booster.position.x = x; root.add(booster);
    const fixed = new Group(); booster.add(fixed);
    cylinder(fixed, 1.83, 1.83, 36.8, white, 20.4);
    cylinder(fixed, 1.845, 1.845, 1.2, carbon, 1.8);
    cylinder(fixed, 1.83, 1.83, 4.2, id === "center" ? carbon : white, 40.9);
    if (id !== "center") lathe(fixed, [[1.83, 43], [1.82, 43.7], [1.65, 44.8], [1.24, 46.2], [.64, 47.4], [0, 48.1]], white);
    for (const y of [2.42, 8.7, 22.8, 33.2, 38.78, 42.98]) ring(fixed, 1.838, y);
    // External cable raceways and small service ports, visible in launch photos.
    for (const a of [0, Math.PI]) {
      const raceway = part(fixed, new BoxGeometry(.13, 37.4, .14), carbon, Math.sin(a) * 1.84, 21.2, Math.cos(a) * 1.84);
      raceway.rotation.y = a;
      const label = part(fixed, new CylinderGeometry(1.843, 1.843, 24, 24, 1, true, -.53, 1.06), markings, 0, 23);
      label.rotation.y = a + .4; label.castShadow = false; label.userData.noVehicleShadow = true;
    }
    for (const y of [12.5, 31.6, 37.2]) {
      const port = part(fixed, new CylinderGeometry(.13, .13, .035, 12), steel, 0, y, 1.84); port.rotation.x = Math.PI / 2;
    }
    // Octaweb: eight bells around one central engine, all 27 mouths are hollow.
    for (let i = 0; i < 9; i++) {
      const a = i * Math.PI / 4, r = i === 8 ? 0 : 1.22;
      const bell = lathe(fixed, [[.24, 1.8], [.25, 1.48], [.32, .92], [.49, .25], [.51, .025]], engine);
      bell.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); bell.name = "merlin-1d";
      const rim = ring(fixed, .51, .025, steel, .025); rim.position.x = bell.position.x; rim.position.z = bell.position.z;
      cylinder(fixed, .23, .23, .35, steel, 1.86).position.set(bell.position.x, 1.86, bell.position.z);
    }
    mergeStatic(fixed);
    booster.userData.engineCount = 9;
    mount(booster, 0, 42, 1.18);

    const legs = [], fins = [];
    const shape = new Shape(); shape.moveTo(-.47, 0); shape.lineTo(.47, 0); shape.lineTo(.38, 6.7);
    shape.quadraticCurveTo(0, 9.5, -.38, 6.7); shape.closePath();
    const legGeo = new ExtrudeGeometry(shape, { depth: .17, bevelEnabled: true, bevelSize: .06, bevelThickness: .045, bevelSegments: 1 });
    for (let i = 0; i < 4; i++) {
      const holder = new Group(); holder.rotation.y = Math.PI / 4 + i * Math.PI / 2; booster.add(holder);
      const pivot = new Group(); pivot.name = "heavy-landing-leg"; pivot.position.set(0, 1.8, 1.87); holder.add(pivot);
      part(pivot, legGeo, carbon);
      const foot = part(pivot, new BoxGeometry(1.1, .16, .9), carbon, 0, 8.7, .08);
      const rod = part(holder, new CylinderGeometry(.075, .075, 1, 10), steel);
      const hinge = part(holder, new CylinderGeometry(.25, .25, .85, 12), steel, 0, 1.8, 1.88); hinge.rotation.z = Math.PI / 2;
      legs.push({ pivot, foot, rod });
      const fin = new Group(); fin.name = "heavy-grid-fin"; fin.position.set(0, 39.8, 1.89); holder.add(fin);
      for (const x of [-.68, .68]) part(fin, new BoxGeometry(.08, 1.8, .18), steel, x, -1.0, .05);
      for (const y of [-1.9, -.1]) part(fin, new BoxGeometry(1.44, .08, .18), steel, 0, y, .05);
      for (let j = -4; j <= 4; j++) {
        part(fin, new BoxGeometry(.035, 1.72, .16), steel, j * .145, -1, .05);
        part(fin, new BoxGeometry(1.3, .035, .16), steel, 0, -1 + j * .19, .05);
      }
      mergeStatic(fin); fins.push(fin);
    }
    const stage = { id, booster, legs, fins, boosterReleased: false, recovery: null,
      homePosition: booster.position.clone(), clearance: -(1.8 + 8.7 * Math.cos(2.05) - .08 * Math.sin(2.05) - .08),
      setDeployment(extension, finExtension) {
        for (const { pivot, foot, rod } of legs) {
          pivot.rotation.x = extension * 2.05; foot.rotation.x = -pivot.rotation.x;
          const start = new Vector3(0, 8.4, 1.9);
          const end = new Vector3(0, 7.4, .08).applyAxisAngle(new Vector3(1, 0, 0), pivot.rotation.x).add(pivot.position);
          rod.position.copy(start).add(end).multiplyScalar(.5); rod.scale.y = start.distanceTo(end);
          rod.quaternion.setFromUnitVectors(new Vector3(0, 1, 0), end.sub(start).normalize());
        }
        for (const fin of fins) fin.rotation.x = -finExtension * Math.PI / 2;
      } };
    stage.setDeployment(0, 0); return stage;
  }

  const center = core("center", 0), sides = [core("left", -4.27), core("right", 4.27)];
  // Forward and aft pneumatic attachments stay with each side booster.
  for (const side of sides) {
    for (const y of [3.2, 38.4]) for (const z of [-.62, .62]) {
      const link = part(side.booster, new BoxGeometry(.69, .22, .22), steel, -Math.sign(side.homePosition.x) * 2.0, y, z);
      link.name = "heavy-separation-pusher";
    }
  }
  const upper = new Group(); upper.name = "heavy-upper-stage"; root.add(upper);
  cylinder(upper, 1.83, 1.83, 13.9, white, 49.95);
  for (const y of [43.02, 45.2, 54.5, 56.88]) ring(upper, 1.84, y);
  lathe(upper, [[.36, 43.1], [.4, 42.5], [.8, 41.2], [1.45, 39.5]], engine);
  ring(upper, 1.45, 39.5, steel, .03);
  mergeStatic(upper);
  const upperEngine = mount(upper, 39.47, 19, .85, false);

  // Standard clamshell fairing preserves the real Heavy silhouette. It opens
  // with cabin release; a cabin inside is a game option, not a flown vehicle.
  const fairings = [];
  const profile = [[1.83, 0], [2.6, 1.5], [2.6, 8.2], [2.52, 9.2], [2.17, 10.45], [1.57, 11.6], [.8, 12.5], [0, 13.1]].map(([r, y]) => new Vector2(r, y));
  const fairingMat = material("heavy-fairing-shell", 0xeeeeeb, .18, .46, { side: DoubleSide });
  for (const sign of [-1, 1]) {
    const shell = new Group(); shell.name = `heavy-fairing-${sign < 0 ? "left" : "right"}`; shell.position.y = 56.9; root.add(shell);
    part(shell, new LatheGeometry(profile, 48, sign < 0 ? Math.PI : 0, Math.PI), fairingMat);
    fairings.push({ object: shell, sign, homePosition: shell.position.clone() });
  }

  const dragon = new Group(); dragon.name = "heavy-game-cabin"; dragon.position.y = 58.4; root.add(dragon);
  lathe(dragon, [[1.75, 0], [1.8, .3], [1.7, 1.4], [1.3, 2.7], [.7, 3.9], [0, 4.45]], white);
  cylinder(dragon, 1.76, 1.65, .2, carbon, -.02);
  for (const sign of [-1, 1]) {
    const pane = part(dragon, new SphereGeometry(1, 20, 12), glass, sign * .61, 2.1, 1.22);
    pane.scale.set(.25, .34, .055); pane.rotation.y = sign * .3;
    const pod = part(dragon, new SphereGeometry(1, 16, 12), carbon, sign * 1.44, .65, .74); pod.scale.set(.15, .48, .17);
  }
  ring(dragon, 1.77, .22, steel, .035); mergeStatic(dragon);
  root.userData.falcon9 = { ...center, variant: "heavy", parent: root, sideBoosters: sides, sideBoostersReleased: false,
    upperEngine, fairings, dragon, position: dragon.position.clone(), released: false, flight: null };
  return root;
}
