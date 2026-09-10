import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { Box3, Raycaster, Vector3 } from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { createAirliner } from "../src/game/airliner.js";
import { passengerType, preparePassengerDetails } from "../src/game/passengerDetails.js";
import { disposeModelResources } from "../src/game/vehicleModels.js";
import { finishVehicleMaterials } from "../src/game/vehicleVisuals.js";

// Use the real authored GLB geometry/transforms. Only image references are removed
// because Node has no image decoder; this does not alter geometry or materials' roles.
async function geometryFromAsset(key) {
  const source = await fs.readFile(new URL(`../public/models/${key}.glb`,import.meta.url));
  const length = source.readUInt32LE(12), json = JSON.parse(source.subarray(20,20+length).toString());
  for (const material of json.materials ?? []) {
    for (const property of Object.keys(material)) if (/texture/i.test(property)) delete material[property];
    for (const property of Object.keys(material.pbrMetallicRoughness ?? {})) if (/texture/i.test(property)) delete material.pbrMetallicRoughness[property];
  }
  delete json.images; delete json.textures;
  let text = JSON.stringify(json); while (Buffer.byteLength(text)%4) text += " ";
  const encoded=Buffer.from(text),binary=source.subarray(20+length),result=Buffer.alloc(20+encoded.length+binary.length);
  result.writeUInt32LE(0x46546c67,0);result.writeUInt32LE(2,4);result.writeUInt32LE(result.length,8);
  result.writeUInt32LE(encoded.length,12);result.writeUInt32LE(0x4e4f534a,16);encoded.copy(result,20);binary.copy(result,20+encoded.length);
  return (await new GLTFLoader().parseAsync(result.buffer.slice(result.byteOffset,result.byteOffset+result.length),"")).scene;
}

test("civil GLB detailing preserves all authored geometry, landing bounds and propeller transforms", async () => {
  for (const key of ["pa28","q400","citation"]) {
    const model=await geometryFromAsset(key),before=new Box3().setFromObject(model),original=[];
    model.traverse(node=>{if(node.isMesh)original.push({node,geometry:node.geometry,matrix:node.matrixWorld.clone()});});
    preparePassengerDetails(model,key);finishVehicleMaterials(model);model.updateMatrixWorld(true);
    const after=new Box3().setFromObject(model),details=model.userData.passengerDetails;
    assert(before.min.distanceTo(after.min)<1e-6,`${key}: lower bounds moved`);
    assert(before.max.distanceTo(after.max)<1e-6,`${key}: upper bounds moved`);
    assert(details.panels>=6);assert(details.glazing>=1);
    for(const {node,geometry,matrix} of original){assert.equal(node.geometry,geometry);assert(node.matrixWorld.equals(matrix));}
    const added=model.getObjectByName("passenger-details");assert(added.children.length<=2);
    assert(added.getObjectByName("passenger-panel-seams").geometry.attributes.position.count>30);
    const glazing=original.filter(({node})=>(node.material?.name??"").startsWith("passenger-glass"));
    assert(glazing.every(({node})=>node.material.roughness===.13&&node.material.userData.vehicleFinish));
    const children=model.children.length;preparePassengerDetails(model,key);assert.equal(model.children.length,children);
    assert.equal(passengerType({file:`/models/${key}.glb?v=2`}),key);
    disposeModelResources(model);
  }
  assert.equal(passengerType({file:"/models/jet.glb"}),null);
});

test("detailed airliners retain instancing budgets and correctly sided glazing, intakes and navigation lights", () => {
  for(const key of ["b738","a320"]) {
    const model=createAirliner(key);model.updateMatrixWorld(true);
    const details=model.userData.aircraftDetails;
    assert.equal(model.children.length,6);assert(model.children.every(node=>node.isMesh));
    assert(model.children.reduce((sum,node)=>sum+node.geometry.attributes.position.count/3,0)<22_000);
    assert.equal(details.cockpitPanes,6);assert.equal(details.doors,8);assert.equal(details.fanBlades,48);assert.equal(details.flapFairings,6);assert(details.cabinWindows>=76);
    const lights=details.lights;
    assert(lights.find(l=>l.label==="port-red").position[0]<0);assert(lights.find(l=>l.label==="starboard-green").position[0]>0);
    // Real ray intersections ensure the detail faces outwards and sits above the
    // body; counters alone would not catch buried panes or reversed triangles.
    const glass=model.getObjectByName("airliner-glass").geometry,p=glass.attributes.position,n=glass.attributes.normal;
    for(let i=0;i<p.count;i+=123) {
      const a=new Vector3().fromBufferAttribute(p,i),b=new Vector3().fromBufferAttribute(p,i+1),c=new Vector3().fromBufferAttribute(p,i+2);
      const center=a.add(b).add(c).multiplyScalar(1/3),normal=new Vector3().fromBufferAttribute(n,i);
      const hit=new Raycaster(center.clone().addScaledVector(normal,.10),normal.clone().negate(),0,.3).intersectObject(model)[0];
      assert.equal(hit?.object.name,"airliner-glass",`${key}: hidden glazing at ${i}`);
    }
    const engineZ=key==="a320"?-2.3:-2.9;
    for(const side of [-1,1]) {
      // Sample inside the throat away from the spinner: the forward-facing fan
      // must be visible through an open inlet, not hidden by a cylinder end cap.
      const radius=.6,angle=.15;
      const ray=new Raycaster(new Vector3(side*5.5+Math.cos(angle)*radius,-1.55+Math.sin(angle)*radius,engineZ-3),new Vector3(0,0,1));
      const hit=ray.intersectObject(model)[0];assert.equal(hit?.object.name,"airliner-metal");
      assert(hit.point.z>engineZ-1.5&&hit.point.z<engineZ-1.3);
    }
    disposeModelResources(model);
  }
});
