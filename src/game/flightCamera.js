import { Box3, Vector3 } from "three";

export const FLIGHT_CAMERAS = [
  { name: "Chase", distance: 1 },
  { name: "Chase 3×", distance: 3 },
  { name: "Chase 5×", distance: 5 },
  { name: "Nose", distance: 0 },
  { name: "Fixed tracking", fixed: true },
  { name: "Front", front: true },
];

export class FlightCamera {
  constructor() {
    this.mode = 0;
    this.mouseOrbit = null;
    this.minimumOrbitDistance = 8;
    this.position = new Vector3();
    this.target = new Vector3();
    this.up = new Vector3(0, 1, 0);
    this.noseOffset = new Vector3(0, 0, -4);
  }

  get fixed() {
    return !this.mouseOrbit && FLIGHT_CAMERAS[this.mode].fixed === true;
  }

  cycle(camera) {
    this.mouseOrbit = null;
    this.mode = (this.mode + 1) % FLIGHT_CAMERAS.length;
    if (this.fixed && camera) {
      // Capture the rendered viewpoint at the keypress, not the next plane pose.
      this.position.copy(camera.position);
      this.up.copy(camera.up);
    }
  }

  setModel(model, { vertical = false, basket = false } = {}) {
    this.mouseOrbit = null;
    this.vertical = vertical;
    // Called after orienting, scaling and centering the model, before placing
    // it on Earth. Stay ahead of its nose, including propellers and antennas.
    const bounds = new Box3().setFromObject(model);
    if (!bounds.isEmpty()) {
      this.minimumOrbitDistance = Math.max(3, bounds.getSize(new Vector3()).length() * .65);
      if (basket) this.noseOffset.set(0, bounds.min.y + 1.65, -1.1);
      else if (vertical) this.noseOffset.set(0, bounds.max.y + .75, 0);
      else this.noseOffset.set(0, 0, bounds.min.z - 0.75);
    }
  }

  beginMouseOrbit(camera, planePosition, levelQuaternion) {
    const offset = camera.position.clone().sub(planePosition).applyQuaternion(levelQuaternion.clone().invert());
    const radius = Math.max(this.minimumOrbitDistance, offset.length());
    this.mouseOrbit = { radius, yaw: Math.atan2(offset.x, offset.z), pitch: Math.asin(Math.max(-1, Math.min(1, offset.y / radius))) };
  }

  rotateMouseOrbit(dx, dy) {
    if (!this.mouseOrbit || !Number.isFinite(dx) || !Number.isFinite(dy)) return;
    this.mouseOrbit.yaw = (this.mouseOrbit.yaw - dx * .006) % (Math.PI * 2);
    this.mouseOrbit.pitch = Math.max(-Math.PI / 2 + .06, Math.min(Math.PI / 2 - .06, this.mouseOrbit.pitch + dy * .006));
  }

  update(baseOffset, planePosition, planeQuaternion, levelQuaternion) {
    if (this.mouseOrbit) {
      const { radius, yaw, pitch } = this.mouseOrbit, horizontal = Math.cos(pitch) * radius;
      this.position.set(Math.sin(yaw) * horizontal, Math.sin(pitch) * radius, Math.cos(yaw) * horizontal)
        .applyQuaternion(levelQuaternion).add(planePosition);
      this.target.copy(planePosition);
      this.up.set(0, 1, 0).applyQuaternion(levelQuaternion);
      return;
    }
    if (this.fixed) {
      // Keep this point and its horizon until C is pressed again; only aim moves.
      this.target.copy(planePosition);
      return;
    }
    const { distance, front } = FLIGHT_CAMERAS[this.mode];
    if (front) {
      // Outside the nose, looking back at the vehicle. Vertical rockets use +Y
      // as their nose axis; aircraft keep the same level horizon as chase views.
      const orientation = this.vertical ? planeQuaternion : levelQuaternion;
      this.position.set(
        baseOffset[0],
        this.vertical ? baseOffset[2] : baseOffset[1],
        this.vertical ? -baseOffset[1] : -baseOffset[2]
      ).applyQuaternion(orientation).add(planePosition);
      this.target.copy(planePosition);
      this.up.set(0, this.vertical ? 0 : 1, this.vertical ? -1 : 0).applyQuaternion(orientation);
      return;
    }
    if (distance === 0) {
      this.position.copy(this.noseOffset).applyQuaternion(planeQuaternion).add(planePosition);
      this.target.set(0, this.vertical ? 100 : 0, this.vertical ? 0 : -100).applyQuaternion(planeQuaternion).add(this.position);
      this.up.set(0, this.vertical ? 0 : 1, this.vertical ? -1 : 0).applyQuaternion(planeQuaternion);
      return;
    }
    this.position.fromArray(baseOffset).multiplyScalar(distance)
      .applyQuaternion(levelQuaternion).add(planePosition);
    // Scale the look-ahead too, preserving the current framing at every zoom.
    this.target.set(0, this.vertical ? 2 : .5, this.vertical ? 0 : -baseOffset[2] * 1.6).multiplyScalar(distance)
      .applyQuaternion(levelQuaternion).add(planePosition);
    this.up.set(0, 1, 0).applyQuaternion(levelQuaternion);
  }
}


// Capture only left-mouse drags that start on the flight canvas. UI widgets and
// the existing map OrbitControls keep their own pointer input.
export function bindFlightCameraDrag(canvas, controller, getState) {
  const host = canvas.ownerDocument?.defaultView ?? globalThis;
  let drag = null;
  const end = event => {
    if (!drag || (event?.pointerId != null && event.pointerId !== drag.id)) return;
    const id = drag.id; drag = null;
    if (canvas.hasPointerCapture?.(id)) canvas.releasePointerCapture(id);
    canvas.classList.remove('camera-dragging');
  };
  const down = event => {
    if (event.button !== 0 || event.pointerType === 'touch' || event.isPrimary === false || !getState().enabled) return;
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY, started: false };
    canvas.setPointerCapture(event.pointerId);
    event.preventDefault();
  };
  const move = event => {
    if (!drag || event.pointerId !== drag.id) return;
    const state = getState();
    if (!state.enabled || !(event.buttons & 1)) { end(event); return; }
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.started) {
      if (Math.hypot(dx, dy) < 3) return;
      controller.beginMouseOrbit(state.camera, state.position, state.frame);
      state.onStart?.(); drag.started = true;
      canvas.classList.add('camera-dragging');
    }
    controller.rotateMouseOrbit(dx, dy);
    if (Number.isFinite(state.minimumPitch)) controller.mouseOrbit.pitch = Math.max(state.minimumPitch, controller.mouseOrbit.pitch);
    drag.x = event.clientX; drag.y = event.clientY;
    event.preventDefault();
  };
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('lostpointercapture', end);
  host.addEventListener('pointerup', end);
  host.addEventListener('pointercancel', end);
  host.addEventListener('blur', end);
  return () => {
    end(); canvas.removeEventListener('pointerdown', down); canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('lostpointercapture', end);
    host.removeEventListener('pointerup', end); host.removeEventListener('pointercancel', end); host.removeEventListener('blur', end);
  };
}
