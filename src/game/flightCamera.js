import { Box3, Vector3 } from "three";

export const FLIGHT_CAMERAS = [
  { name: "Chase", distance: 1 },
  { name: "Chase 3×", distance: 3 },
  { name: "Chase 5×", distance: 5 },
  { name: "Nose", distance: 0 },
];

export class FlightCamera {
  constructor() {
    this.mode = 0;
    this.position = new Vector3();
    this.target = new Vector3();
    this.up = new Vector3(0, 1, 0);
    this.noseOffset = new Vector3(0, 0, -4);
  }

  cycle() {
    this.mode = (this.mode + 1) % FLIGHT_CAMERAS.length;
  }

  setModel(model) {
    // Called after orienting, scaling and centering the model, before placing
    // it on Earth. Stay ahead of its nose, including propellers and antennas.
    const bounds = new Box3().setFromObject(model);
    if (!bounds.isEmpty()) this.noseOffset.set(0, 0, bounds.min.z - 0.75);
  }

  update(baseOffset, planePosition, planeQuaternion, levelQuaternion) {
    const { distance } = FLIGHT_CAMERAS[this.mode];
    if (distance === 0) {
      this.position.copy(this.noseOffset).applyQuaternion(planeQuaternion).add(planePosition);
      this.target.set(0, 0, -100).applyQuaternion(planeQuaternion).add(this.position);
      this.up.set(0, 1, 0).applyQuaternion(planeQuaternion);
      return;
    }
    this.position.fromArray(baseOffset).multiplyScalar(distance)
      .applyQuaternion(levelQuaternion).add(planePosition);
    // Scale the look-ahead too, preserving the current framing at every zoom.
    this.target.set(0, 0.5, -baseOffset[2] * 1.6).multiplyScalar(distance)
      .applyQuaternion(levelQuaternion).add(planePosition);
    this.up.set(0, 1, 0).applyQuaternion(levelQuaternion);
  }
}
