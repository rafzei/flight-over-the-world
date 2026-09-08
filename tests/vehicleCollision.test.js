import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";
import { parseAst } from "rollup/parseAst";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { Group, Matrix4, Mesh, MeshBasicMaterial, PlaneGeometry, Raycaster, Vector3 } from "three";
import { createVehicleCollisionDetector, raycastTerrain } from "../src/game/vehicleCollision.js";

const up = new Vector3(0, 1, 0);
const v = (x, y, z = 0) => new Vector3(x, y, z);
function surface(width = 2000, depth = 2000) {
  const mesh = new Mesh(new PlaneGeometry(width, depth), new MeshBasicMaterial());
  mesh.rotation.x = -Math.PI / 2;
  mesh.updateMatrixWorld(true);
  return mesh;
}

test("fast descents hit a zero-thickness land or water surface within one step", () => {
  const detector = createVehicleCollisionDetector();
  for (const height of [0, 145, -430]) {
    const ground = surface(); ground.position.y = height; ground.updateMatrixWorld(true);
    const hit = detector.sweep(ground, v(0, height + 40), v(100, height - 70), up);
    assert(hit);
    assert(Math.abs(hit.point.y - height) < 1e-8);
    assert(hit.position.y >= height);
    assert(hit.fraction > 0 && hit.fraction < 1);
  }
});

test("a thin ridge between two clear endpoints is solid, including body edges", () => {
  const detector = createVehicleCollisionDetector();
  const ridge = surface(20, 50);
  ridge.rotation.set(-Math.PI / 2, 0, .6, "ZYX"); ridge.updateMatrixWorld(true);
  // The centre clears the ridge; the lower edge of the body crosses its slope.
  const hit = detector.sweep(ridge, v(-100, 7), v(100, 7), up, 4.5);
  assert(hit, "checking only the final position would skip this ridge");
  assert(hit.fraction > .4 && hit.fraction < .6);
});

test("buildings collide at altitude without an AGL cutoff and the nearest hit wins", () => {
  const wall = new Mesh(new PlaneGeometry(100, 100), new MeshBasicMaterial());
  wall.position.set(0, 700, 0);
  const behind = wall.clone(); behind.position.z = -20;
  const terrain = new Group(); terrain.add(behind, wall); terrain.updateMatrixWorld(true);
  const hit = createVehicleCollisionDetector().sweep(terrain, v(0, 700, 100), v(0, 700, -100), up);
  assert(hit); assert.equal(hit.point.z, 0);
  assert(Math.abs(hit.position.z - 4.5) < 1e-8);
});

test("stationary aircraft and the larger vertical rocket body contact the surface", () => {
  const detector = createVehicleCollisionDetector();
  const ground = surface();
  assert(detector.sweep(ground, v(0, 3), v(0, 3), up, 4.5));
  assert.equal(detector.sweep(ground, v(0, 10), v(0, 10), up, 4.5), null);
  const rocket = detector.sweep(ground, v(0, 10), v(0, 10), up, 18);
  assert(rocket); assert(Math.abs(rocket.position.y - 18) < 1e-8);
  assert.equal(detector.sweep(ground, v(0, 100), v(100, 100), up), null);
  assert.equal(detector.sweep(null, v(0, 100), v(100, -100), up), null);
});

test("shadow overlays are not solid; visible parent tiles remain solid during LOD loading", () => {
  const overlay = surface(); overlay.userData.vehicleShadowReceiver = true;
  assert.equal(createVehicleCollisionDetector().sweep(overlay, v(0, 50), v(0, -50), up), null);
  const heldScene = surface();
  const tile = { engineData: { scene: heldScene } };
  const terrain = new Group();
  terrain.tilesRenderer = { activeTiles: new Set(), visibleTiles: new Set([tile]) };
  // Matches TilesGroup: renderer-controlled traversal excludes this held parent.
  terrain.raycast = () => false;
  assert(createVehicleCollisionDetector().sweep(terrain, v(0, 50), v(0, -50), up));
});

const source = await readFile(new URL("../src/main.js", import.meta.url), "utf8");
const ast = parseAst(source);
const physicsFunctions = ["collectProbeHits", "hitEllipsoidHeight", "probeColumn", "adoptGround",
  "armCrashGrace", "flightPosition", "stopAtImpact", "updateFlightPhysics"];
function flight({ groundHeight = 0, height = 40, vertical = false, lat = .9, lon = .3, terrainSize = 10000 } = {}) {
  const group = new Group();
  group.rotation.x = -Math.PI / 2;
  group.position.set(230, -510, 80);
  const normal = WGS84_ELLIPSOID.getCartographicToNormal(lat, lon, new Vector3());
  const mesh = new Mesh(new PlaneGeometry(terrainSize, terrainSize), new MeshBasicMaterial());
  WGS84_ELLIPSOID.getCartographicToPosition(lat, lon, groundHeight, mesh.position);
  mesh.quaternion.setFromUnitVectors(v(0, 0, 1), normal);
  group.add(mesh); group.updateMatrixWorld(true);
  let now = 10000;
  const impacts = [];
  const context = vm.createContext({
    WGS84_ELLIPSOID, raycastTerrain, tiles: { group }, raycaster: new Raycaster(),
    plane: { lat, lon, height, update(dt) { this.height -= 2400 * dt; } },
    planePos: new Vector3(), ctrl: {}, PLANES: { vehicle: { vertical } }, selectedPlane: "vehicle",
    pendingSnap: false, awaitingSnap: false, crashGraceUntil: 0, groundAlt: 120, crashed: false,
    performance: { now: () => now }, vehicleCollision: createVehicleCollisionDetector(),
    _probeOrigin: new Vector3(), _probeDir: new Vector3(), _probePoint: new Vector3(),
    _probeInv: new Matrix4(), _probeLla: {}, _flightFrom: new Vector3(), _flightTo: new Vector3(),
    _flightUp: new Vector3(), _flightInv: new Matrix4(), _flightLla: {},
    crash(point) { context.crashed = true; impacts.push(point.clone()); },
  });
  for (const name of physicsFunctions) {
    const node = ast.body.find(n => n.type === "FunctionDeclaration" && n.id.name === name);
    assert(node, `${name} must be exercised from the actual flight integration`);
    vm.runInContext(source.slice(node.start, node.end), context);
  }
  return { context, impacts, mesh, setTime(value) { now = value; } };
}

test("real flight physics stops and crashes on the first impact at transformed Earth coordinates", () => {
  for (const vertical of [false, true]) {
    const { context, impacts } = flight({ vertical });
    context.updateFlightPhysics(.05);
    assert(context.crashed); assert.equal(impacts.length, 1);
    assert(Math.abs(context.plane.height - (vertical ? 18 : 4.5)) < .001);
    const localPoint = impacts[0].clone().applyMatrix4(context.tiles.group.matrixWorld.clone().invert());
    const lla = WGS84_ELLIPSOID.getPositionToCartographic(localPoint, {});
    assert(Math.abs(lla.height) < .001);
    assert.equal(context.crashGraceUntil, 0, "descent must not renew invulnerability");
  }
});

test("spawn grace expires even below ground, and newly loaded terrain ends penetration", () => {
  const { context, impacts, setTime } = flight({ height: 60 });
  context.armCrashGrace(2500);
  const deadline = context.crashGraceUntil;
  context.updateFlightPhysics(.05);
  assert.equal(impacts.length, 0); assert(context.plane.height < -18);
  setTime(deadline + 1);
  context.updateFlightPhysics(1 / 60);
  assert.equal(impacts.length, 1);
  assert(context.plane.height > 0);
  assert.equal(context.crashGraceUntil, deadline);
});

test("spawn snapping is protected and teleports do not sweep from a stale rendered position", () => {
  for (const guard of ["pendingSnap", "awaitingSnap"]) {
    const { context, impacts } = flight();
    context[guard] = true;
    context.updateFlightPhysics(.05);
    assert.equal(impacts.length, 0);
    context[guard] = false;
    context.plane.height = 1000;
    context.planePos.set(0, 0, 0); // previous scene/teleport position
    context.updateFlightPhysics(1 / 60);
    assert.equal(impacts.length, 0);
  }
});

test("ground probes follow the geodetic normal directly under the vehicle", () => {
  // At this latitude the former radial probe missed a narrow tile by metres.
  const { context } = flight({ terrainSize: 2, groundHeight: 350, height: 800 });
  const column = context.probeColumn(context.plane.lat, context.plane.lon, 2500);
  assert(column.ground !== null);
  assert(Math.abs(column.ground - 350) < .001);
});

test("fresh local terrain replaces stale higher/lower ground without granting crash grace", () => {
  const { context, impacts } = flight({ height: 100, groundHeight: 0 });
  context.groundAlt = 900;
  context.updateFlightPhysics(1 / 60);
  assert.equal(impacts.length, 0, "old mountain height must not crash a flight over low land");
  assert(Math.abs(context.groundAlt) < .001);
  context.adoptGround(500);
  assert.equal(context.groundAlt, 500, "rising terrain must not be discarded as a LOD jump");
  assert.equal(context.crashGraceUntil, 0);
});

test("missing tiles do not create a phantom sea-level or cached-ground collision", () => {
  const { context, impacts, mesh } = flight({ height: -350, groundHeight: -430 });
  context.updateFlightPhysics(1 / 60);
  assert.equal(impacts.length, 0, "valid flight below sea level must be possible");
  mesh.removeFromParent();
  context.updateFlightPhysics(.05);
  assert.equal(impacts.length, 0);
});
