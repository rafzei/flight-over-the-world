import { DynamicDrawUsage, Frustum, Group, InstancedMesh, Matrix4, MeshBasicMaterial, Sphere, SphereGeometry, Vector3 } from "three";
import { earthPosition, hiddenByEarth, markerRadius, trafficRange } from "./trafficVisibility.js";

export class TrafficSpheres {
  constructor(scene, { limit = 500 } = {}) {
    this.limit = limit;
    this.root = new Group(); this.root.name = "opensky-traffic";
    this.geometry = new SphereGeometry(1, 12, 8);
    this.material = new MeshBasicMaterial({ color: 0xff1818, fog: true, depthTest: true, depthWrite: true, toneMapped: false });
    this.mesh = new InstancedMesh(this.geometry, this.material, limit);
    this.mesh.name = "opensky-red-spheres";
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false; // Each instance is culled against the actual camera below.
    this.mesh.raycast = () => {}; // Traffic is informational, never a terrain/weapon target.
    this.mesh.count = 0; this.root.add(this.mesh); scene.add(this.root);
    this.frustum = new Frustum(); this.projection = new Matrix4(); this.inverse = new Matrix4();
    this.matrix = new Matrix4(); this.point = new Vector3(); this.relative = new Vector3(); this.sphere = new Sphere();
    this.visible = [];
  }
  hide() { this.mesh.count = 0; this.visible = []; }
  update(samples, camera, mapMatrix, fog, viewportHeight) {
    camera.updateMatrixWorld();
    this.projection.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.projection);
    this.inverse.copy(mapMatrix).invert();
    const range = trafficRange(fog), candidates = [];
    for (const sample of samples) {
      earthPosition(sample.latitudeDeg * Math.PI / 180, sample.longitudeDeg * Math.PI / 180, sample.altitudeM, mapMatrix, this.point);
      const distance = camera.position.distanceTo(this.point);
      if (distance > range || hiddenByEarth(camera.position, this.point, this.inverse)) continue;
      const radius = markerRadius(distance, camera.fov, viewportHeight) * Math.sqrt(sample.freshness);
      this.sphere.set(this.point, radius);
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      candidates.push({ sample, distance, radius, position: this.point.clone() });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    this.visible = candidates.slice(0, this.limit);
    // Camera-relative instance coordinates preserve float precision at Earth-scale positions.
    this.mesh.position.copy(camera.position);
    for (const [index, item] of this.visible.entries()) {
      this.relative.subVectors(item.position, camera.position);
      this.matrix.makeScale(item.radius, item.radius, item.radius).setPosition(this.relative);
      this.mesh.setMatrixAt(index, this.matrix);
    }
    this.mesh.count = this.visible.length;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.updateMatrixWorld();
  }
  dispose() { this.root.removeFromParent(); this.geometry.dispose(); this.material.dispose(); this.mesh.dispose(); }
}
