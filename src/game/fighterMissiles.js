import { openF35WeaponBay } from "./f35.js";
import {
  AdditiveBlending, BufferGeometry, ConeGeometry, DynamicDrawUsage,
  Float32BufferAttribute, Line, LineBasicMaterial, Matrix4, Mesh,
  MeshBasicMaterial, Raycaster, Vector3,
} from "three";

const RELOAD_SECONDS = 4;
const SHOT_INTERVAL = .3;
const LIFETIME = 20;
const MAX_ACTIVE = 32;
const TRAIL_POINTS = 48;
const ORDER = [0, 2, 1, 3];

// Missile meshes share their rack's geometry and materials. Only the flame and
// trail are owned by this system; reset it before disposing a vehicle model.
export function createFighterMissiles(scene, { onImpact = () => {} } = {}) {
  const projectiles = new Set();
  const racks = new Map();
  const ray = new Raycaster();
  ray.firstHitOnly = true;
  const movement = new Vector3();
  let time = 0;

  function rack(root) {
    if (!root) return null;
    if (racks.has(root)) return racks.get(root);
    const mounts = [];
    root.traverse(node => { if (node.userData.fighterMissile) mounts.push(node); });
    if (!mounts.length) return null; // A model may still be loading.
    mounts.sort((a, b) => ORDER.indexOf(a.userData.station) - ORDER.indexOf(b.userData.station));
    const entry = { mounts, readyAt: new Map(), next: 0, nextShot: 0 };
    racks.set(root, entry);
    return entry;
  }

  function status(root) {
    const entry = rack(root);
    if (!entry) return { available: 0, total: 0, canFire: false };
    const available = entry.mounts.filter(mount => (entry.readyAt.get(mount) ?? 0) <= time).length;
    return { available, total: entry.mounts.length, canFire: available > 0 && time >= entry.nextShot && projectiles.size < MAX_ACTIVE };
  }

  function remove(projectile) {
    projectile.mesh.removeFromParent();
    projectile.trail.removeFromParent();
    projectile.flame.geometry.dispose();
    projectile.flame.material.dispose();
    projectile.trail.geometry.dispose();
    projectile.trail.material.dispose();
    projectiles.delete(projectile);
  }

  function fire(root, { speed = 0, up = new Vector3(0, 1, 0), station, poseMatrix } = {}) {
    const entry = rack(root);
    if (!entry || !status(root).canFire) return null;
    let index = -1;
    for (let i = 0; i < entry.mounts.length; i++) {
      const candidate = (entry.next + i) % entry.mounts.length;
      const mount = entry.mounts[candidate];
      if (station !== undefined && mount.userData.station !== station) continue;
      if ((entry.readyAt.get(mount) ?? 0) <= time) { index = candidate; break; }
    }
    if (index < 0) return null;
    const mount = entry.mounts[index];
    root.updateWorldMatrix(true, true);
    const transform = mount.matrixWorld.clone();
    if (poseMatrix) transform.premultiply(new Matrix4().copy(root.matrixWorld).invert()).premultiply(poseMatrix);
    const mesh = mount.clone(true);
    mesh.name = "launched-fighter-missile";
    transform.decompose(mesh.position, mesh.quaternion, mesh.scale);
    mesh.visible = true;
    mesh.traverse(node => { node.castShadow = false; });
    const direction = new Vector3(0, 0, 1).applyQuaternion(mesh.quaternion).normalize();
    const localUp = up.clone().normalize();
    mesh.position.addScaledVector(localUp, -(mount.userData.ejectDrop ?? .2));
    if (mount.userData.weaponBay !== undefined) openF35WeaponBay(root, mount.userData.weaponBay);
    scene.add(mesh);

    const flame = new Mesh(new ConeGeometry(.18, 1.8, 10), new MeshBasicMaterial({
      color: 0xffbf65, transparent: true, opacity: .9, blending: AdditiveBlending,
      depthWrite: false, toneMapped: false,
    }));
    flame.rotation.x = -Math.PI / 2;
    flame.position.z = -mount.userData.length / 2 - .85;
    mesh.add(flame);
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(TRAIL_POINTS * 3), 3).setUsage(DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    const trail = new Line(geometry, new LineBasicMaterial({ color: 0xffead2, transparent: true, opacity: .65, depthWrite: false, toneMapped: false }));
    trail.frustumCulled = false;
    scene.add(trail);
    const projectile = {
      root, mesh, flame, trail, direction, up: localUp, age: 0,
      velocity: direction.clone().multiplyScalar(Math.max(0, speed) + 180).addScaledVector(localUp, -4),
      history: Array.from({ length: TRAIL_POINTS }, () => mesh.position.clone()), count: 1, head: 0,
    };
    projectiles.add(projectile);
    mount.visible = false;
    entry.readyAt.set(mount, time + RELOAD_SECONDS);
    entry.nextShot = time + SHOT_INTERVAL;
    entry.next = (index + 1) % entry.mounts.length;
    return { station: mount.userData.station };
  }

  function update(dt, { terrain, active = true, visible = true } = {}) {
    for (const projectile of projectiles) projectile.mesh.visible = projectile.trail.visible = visible;
    if (!active || !(dt > 0)) return;
    time += dt;
    for (const entry of racks.values()) for (const mount of entry.mounts) {
      if ((entry.readyAt.get(mount) ?? 0) <= time) mount.visible = true;
    }
    for (const projectile of projectiles) {
      projectile.age += dt;
      if (projectile.age >= LIFETIME) { remove(projectile); continue; }
      projectile.velocity.addScaledVector(projectile.direction, 120 * dt).addScaledVector(projectile.up, -9.81 * dt);
      if (projectile.velocity.length() > 1400) projectile.velocity.setLength(1400);
      movement.copy(projectile.velocity).multiplyScalar(dt);
      const distance = movement.length();
      if (terrain && distance > 0) {
        // Sweep the whole step, so fast missiles cannot skip thin roofs/terrain.
        ray.set(projectile.mesh.position, movement.clone().normalize());
        ray.far = distance + .12;
        const hit = ray.intersectObject(terrain, true)[0];
        if (hit) {
          remove(projectile);
          onImpact(hit.point.clone(), projectile.up.clone());
          continue;
        }
      }
      projectile.mesh.position.add(movement);
      projectile.mesh.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), projectile.velocity.clone().normalize());
      projectile.flame.scale.setScalar(1 + Math.sin(projectile.age * 57) * .12);
      projectile.head = (projectile.head + 1) % TRAIL_POINTS;
      projectile.history[projectile.head].copy(projectile.mesh.position);
      projectile.count = Math.min(TRAIL_POINTS, projectile.count + 1);
      const positions = projectile.trail.geometry.attributes.position;
      projectile.trail.position.copy(projectile.mesh.position);
      for (let i = 0; i < projectile.count; i++) {
        const index = (projectile.head - projectile.count + 1 + i + TRAIL_POINTS) % TRAIL_POINTS;
        movement.copy(projectile.history[index]).sub(projectile.mesh.position);
        positions.setXYZ(i, movement.x, movement.y, movement.z);
      }
      positions.needsUpdate = true;
      projectile.trail.geometry.setDrawRange(0, projectile.count);
    }
  }

  function removeVehicle(root) {
    for (const projectile of projectiles) if (projectile.root === root) remove(projectile);
    const entry = racks.get(root);
    if (entry) for (const mount of entry.mounts) mount.visible = true;
    racks.delete(root);
  }

  function reset() {
    for (const root of [...racks.keys()]) removeVehicle(root);
    time = 0;
  }

  return { fire, status, update, removeVehicle, reset, dispose: reset };
}
