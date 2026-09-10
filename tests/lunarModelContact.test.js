import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Box3, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createFalcon9 } from "../src/game/falcon9.js";
import { LunarController } from "../src/game/lunarController.js";
import { disposeModelResources } from "../src/game/vehicleModels.js";

async function rocketGeometry() {
  const source = await readFile(new URL("../public/models/rocket.glb", import.meta.url));
  const length = source.readUInt32LE(12), json = JSON.parse(source.subarray(20, 20 + length).toString());
  // Node has no image decoder; omit images without altering any geometry,
  // transforms, node hierarchy or animation from the actual authored asset.
  for (const material of json.materials ?? []) {
    for (const property of Object.keys(material)) if (/texture/i.test(property)) delete material[property];
    for (const property of Object.keys(material.pbrMetallicRoughness ?? {})) if (/texture/i.test(property)) delete material.pbrMetallicRoughness[property];
  }
  delete json.images; delete json.textures;
  let text = JSON.stringify(json); while (Buffer.byteLength(text) % 4) text += " ";
  const encoded = Buffer.from(text), binary = source.subarray(20 + length);
  const result = Buffer.alloc(20 + encoded.length + binary.length);
  result.writeUInt32LE(0x46546c67, 0); result.writeUInt32LE(2, 4); result.writeUInt32LE(result.length, 8);
  result.writeUInt32LE(encoded.length, 12); result.writeUInt32LE(0x4e4f534a, 16);
  encoded.copy(result, 20); binary.copy(result, 20 + encoded.length);
  return (await new GLTFLoader().parseAsync(result.buffer.slice(result.byteOffset, result.byteOffset + result.length), "")).scene;
}

test("lunar contact clearance matches scaled geometry for both body orientations", async () => {
  const originalDocument = globalThis.document;
  // Only canvas decoration calls are stubbed; Falcon mesh geometry is real.
  globalThis.document = { createElement: () => ({ width: 0, height: 0, getContext: () => new Proxy({}, { get: () => () => {}, set: () => true }) }) };
  try {
    for (const vertical of [true, false]) {
      const model = vertical ? createFalcon9() : await rocketGeometry();
      if (!vertical) model.rotation.x = -Math.PI / 2;
      const box = new Box3().setFromObject(model), size = box.getSize(new Vector3());
      // Exactly the main loader's prepare → normalize → center operations.
      model.scale.setScalar((vertical ? 38 : 12) / Math.max(size.x, size.y, size.z));
      box.setFromObject(model); model.position.sub(box.getCenter(new Vector3()));
      box.setFromObject(model);
      const controller = new LunarController(0, 0, 1000, 0, { vertical });
      const measuredClearance = vertical ? -box.min.y : box.max.z;
      assert.ok(Math.abs(controller.surfaceClearance - measuredClearance) < 1e-7);
      model.updateMatrixWorld(true);
      let lowestPoint = Infinity;
      model.traverse(node => {
        if (!node.isMesh) return;
        const positions = node.geometry.attributes.position;
        for (let i = 0; i < positions.count; i++) {
          const point = new Vector3().fromBufferAttribute(positions, i).applyMatrix4(node.matrixWorld);
          lowestPoint = Math.min(lowestPoint, controller.surfaceClearance + (vertical ? point.y : -point.z));
        }
      });
      assert.ok(Math.abs(lowestPoint) < 1e-6, `physical base must touch the lunar tangent plane, got ${lowestPoint} m`);
      disposeModelResources(model);
    }
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
});
