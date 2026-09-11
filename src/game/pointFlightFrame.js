import { WGS84_ELLIPSOID, CAMERA_FRAME } from "3d-tiles-renderer";
import { Matrix4, Quaternion, Vector3 } from "three";
import { earthPosition } from "./trafficVisibility.js";

// Adapt every flight controller to the collectible system's world frame.
export function pointFlightFrame({ plane, spec, mapMatrix, mode, runway, clearance = 3, ground, weather }) {
  const position = earthPosition(plane.lat, plane.lon, plane.height, mapMatrix);
  const up = WGS84_ELLIPSOID.getCartographicToNormal(plane.lat, plane.lon, new Vector3()).transformDirection(mapMatrix);
  const level = WGS84_ELLIPSOID.getObjectFrame(plane.lat, plane.lon, plane.height, 0, 0, 0, new Matrix4(), CAMERA_FRAME).premultiply(mapMatrix);
  const levelRotation = new Quaternion().setFromRotationMatrix(level);
  const attitude = plane.isLunar
    ? new Quaternion().setFromRotationMatrix(mapMatrix).multiply(plane.orientationECEF)
    : new Quaternion().setFromRotationMatrix(WGS84_ELLIPSOID.getObjectFrame(plane.lat, plane.lon, plane.height, plane.heading, plane.pitch, -plane.roll, new Matrix4(), CAMERA_FRAME).premultiply(mapMatrix));
  let speed = plane.speed;
  const forward = new Vector3(0, spec.vertical ? 1 : 0, spec.vertical ? 0 : -1).applyQuaternion(attitude);
  if (!plane.isLunar) {
    // Use ground track, including crosswind and thermals, rather than the nose.
    const horizontal = Math.sqrt(Math.max(0, plane.speed ** 2 - (plane.verticalSpeed - (plane.weatherVertical ?? 0)) ** 2));
    const north = plane.groundNorthSpeed ?? (plane.northSpeed ?? Math.cos(plane.heading) * horizontal) + (plane.isBalloon ? 0 : weather?.north ?? 0);
    const east = plane.groundEastSpeed ?? (plane.eastSpeed ?? Math.sin(plane.heading) * horizontal) + (plane.isBalloon ? 0 : weather?.east ?? 0);
    forward.set(east, plane.verticalSpeed, -north).applyQuaternion(levelRotation);
    speed = forward.length(); forward.normalize();
  } else if (plane.isLunar && plane.velocity.length() > 3) {
    forward.set(plane.velocity.x, plane.velocity.z, -plane.velocity.y).applyQuaternion(levelRotation).normalize();
    speed = plane.velocity.length();
  }
  if (forward.lengthSq() < .5) forward.set(0, 1, 0).applyQuaternion(attitude);
  const frame = { position, forward, up, speed, size: spec.wingspan,
    right: new Vector3(1, 0, 0).applyQuaternion(attitude), balloon: !!plane.isBalloon, glider: !!plane.isSailplane, vertical: !!spec.vertical };
  if (mode === "landing" && runway) {
    const p = runway.coordinates(plane);
    frame.route = distance => {
      const along = -p.z + distance;
      const toAim = runway.definition.threshold + runway.definition.aimingPoint - along;
      if (toAim < 300) return null; // Keep the flare/touchdown zone clear.
      const height = toAim * Math.tan(3 * Math.PI / 180) + clearance;
      const target = runway.pose(0, along, height);
      const next = runway.pose(0, along + 10, height - 10 * Math.tan(3 * Math.PI / 180));
      const targetPosition = earthPosition(target.lat, target.lon, target.height, mapMatrix);
      return { position: targetPosition, normal: earthPosition(next.lat, next.lon, next.height, mapMatrix).sub(targetPosition).normalize(),
        radius: Math.min(Math.max(18, spec.wingspan * .9), height * .6) };
    };
  } else if (plane.isBalloon && weather) {
    // A balloon cannot steer into a crosswind. Predict its inertia as it settles
    // into the current wind layer, especially immediately after spawning.
    frame.route = distance => {
      const time = distance / Math.max(1, speed), lag = (1 - Math.exp(-.35 * time)) / .35;
      const north = weather.north * time + (plane.northSpeed - weather.north) * lag;
      const east = weather.east * time + (plane.eastSpeed - weather.east) * lag;
      const travel = new Vector3(east, plane.verticalSpeed * time, -north).applyQuaternion(levelRotation);
      const normal = new Vector3(weather.east + (plane.eastSpeed - weather.east) * Math.exp(-.35 * time), plane.verticalSpeed,
        -weather.north - (plane.northSpeed - weather.north) * Math.exp(-.35 * time)).applyQuaternion(levelRotation).normalize();
      return { position: position.clone().add(travel), normal };
    };
  }
  if (mode !== "landing" && ground && plane.height < 100000) {
    const inverse = mapMatrix.clone().invert();
    frame.clearTerrain = (point, radius) => {
      const cartographic = {};
      WGS84_ELLIPSOID.getPositionToCartographic(point.clone().applyMatrix4(inverse), cartographic);
      const elevation = ground(cartographic.lat, cartographic.lon, Math.max(2500, cartographic.height + 500));
      if (elevation !== null && Number.isFinite(elevation) && cartographic.height < elevation + radius + 12) {
        earthPosition(cartographic.lat, cartographic.lon, elevation + radius + 12, mapMatrix, point);
      }
    };
  }
  return frame;
}

export function pointMapMarkers(gates, mapMatrix) {
  const inverse = mapMatrix.clone().invert();
  return gates.map(gate => {
    const pose = {};
    WGS84_ELLIPSOID.getPositionToCartographic(gate.position.clone().applyMatrix4(inverse), pose);
    return { lat: pose.lat * 180 / Math.PI, lon: pose.lon * 180 / Math.PI, height: pose.height, value: gate.value };
  });
}
