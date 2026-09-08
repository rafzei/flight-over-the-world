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
    this.position = new Vector3();
    this.target = new Vector3();
    this.up = new Vector3(0, 1, 0);
    this.noseOffset = new Vector3(0, 0, -4);
  }

  get fixed() {
    return FLIGHT_CAMERAS[this.mode].fixed === true;
  }

  cycle(camera) {
    this.mode = (this.mode + 1) % FLIGHT_CAMERAS.length;
    if (this.fixed && camera) {
      // Capture the rendered viewpoint at the keypress, not the next plane pose.
      this.position.copy(camera.position);
      this.up.copy(camera.up);
    }
  }

  setModel(model, { vertical = false } = {}) {
    this.vertical = vertical;
    // Called after orienting, scaling and centering the model, before placing
    // it on Earth. Stay ahead of its nose, including propellers and antennas.
    const bounds = new Box3().setFromObject(model);
    if (!bounds.isEmpty()) {
      if (vertical) this.noseOffset.set(0, bounds.max.y + .75, 0);
      else this.noseOffset.set(0, 0, bounds.min.z - 0.75);
    }
  }

  update(baseOffset, planePosition, planeQuaternion, levelQuaternion) {
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
