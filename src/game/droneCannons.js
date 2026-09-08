import {
  AdditiveBlending, BufferGeometry, ConeGeometry, DynamicDrawUsage,
  Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Mesh,
  MeshBasicMaterial, Raycaster, Vector3,
} from "three";

const BURST_SECONDS = 2;
const SHOTS_PER_CANNON = 48;
const SHOT_INTERVAL = BURST_SECONDS / SHOTS_PER_CANNON;
const COOLDOWN = .35;
const BULLET_SPEED = 850;
const BULLET_LIFETIME = 4;
const MAX_BULLETS = 256;
const MAX_IMPACTS = 64;
const SPARKS_PER_IMPACT = 6;
const IMPACT_LIFETIME = .4;

// Two batched draw calls, regardless of the number of bullets and impact sparks.
// Positions remain doubles on the CPU and are uploaded relative to a nearby
// origin, preserving muzzle/tracer precision at Earth-sized world coordinates.
export function createDroneCannons(scene, { onShot, onImpact } = {}) {
  const weapons = new Map();
  let bullets = [], impacts = [], time = 0, disposed = false;
  const effects = new Group(); effects.name = "drone-cannon-effects";
  const ray = new Raycaster(); ray.firstHitOnly = true;
  const movement = new Vector3(), direction = new Vector3(), offset = new Vector3();
  const flashGeometry = new ConeGeometry(.17, .75, 7);
  flashGeometry.rotateX(-Math.PI / 2); flashGeometry.translate(0, 0, -.375);
  const flashMaterial = new MeshBasicMaterial({
    color: 0xffdf83, blending: AdditiveBlending, transparent: true,
    depthWrite: false, toneMapped: false,
  });

  function batch(name, count) {
    const geometry = new BufferGeometry();
    for (const attribute of ["position", "color"]) geometry.setAttribute(attribute,
      new Float32BufferAttribute(new Float32Array(count * 6), 3).setUsage(DynamicDrawUsage));
    geometry.setDrawRange(0, 0);
    const mesh = new LineSegments(geometry, new LineBasicMaterial({
      vertexColors: true, blending: AdditiveBlending, transparent: true,
      depthWrite: false, toneMapped: false,
    }));
    mesh.name = name; mesh.frustumCulled = false; effects.add(mesh);
    return mesh;
  }
  const tracers = batch("drone-bullet-tracers", MAX_BULLETS);
  const sparks = batch("drone-impact-sparks", MAX_IMPACTS * SPARKS_PER_IMPACT);

  function weapon(root) {
    if (!root || disposed) return null;
    if (weapons.has(root)) return weapons.get(root);
    const cannons = [];
    root.traverse(node => { if (node.userData.combatDrone) cannons.push(...node.userData.combatDrone.cannons); });
    if (!cannons.length) return null; // Ignore the placeholder while loading.
    const entry = { root, cannons, flashes: [], age: BURST_SECONDS, nextShot: 0, readyAt: 0, firing: false };
    for (const cannon of cannons) {
      const flash = new Mesh(flashGeometry, flashMaterial);
      flash.name = "drone-muzzle-flash"; flash.userData.noVehicleShadow = true;
      flash.visible = false; cannon.muzzles[0].add(flash); entry.flashes.push(flash);
    }
    weapons.set(root, entry);
    return entry;
  }

  function status(root) {
    const entry = weapon(root);
    return { firing: !!entry?.firing, canFire: !!entry && !entry.firing && time >= entry.readyAt };
  }

  function aim(entry, age) {
    for (const cannon of entry.cannons) {
      cannon.turret.rotation.y = cannon.direction * Math.PI * 2 * age / BURST_SECONDS;
      cannon.barrels.rotation.z = age * Math.PI * 40;
    }
  }

  function emit(entry, shot) {
    aim(entry, shot * SHOT_INTERVAL);
    entry.root.updateWorldMatrix(true, true);
    const inheritedVelocity = new Vector3(0, 0, -1).transformDirection(entry.root.matrixWorld).multiplyScalar(entry.speed);
    for (const [index, cannon] of entry.cannons.entries()) {
      const muzzle = cannon.muzzles[shot % cannon.muzzles.length];
      const position = muzzle.getWorldPosition(new Vector3());
      const heading = new Vector3(0, 0, -1).transformDirection(muzzle.matrixWorld);
      if (bullets.length >= MAX_BULLETS) bullets.shift();
      bullets.push({
        root: entry.root, position, velocity: heading.clone().multiplyScalar(BULLET_SPEED).add(inheritedVelocity),
        up: entry.up, age: 0, distance: 0,
      });
      muzzle.add(entry.flashes[index]);
      entry.flashes[index].visible = true;
      onShot?.({ root: entry.root, cannon: index, muzzle, position: position.clone(), direction: heading });
    }
  }

  function fire(root, { up = new Vector3(0, 1, 0), speed = 0 } = {}) {
    const entry = weapon(root);
    if (!entry || !status(root).canFire) return false;
    entry.up = up.clone().normalize(); entry.speed = Math.max(0, speed);
    entry.age = 0; entry.nextShot = 1; entry.firing = true;
    entry.readyAt = time + BURST_SECONDS + COOLDOWN;
    emit(entry, 0);
    render();
    return true;
  }

  function cancelBurst(root) {
    const entry = weapons.get(root);
    if (!entry) return;
    entry.firing = false; aim(entry, 0);
    for (const flash of entry.flashes) flash.visible = false;
  }

  function impact(bullet, hit) {
    const normal = hit.face?.normal.clone().transformDirection(hit.object.matrixWorld) ?? bullet.up.clone();
    if (normal.dot(bullet.velocity) > 0) normal.negate();
    const tangent = new Vector3().crossVectors(normal, Math.abs(normal.y) < .9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0)).normalize();
    const side = new Vector3().crossVectors(normal, tangent);
    if (impacts.length >= MAX_IMPACTS) impacts.shift();
    impacts.push({ root: bullet.root, position: hit.point.clone().addScaledVector(normal, .04), age: 0,
      velocities: Array.from({ length: SPARKS_PER_IMPACT }, (_, i) => {
        const angle = i * Math.PI * 2 / SPARKS_PER_IMPACT;
        return normal.clone().multiplyScalar(3 + i * .45)
          .addScaledVector(tangent, Math.cos(angle) * 5).addScaledVector(side, Math.sin(angle) * 5);
      }),
    });
    onImpact?.(hit.point.clone(), bullet.up.clone());
  }

  function advance(bullet, dt, terrain) {
    const step = Math.max(0, Math.min(dt, BULLET_LIFETIME - bullet.age));
    movement.copy(bullet.velocity).multiplyScalar(step).addScaledVector(bullet.up, -4.905 * step * step);
    const distance = movement.length();
    if (terrain && distance > 0) {
      // Sweep the complete movement segment, including fast crossings of thin roofs.
      ray.set(bullet.position, direction.copy(movement).normalize()); ray.far = distance;
      const hit = ray.intersectObject(terrain, true)[0];
      if (hit) { impact(bullet, hit); return false; }
    }
    bullet.position.add(movement); bullet.velocity.addScaledVector(bullet.up, -9.81 * step);
    bullet.age += step; bullet.distance += distance;
    return bullet.age < BULLET_LIFETIME;
  }

  function segment(mesh, index, start, end, brightness, green, blue) {
    const positions = mesh.geometry.attributes.position, colors = mesh.geometry.attributes.color;
    positions.setXYZ(index * 2, start.x, start.y, start.z);
    positions.setXYZ(index * 2 + 1, end.x, end.y, end.z);
    colors.setXYZ(index * 2, brightness, green * brightness, blue * brightness);
    colors.setXYZ(index * 2 + 1, brightness * .25, green * brightness * .25, blue * brightness * .25);
  }

  function render() {
    if (disposed) return;
    const origin = bullets[0]?.position ?? impacts[0]?.position;
    if (!origin) {
      tracers.geometry.setDrawRange(0, 0); sparks.geometry.setDrawRange(0, 0);
      effects.removeFromParent(); return;
    }
    if (!effects.parent) scene.add(effects);
    effects.position.copy(origin);
    for (const [i, bullet] of bullets.entries()) {
      offset.copy(bullet.position).sub(origin);
      movement.copy(bullet.velocity).normalize().multiplyScalar(-Math.min(10, bullet.distance));
      movement.add(offset);
      segment(tracers, i, offset, movement, 1, .83, .42);
    }
    let sparkCount = 0;
    for (const hit of impacts) for (const velocity of hit.velocities) {
      offset.copy(hit.position).sub(origin).addScaledVector(velocity, hit.age);
      movement.copy(offset).addScaledVector(velocity, -.035);
      segment(sparks, sparkCount++, offset, movement, 1 - hit.age / IMPACT_LIFETIME, .52, .12);
    }
    for (const [mesh, count] of [[tracers, bullets.length], [sparks, sparkCount]]) {
      mesh.geometry.setDrawRange(0, count * 2);
      mesh.geometry.attributes.position.needsUpdate = mesh.geometry.attributes.color.needsUpdate = true;
    }
  }

  function update(dt, { terrain, active = true, visible = true } = {}) {
    if (disposed) return;
    effects.visible = visible;
    if (active && dt > 0) {
      time += dt;
      impacts = impacts.filter(hit => (hit.age += dt) < IMPACT_LIFETIME);
      bullets = bullets.filter(bullet => advance(bullet, dt, terrain));
      for (const entry of weapons.values()) {
        if (!entry.firing) continue;
        const frameEnd = entry.age + dt;
        entry.age = Math.min(BURST_SECONDS, frameEnd);
        while (entry.nextShot < SHOTS_PER_CANNON && entry.nextShot * SHOT_INTERVAL <= entry.age + 1e-8) {
          const shotAge = entry.nextShot * SHOT_INTERVAL;
          emit(entry, entry.nextShot++);
          // Newly emitted rounds only move for the remaining fraction of this frame.
          const fresh = bullets.splice(-entry.cannons.length);
          for (const bullet of fresh) if (advance(bullet, frameEnd - shotAge, terrain)) bullets.push(bullet);
        }
        aim(entry, entry.age);
        if (entry.age >= BURST_SECONDS) cancelBurst(entry.root);
      }
    }
    for (const entry of weapons.values()) for (const flash of entry.flashes) {
      flash.visible = visible && entry.firing && entry.age - (entry.nextShot - 1) * SHOT_INTERVAL < .023;
    }
    render();
  }

  function removeVehicle(root) {
    cancelBurst(root);
    for (const flash of weapons.get(root)?.flashes ?? []) flash.removeFromParent();
    weapons.delete(root);
    bullets = bullets.filter(bullet => bullet.root !== root);
    impacts = impacts.filter(hit => hit.root !== root);
    render();
  }

  function reset() {
    for (const root of [...weapons.keys()]) removeVehicle(root);
    time = 0;
  }

  function dispose() {
    if (disposed) return;
    reset(); disposed = true;
    for (const mesh of [tracers, sparks]) { mesh.geometry.dispose(); mesh.material.dispose(); }
    flashGeometry.dispose(); flashMaterial.dispose();
  }

  return { fire, status, update, cancelBurst, removeVehicle, reset, dispose };
}
