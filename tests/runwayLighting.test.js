import test from 'node:test';
import assert from 'node:assert/strict';
import { Group, Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Vector3, Vector4 } from 'three';
import { POLISH_RUNWAYS } from '../src/game/airportRunways.js';
import { createRunwayLighting, runwayLightLayout, runwayNightStrength, papiWhites } from '../src/game/runwayLighting.js';
import { createTerrainDayNight } from '../src/game/dayNight.js';

test('every runway gets bounded lighting in both directions, including unlit catalogue entries', () => {
  for (const data of POLISH_RUNWAYS) {
    const layout = runwayLightLayout(data);
    assert(layout.lamps.length > 100 && layout.lamps.length < 1200, data.id);
    assert(layout.fixtures.every(f => Math.abs(f.x) > data.width / 2), 'lamp housings stay outside the pavement');
    assert(layout.lamps.every(lamp => lamp.position.every(Number.isFinite)));
    for (const face of [-1, 1]) {
      assert.equal(layout.lamps.filter(lamp => lamp.kind === 2 && lamp.face === face).length, 4);
      assert(layout.lamps.some(lamp => lamp.kind === 3 && lamp.face === face));
      const threshold = face === 1 ? -data.ends[0].threshold : -data.length + data.ends[1].threshold;
      const greens = layout.lamps.filter(lamp => lamp.color === 0x32ff7c && lamp.face === face);
      assert(greens.length >= 5);
      assert(greens.every(lamp => Math.abs(lamp.position[2] - threshold) < 1e-6));
      const reds = layout.lamps.filter(lamp => lamp.color === 0xff3425 && lamp.face === face);
      assert(reds.some(lamp => Math.abs(lamp.position[2] - (face === 1 ? -data.length : 0)) < 1e-6));
    }
  }
});

test('dusk fades lighting in independently of observer altitude; PAPI goes red below and white above the glide path', () => {
  assert.equal(runwayNightStrength(10), 0); assert.equal(runwayNightStrength(-10), 1);
  assert(runwayNightStrength(-3) > runwayNightStrength(0));
  assert.equal(papiWhites(2), 0); assert.equal(papiWhites(3), 2); assert.equal(papiWhites(4), 4);
  const data = POLISH_RUNWAYS.find(r => r.airportId === 'EPWA'), lighting = createRunwayLighting(data);
  const parent = new Group(); parent.position.set(4e6, 3e6, 2e6); parent.rotation.set(.6, -.3, .4); parent.add(lighting.root); parent.updateMatrixWorld(true);
  const camera = new PerspectiveCamera(), alongPapi = Math.min(300, (data.length - data.ends[0].threshold - data.ends[1].threshold) * .2);
  for (const end of [0, 1]) for (const angle of [2, 3, 4]) {
    const distance = 3000;
    const z = end ? -data.length + data.ends[1].threshold + alongPapi - distance : -data.ends[0].threshold - alongPapi + distance;
    camera.position.copy(lighting.root.localToWorld(new Vector3(0, .8 + Math.tan(angle * Math.PI / 180) * distance, z)));
    lighting.update({ night: 1, camera, time: 3, height: 900, pixelRatio: 2 });
    const renderedAngle = lighting.uniforms.papiAngles.value.getComponent(end);
    assert(Math.abs(renderedAngle - angle) < 1e-7); assert.equal(papiWhites(renderedAngle), papiWhites(angle));
  }
  assert(lighting.root.getObjectByName('runway-light-glows').visible);
  assert.equal(lighting.region().end.w, 1);
  lighting.update({ night: 0, camera }); assert(!lighting.root.getObjectByName('runway-light-glows').visible);
  assert.equal(lighting.region().end.w, 0); lighting.dispose();
});

test('light glow keeps depth testing, uses two draws per runway and releases all owned graphics', () => {
  const lighting = createRunwayLighting(POLISH_RUNWAYS[0], { beacon: false });
  const points = lighting.root.getObjectByName('runway-light-glows'), fixtures = lighting.root.getObjectByName('runway-lamp-fixtures');
  assert.equal(lighting.root.children.length, 2); assert(fixtures.isInstancedMesh);
  assert(points.material.depthTest); assert(!points.material.depthWrite);
  assert.equal([...points.geometry.attributes.lampKind.array].filter(kind => kind === 4).length, 0);
  let disposed = 0;
  for (const resource of [points.geometry, points.material, fixtures.geometry, fixtures.material]) resource.addEventListener('dispose', () => disposed++);
  lighting.dispose(); assert.equal(disposed, 4);
});

test('terrain illumination is bounded, updates existing materials and clears after leaving airports', () => {
  const lighting = createTerrainDayNight(), material = new MeshBasicMaterial(), terrain = new Mesh(new PlaneGeometry(10, 10), material);
  lighting.add(terrain);
  const shader = { uniforms: {}, vertexShader: '#include <project_vertex>', fragmentShader: '#include <opaque_fragment>' };
  material.onBeforeCompile(shader, {});
  const regions = Array.from({ length: 20 }, (_, i) => ({ start: new Vector4(i, 0, 0, 100), end: new Vector4(i, 0, 1000, 1) }));
  lighting.setAirportLights(regions);
  assert.equal(shader.uniforms.airportLightCount.value, 8);
  assert.equal(shader.uniforms.airportLightEnd.value[0].w, 1);
  regions[0].end.w = 0;
  assert.equal(shader.uniforms.airportLightEnd.value[0].w, 1, 'uniform values own their vectors');
  lighting.setAirportLights(regions); assert.equal(shader.uniforms.airportLightEnd.value[0].w, 0);
  lighting.setAirportLights([]); assert.equal(shader.uniforms.airportLightCount.value, 0);
  terrain.geometry.dispose(); material.dispose();
});
