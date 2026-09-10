import test from "node:test";
import assert from "node:assert/strict";
import { Box3, FogExp2, Matrix4, PerspectiveCamera, Scene, Vector3 } from "three";
import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { createSky, spaceSkyBlend } from "../src/game/sky.js";
import { createAirliner } from "../src/game/airliner.js";
import { aircraftVisual } from "../shared/aircraftTypes.js";
import { TrafficSpheres } from "../src/game/trafficSpheres.js";
import { TrafficTracks } from "../src/game/trafficTracks.js";
import { disposeModelResources } from "../src/game/vehicleModels.js";
import { earthPosition } from "../src/game/trafficVisibility.js";
import { AircraftMetadata, parseAircraftMetadata } from "../server/aircraftMetadata.mjs";

test("space sky begins above 20 km and reversibly updates fog, for both quality modes", () => {
  assert.equal(spaceSkyBlend(20_000), 0); assert.equal(spaceSkyBlend(21_000), .5); assert.equal(spaceSkyBlend(22_000), 1);
  for(const simple of [false,true]) {
    const sky=createSky(0x9dd0ea,{simple}), fog=new FogExp2(0x9dd0ea,.00007), color=fog.color.clone();
    sky.update(30000,12,fog); assert.equal(sky.uniforms.uSpace.value,1); assert.equal(sky.uniforms.uTime.value,12); assert(fog.density<.000001);
    sky.update(1000,13,fog); assert.equal(sky.uniforms.uSpace.value,0); assert.equal(fog.density,.00007); assert(fog.color.equals(color));
    sky.dispose();
  }
});

test("both original airliners have finite meter-scale geometry and a bounded number of parts", () => {
  for(const key of ["b738","a320"]) {
    const model=createAirliner(key), box=new Box3().setFromObject(model), size=box.getSize(new Vector3());
    assert.equal(model.userData.airliner,key); assert(model.children.length<=6);
    assert(size.x>35&&size.x<37); assert(size.z>37&&size.z<40); assert(size.y>10&&size.y<15);
    for(const part of model.children) {
      assert([...part.geometry.attributes.position.array].every(Number.isFinite));
      assert([...part.geometry.attributes.normal.array].every(Number.isFinite));
    }
    disposeModelResources(model);
  }
  assert.equal(aircraftVisual("B738").model,"b738"); assert.equal(aircraftVisual("B38M").model,"b738");
  assert.equal(aircraftVisual("A320").model,"a320"); assert.equal(aircraftVisual("A20N").model,"a320");
  for(const type of ["B744","A359","A319","LOT737",null])assert.equal(aircraftVisual(type),null);
});

const metadata = (id,type) => ({response:{aircraft:{mode_s:id,icao_type:type,manufacturer:type==='B738'?'Boeing':'Airbus',type,registration:'TEST'}}});
test("type lookup validates ICAO, coalesces duplicate calls, caches misses and bounds cold work", async () => {
  let calls=0;
  const db=new AircraftMetadata({fetchImpl:async url=>{
    calls++;const id=url.split('/').at(-1);return new Response(JSON.stringify(metadata(id,'B738')));
  }});
  const [a,b]=await Promise.all([db.get('abc123'),db.get('abc123')]);
  assert.equal(calls,1); assert.deepEqual(a,b); assert.equal(a.typeCode,'B738');
  assert.equal(await db.get('abc123'),a); assert.equal(calls,1);
  assert.equal(parseAircraftMetadata(metadata('abc123','B738'),'abc124'),null);
  assert.equal(await db.get('../secret'),null);
  const enriched=await db.enrich(Array.from({length:20},(_,i)=>({icao24:i.toString(16).padStart(6,'0')})));
  assert.equal(calls,7); assert.equal(enriched.filter(x=>x.aircraft).length,6);
  let failures=0; const missing=new AircraftMetadata({fetchImpl:async()=>{failures++;return new Response('{}',{status:404});}});
  assert.equal(await missing.get('abc123'),null); assert.equal(await missing.get('abc123'),null); assert.equal(failures,1);
  const limited=new AircraftMetadata({fetchImpl:async()=>new Response('{}',{status:429,headers:{'Retry-After':'120'}}),now:()=>1000});
  await limited.get('abc123');assert.equal(limited.blockedUntil,121000); assert.equal(await limited.get('abc124'),null);
});

test("known types replace spheres, preserve geographic heading and update metadata without a new position", () => {
  const scene=new Scene(), matrix=new Matrix4().makeRotationX(-Math.PI/2), camera=new PerspectiveCamera(70,1.8,1,1e8);
  earthPosition(.5,.2,1000,matrix,camera.position);camera.up.copy(earthPosition(.5,.2,1100,matrix).sub(camera.position).normalize());
  camera.lookAt(earthPosition(.501,.2,1000,matrix));camera.updateMatrixWorld();
  const samples=['B738','A320','E195'].map((type,i)=>({icao24:`abc12${i}`,latitudeDeg:.501*180/Math.PI,longitudeDeg:.2*180/Math.PI,altitudeM:1000,timePosition:1000,onGround:false,freshness:1,trueTrackDeg:90,velocityMps:200,aircraft:{typeCode:type}}));
  const layer=new TrafficSpheres(scene);
  layer.update(samples,camera,matrix,new FogExp2(0xffffff,.00007),1080);
  assert.equal(layer.mesh.count,1);
  for(const key of ['b738','a320'])assert(layer.airliners.get(key).every(p=>p.count===1));
  const transform=new Matrix4();layer.airliners.get('b738')[0].getMatrixAt(0,transform);
  const forward=new Vector3(0,0,-1).transformDirection(transform);
  const here=earthPosition(.501,.2,1000,matrix), east=earthPosition(.501,.20001,1000,matrix).sub(here).normalize();
  assert(forward.dot(east)>.999);
  const tracks=new TrafficTracks();tracks.ingest({aircraft:[{...samples[0],aircraft:null}]},1000);
  tracks.ingest({aircraft:[samples[0]]},1001);assert.equal(tracks.positions(1001)[0].aircraft.typeCode,'B738');
  layer.hide();assert(layer.airliners.get('b738').every(p=>p.count===0));layer.dispose();
});
