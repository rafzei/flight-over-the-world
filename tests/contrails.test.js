import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { Box3, BoxGeometry, Group, Mesh, MeshBasicMaterial, PerspectiveCamera, Scene, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { attachContrails, disposeContrails, updateContrails } from "../src/game/contrails.js";
import { finishVehicleMaterials, prepareFighterSurfaces, updateFighterSurfaces } from "../src/game/vehicleVisuals.js";

async function fighter() {
  const bytes = await readFile(new URL("../public/models/jet.glb", import.meta.url));
  const model = (await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), "")).scene;
  model.rotation.y = Math.PI;
  prepareFighterSurfaces(model);
  const box = new Box3().setFromObject(model), size = box.getSize(new Vector3());
  model.scale.setScalar(10 / Math.max(size.x, size.y, size.z));
  box.setFromObject(model); model.position.sub(box.getCenter(new Vector3()));
  finishVehicleMaterials(model);
  const root = new Group(); root.add(model);
  const scene = new Scene(); scene.add(root);
  const camera = new PerspectiveCamera(70, 1.5, .1, 3000);
  return { root, model, scene, camera };
}

function fly({ root, camera }, speed, seconds, turning = false) {
  for (let frame = 0; frame < Math.ceil(seconds * 60); frame++) {
    if (turning) root.rotation.y += .004;
    root.position.add(new Vector3(0, 0, -speed / 3.6 / 60).applyQuaternion(root.quaternion));
    camera.position.copy(root.position).add(new Vector3(0, 6, 19));
    camera.lookAt(root.position.x, root.position.y, root.position.z - 30);
    camera.updateMatrixWorld();
    updateContrails(root, 1 / 60, speed, true, camera);
  }
}

test("armed fighter emits two finite trails from its wings above 1000 km/h", async () => {
  const rig = await fighter();
  assert(rig.model.getObjectByName("fighter-armament"));
  const markers = rig.model.children.filter(node => node.userData.contrailEmitter);
  assert.equal(markers.length, 2);
  assert(markers.every(marker => Math.abs(marker.position.x) > 4.9));
  // Decorations extending beyond the wings must not capture the emission point.
  const store = new Mesh(new BoxGeometry(2, 2, 2), new MeshBasicMaterial());
  store.position.set(40, 0, -30); rig.model.add(store);
  attachContrails(rig.root, rig.scene);
  const effect = rig.scene.getObjectByName("wing-contrails");
  fly(rig, 1000, 1); assert.equal(effect.visible, false);
  // Exercise Earth-sized coordinates, turns and animated elevons.
  rig.root.position.set(3_600_000, 4_200_000, 1_100_000);
  updateFighterSurfaces(rig.root, 1, 1, .5);
  fly(rig, 1510, 3, true);
  assert.equal(effect.visible, true); assert.equal(effect.children.length, 2);
  const expected = markers.map(marker => marker.getWorldPosition(new Vector3()).sub(rig.root.position));
  for (const [i, mesh] of effect.children.entries()) {
    const geometry = mesh.geometry;
    assert(geometry.drawRange.count > 200);
    assert([...geometry.attributes.position.array].every(Number.isFinite));
    const head = geometry.index.array[geometry.drawRange.count - 1];
    const center = new Vector3().fromBufferAttribute(geometry.attributes.position, head)
      .add(new Vector3().fromBufferAttribute(geometry.attributes.position, head + 1)).multiplyScalar(.5);
    assert(center.distanceTo(expected[i]) < .001, "fresh trail must remain attached to the wing");
    assert(geometry.attributes.color.getW(head) > .99);
  }
  // Every row of the cloud texture retains a strong central white line.
  const { data, width, height } = effect.children[0].material.map.image;
  for (let row = 0; row < height; row++) assert(data[(row * width + width / 2) * 4 + 3] >= 210);
  fly(rig, 990, 5); assert.equal(effect.visible, true);
  fly(rig, 990, 11); assert.equal(effect.visible, false);
  fly(rig, 1001, .1); assert.equal(effect.visible, true);
  disposeContrails(rig.root);
  assert.equal(rig.scene.getObjectByName("wing-contrails"), undefined);
});

test("automatic attachment still supports four rocket fin trails", () => {
  const root = new Group();
  root.add(new Mesh(new BoxGeometry(4, 4, 12), new MeshBasicMaterial()));
  const scene = new Scene(); scene.add(root);
  attachContrails(root, scene, { wingAxes: ["x", "y"] });
  assert.equal(scene.getObjectByName("wing-contrails").children.length, 4);
  disposeContrails(root);
});
