import { Raycaster, Vector3 } from "three";

// TilesGroup raycasts active tiles. A parent held on screen while its children
// load can be visible without being active, and must still be solid.
export function raycastTerrain(ray, terrain) {
  const hits = ray.intersectObject(terrain, true);
  const renderer = terrain.tilesRenderer;
  if (renderer) {
    for (const tile of renderer.visibleTiles) {
      if (!renderer.activeTiles.has(tile) && tile.engineData?.scene) {
        ray.intersectObject(tile.engineData.scene, true, hits);
      }
    }
  }
  return hits.filter(hit => !hit.object.userData.vehicleShadowReceiver)
    .sort((a, b) => a.distance - b.distance);
}

export function createVehicleCollisionDetector() {
  const ray = new Raycaster();
  ray.firstHitOnly = false;
  const direction = new Vector3();
  const side = new Vector3();
  const rimUp = new Vector3();
  const origin = new Vector3();
  const down = new Vector3();
  const offsets = Array.from({ length: 5 }, () => new Vector3());

  function contact(terrain, position, up, radius) {
    origin.copy(position).addScaledVector(up, radius);
    down.copy(up).negate();
    ray.set(origin, down);
    ray.far = radius * 2;
    const hit = raycastTerrain(ray, terrain)[0];
    return hit ? {
      point: hit.point.clone(),
      position: position.clone().addScaledVector(up, radius * 2 - hit.distance),
      fraction: 0,
    } : null;
  }

  function sweep(terrain, from, to, up, radius = 4.5) {
    if (!terrain) return null;
    const initialContact = contact(terrain, from, up, radius);
    if (initialContact) return initialContact;

    direction.subVectors(to, from);
    const distance = direction.length();
    if (distance > 1e-8) {
      direction.divideScalar(distance);
      side.crossVectors(direction, up);
      if (side.lengthSq() < 1e-8) {
        side.crossVectors(direction, Math.abs(direction.x) < .9
          ? new Vector3(1, 0, 0) : new Vector3(0, 0, 1));
      }
      side.normalize();
      rimUp.crossVectors(side, direction).normalize();
      offsets[1].copy(side).multiplyScalar(radius);
      offsets[2].copy(side).multiplyScalar(-radius);
      offsets[3].copy(rimUp).multiplyScalar(radius);
      offsets[4].copy(rimUp).multiplyScalar(-radius);
      let earliest = null;
      // Sweep the centre and body edges through the entire physics step.
      // The centre ray also covers the leading end of the collision body.
      for (let i = 0; i < offsets.length; i++) {
        const reach = i === 0 ? radius : 0;
        origin.copy(from).add(offsets[i]);
        ray.set(origin, direction);
        ray.far = distance + reach;
        const hit = raycastTerrain(ray, terrain)[0];
        if (!hit) continue;
        const fraction = Math.max(0, (hit.distance - reach) / distance);
        if (!earliest || fraction < earliest.fraction) {
          earliest = {
            point: hit.point.clone(),
            position: from.clone().lerp(to, fraction),
            fraction,
          };
        }
      }
      if (earliest) return earliest;
    }
    return contact(terrain, to, up, radius);
  }

  return { sweep };
}
