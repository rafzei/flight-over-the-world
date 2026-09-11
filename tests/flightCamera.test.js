import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { FlightCamera, bindFlightCameraDrag } from '../src/game/flightCamera.js';

test('mouse orbit begins from the actual camera, rotates around the vehicle, follows it and resets with C', () => {
  const flight = new FlightCamera(), camera = new PerspectiveCamera();
  const position = new Vector3(4e12, -3e12, 8e11), frame = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), .7);
  camera.position.copy(new Vector3(20, 15, 70).applyQuaternion(frame).add(position));
  flight.beginMouseOrbit(camera, position, frame); flight.update([0, 9, 43], position, frame, frame);
  assert(flight.position.distanceTo(camera.position) < .002, 'no viewpoint jump on grabbing');
  const radius = flight.position.distanceTo(position);
  flight.rotateMouseOrbit(160, 80); flight.update([0, 9, 43], position, frame, frame);
  assert(Math.abs(flight.position.distanceTo(position) - radius) < .002);
  assert(flight.position.distanceTo(camera.position) > 30);
  const offset = flight.position.clone().sub(position), moved = position.clone().add(new Vector3(1000, 500, 200));
  flight.update([0, 9, 43], moved, frame, frame);
  assert(flight.position.clone().sub(moved).distanceTo(offset) < .002);
  flight.rotateMouseOrbit(0, 1e6); assert(flight.mouseOrbit.pitch < Math.PI / 2);
  flight.rotateMouseOrbit(0, -2e6); assert(flight.mouseOrbit.pitch > -Math.PI / 2);
  flight.cycle(camera); assert.equal(flight.mouseOrbit, null);
});

test('only a held left mouse drag controls flight view, with release, blur, pause and map guards', () => {
  const host = new EventTarget(), canvas = new EventTarget(), flight = new FlightCamera();
  canvas.ownerDocument = { defaultView: host }; canvas.classList = { add(){}, remove(){} };
  const captured = new Set(); canvas.setPointerCapture = id => captured.add(id);
  canvas.hasPointerCapture = id => captured.has(id); canvas.releasePointerCapture = id => captured.delete(id);
  const camera = new PerspectiveCamera(); camera.position.set(0, 10, 50);
  const state = { enabled: true, camera, position: new Vector3(), frame: new Quaternion() };
  const dispose = bindFlightCameraDrag(canvas, flight, () => state);
  const event = (target, type, props = {}) => target.dispatchEvent(Object.assign(new Event(type, {cancelable:true}), {pointerId:1,pointerType:'mouse',button:0,buttons:1,clientX:10,clientY:10,...props}));
  event(canvas,'pointermove',{clientX:200}); assert.equal(flight.mouseOrbit,null);
  event(canvas,'pointerdown',{button:2}); event(canvas,'pointermove',{clientX:200,buttons:2}); assert.equal(flight.mouseOrbit,null);
  event(canvas,'pointerdown',{pointerType:'touch'}); event(canvas,'pointermove',{clientX:200}); assert.equal(flight.mouseOrbit,null);
  state.enabled=false; event(canvas,'pointerdown'); event(canvas,'pointermove',{clientX:200}); assert.equal(flight.mouseOrbit,null);
  state.enabled=true; event(canvas,'pointerdown'); event(canvas,'pointermove',{clientX:11}); assert.equal(flight.mouseOrbit,null,'a click does not switch camera');
  event(canvas,'pointermove',{clientX:100}); assert(flight.mouseOrbit);
  const yaw = flight.mouseOrbit.yaw; event(host,'pointerup'); event(canvas,'pointermove',{clientX:300,buttons:0}); assert.equal(flight.mouseOrbit.yaw,yaw);
  event(canvas,'pointerdown'); host.dispatchEvent(new Event('blur')); event(canvas,'pointermove',{clientX:300}); assert.equal(flight.mouseOrbit.yaw,yaw);
  event(canvas,'pointerdown'); state.enabled=false; event(canvas,'pointermove',{clientX:300}); assert.equal(flight.mouseOrbit.yaw,yaw);
  assert.equal(captured.size,0); dispose();
});
