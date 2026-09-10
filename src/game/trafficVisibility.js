import { WGS84_ELLIPSOID } from "3d-tiles-renderer";
import { Vector3 } from "three";

const radii = new Vector3(6378137, 6378137, 6356752.314245);
const start = new Vector3(), end = new Vector3(), delta = new Vector3(), closest = new Vector3();

export function earthPosition(lat, lon, height, mapMatrix, target = new Vector3()) {
  return WGS84_ELLIPSOID.getCartographicToPosition(lat, lon, height, target).applyMatrix4(mapMatrix);
}
export function trafficRange(fog) {
  return fog?.isFogExp2 && fog.density > 0 ? Math.min(75_000, Math.sqrt(-Math.log(.05)) / fog.density) : 25_000;
}
export function markerRadius(distance, fov, viewportHeight) {
  const metersPerPixel = distance * Math.tan(fov * Math.PI / 360) / Math.max(1, viewportHeight);
  return Math.max(.01, Math.min(250, 80 * metersPerPixel, Math.max(75, 12 * metersPerPixel)));
}
export function hiddenByEarth(cameraWorld, pointWorld, inverseMapMatrix) {
  start.copy(cameraWorld).applyMatrix4(inverseMapMatrix).divide(radii);
  end.copy(pointWorld).applyMatrix4(inverseMapMatrix).divide(radii);
  if (start.lengthSq() < 1) return false;
  delta.subVectors(end, start);
  const t = -start.dot(delta) / delta.lengthSq();
  if (!(t > 0 && t < 1)) return false;
  return closest.copy(start).addScaledVector(delta, t).lengthSq() < 1 - 1e-9;
}
