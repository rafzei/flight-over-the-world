import { Color, Group, InstancedMesh, Matrix4, MeshBasicMaterial, Quaternion, TorusGeometry, Vector3 } from "three";

const Z = new Vector3(0, 0, 1);
const gold = new Color(0xffc54a), bonus = new Color(0x70f5d3), flash = new Color(0xfff3c5);

export class PointVisuals {
  constructor(scene) {
    this.root = new Group(); this.root.name = "collectible-rings"; scene.add(this.root);
    this.geometry = new TorusGeometry(1, .027, 6, 64);
    this.material = new MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: true });
    this.mesh = new InstancedMesh(this.geometry, this.material, 32); this.mesh.frustumCulled = false;
    this.mesh.name = "point-gates"; this.mesh.raycast = () => {}; this.root.add(this.mesh);
    this.matrix = new Matrix4(); this.rotation = new Quaternion(); this.scale = new Vector3(); this.offset = new Vector3();
    this.bursts = []; this.reset();
  }
  collect(gate) { this.bursts.push({ ...gate, position: gate.position.clone(), age: 0 }); if (this.bursts.length > 16) this.bursts.shift(); }
  reset() { this.bursts.length = 0; this.mesh.count = 0; this.root.visible = false; }
  update(points, position, dt, visible, active) {
    this.root.visible = visible;
    if (!visible) return;
    this.root.position.copy(position);
    if (active) for (const burst of this.bursts) burst.age += dt;
    this.bursts = this.bursts.filter(burst => burst.age < .55);
    let i = 0;
    for (const gate of [...points.gates, ...this.bursts]) {
      const burst = gate.age !== undefined;
      this.offset.subVectors(gate.position, position);
      this.rotation.setFromUnitVectors(Z, gate.normal);
      this.scale.setScalar(gate.radius * (burst ? 1 + gate.age * 1.6 : 1));
      this.matrix.compose(this.offset, this.rotation, this.scale);
      this.mesh.setMatrixAt(i, this.matrix);
      this.mesh.setColorAt(i++, burst ? flash : gate.value === 200 ? bonus : gold);
    }
    this.mesh.count = i; this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  dispose() { this.root.removeFromParent(); this.geometry.dispose(); this.material.dispose(); }
}

export function createPointHud(root) {
  const score = root.querySelector("[data-points-score]"), best = root.querySelector("[data-points-best]");
  const series = root.querySelector("[data-points-series]"), target = root.querySelector("[data-points-target]");
  const arrow = root.querySelector("[data-points-arrow]"), notice = root.querySelector("[data-points-notice]");
  const title = root.querySelector("[data-points-title]"), trail = root.querySelector("button");
  const toGate = new Vector3();
  return { update(points, frame, { visible, active, camera, hunt = false, time = null }) {
    root.hidden = !visible;
    if (!visible) return;
    score.textContent = points.score.toLocaleString("en-US");
    best.textContent = `Best ${points.best.toLocaleString("en-US")}`;
    series.textContent = `${points.combo} in a row · ×${points.multiplier}`;
    const seconds = Math.max(0, Math.ceil(time ?? 0));
    title.textContent = `${hunt ? "POINT HUNT" : "FLIGHT POINTS"}${time === null ? "" : ` · ${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`}`;
    notice.textContent = points.elapsed < points.messageUntil ? points.message : "Gold 100 · mint 200 · every 10 rings +500";
    const gate = points.nextGate;
    if (gate) {
      toGate.subVectors(gate.position, frame.position);
      const distance = toGate.length(), altitude = toGate.dot(frame.up);
      target.textContent = `${distance > 1000 ? `${(distance / 1000).toFixed(1)} km` : `${Math.round(distance)} m`} · ${altitude > 8 ? `↑ ${Math.round(altitude)} m` : altitude < -8 ? `↓ ${Math.round(-altitude)} m` : "same height"}`;
      if (camera) {
        toGate.applyQuaternion(camera.quaternion.clone().invert());
        arrow.style.transform = `rotate(${Math.atan2(toGate.x, toGate.y) * 180 / Math.PI}deg)`;
        arrow.textContent = toGate.z > 0 ? "↶" : "↑";
      }
    } else { target.textContent = "Continue flying for a new trail"; arrow.textContent = "◇"; }
    trail.disabled = !active || points.elapsed - points.trailAt < 3;
  } };
}
