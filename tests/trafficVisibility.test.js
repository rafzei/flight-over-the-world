import assert from "node:assert/strict";
import test from "node:test";
import { FogExp2, Group, Matrix4, PerspectiveCamera, Scene, Vector3 } from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { earthPosition, hiddenByEarth, markerRadius, trafficRange } from "../src/game/trafficVisibility.js";
import { TrafficSpheres } from "../src/game/trafficSpheres.js";

test("world conversion shares WGS84 axes with rotated tiles and handles horizon", () => {
  const matrix = new Matrix4().makeRotationX(-Math.PI / 2), inverse = matrix.clone().invert();
  const p = earthPosition(Math.PI / 2, 0, 1000, matrix);
  const actual = WGS84_ELLIPSOID.getCartographicToPosition(Math.PI / 2, 0, 1000, new Vector3()).applyMatrix4(matrix);
  assert(p.distanceTo(actual) < .0001); assert(p.y > 6_350_000);
  const camera = earthPosition(0, 0, 1000, matrix);
  assert.equal(hiddenByEarth(camera, earthPosition(0, .001, 1000, matrix), inverse), false);
  assert.equal(hiddenByEarth(camera, earthPosition(0, Math.PI, 1000, matrix), inverse), true);
  assert.equal(hiddenByEarth(camera, camera, inverse), false);
  assert(trafficRange(new FogExp2(0xffffff, .00007)) > 24_000);
  assert(trafficRange(new FogExp2(0xffffff, .00007)) < 25_000);
  assert(markerRadius(24_000, 60, 1080) <= 250);
});

test("instanced spheres use camera-relative positions, frustum and fog range, without terrain collisions", () => {
  const scene = new Scene(), tiles = new Group(); tiles.rotation.x = -Math.PI / 2; scene.add(tiles); scene.updateMatrixWorld();
  const camera = new PerspectiveCamera(60, 1.5, 1, 1e8);
  earthPosition(0, 0, 1000, tiles.matrixWorld, camera.position);
  camera.up.set(1, 0, 0); camera.lookAt(earthPosition(.001, 0, 1000, tiles.matrixWorld)); camera.updateMatrixWorld();
  const spheres = new TrafficSpheres(scene, { limit: 2 });
  const sample = (icao24, latitudeDeg) => ({ icao24, latitudeDeg, longitudeDeg: 0, altitudeM: 1000, freshness: 1 });
  spheres.update([sample("abc123", .05), sample("abc124", -.05), sample("abc125", 1), sample("abc126", .07)], camera, tiles.matrixWorld, new FogExp2(0xffffff, .00007), 1080);
  assert.equal(spheres.mesh.count, 2);
  assert.deepEqual(spheres.visible.map(p => p.sample.icao24), ["abc123", "abc126"]);
  assert.equal(tiles.children.length, 0); assert.equal(spheres.material.depthTest, true); assert.equal(spheres.material.fog, true);
  const transform = new Matrix4(); spheres.mesh.getMatrixAt(0, transform);
  const rendered = new Vector3().setFromMatrixPosition(transform).applyMatrix4(spheres.mesh.matrixWorld);
  assert(rendered.distanceTo(earthPosition(.05 * Math.PI / 180, 0, 1000, tiles.matrixWorld)) < .01);
  const hits = []; spheres.mesh.raycast({}, hits); assert.equal(hits.length, 0);
  spheres.hide(); assert.equal(spheres.mesh.count, 0);
  spheres.dispose(); assert.equal(scene.getObjectByName("opensky-traffic"), undefined);
});
