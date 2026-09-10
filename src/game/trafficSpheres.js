import { DynamicDrawUsage, Frustum, Group, InstancedMesh, Matrix4, MeshBasicMaterial, Sphere, SphereGeometry, Vector3 } from "three";
import { earthPosition, hiddenByEarth, markerRadius, trafficRange } from "./trafficVisibility.js";
import { WGS84_ELLIPSOID, CAMERA_FRAME } from "3d-tiles-renderer";
import { createAirliner } from "./airliner.js";
import { AIRLINERS, aircraftVisual } from "../../shared/aircraftTypes.js";

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
    this.airliners = new Map();
    for (const key of Object.keys(AIRLINERS)) {
      const template = createAirliner(key), instances = [];
      for (const part of template.children) {
        const instanced = new InstancedMesh(part.geometry, part.material, limit);
        instanced.name = `traffic-${key}-${part.name}`;
        instanced.instanceMatrix.setUsage(DynamicDrawUsage); instanced.frustumCulled = false;
        instanced.raycast = () => {}; instanced.count = 0;
        this.root.add(instanced); instances.push(instanced);
      }
      this.airliners.set(key, instances);
    }
    this.frustum = new Frustum(); this.projection = new Matrix4(); this.inverse = new Matrix4();
    this.matrix = new Matrix4(); this.point = new Vector3(); this.relative = new Vector3(); this.sphere = new Sphere();
    this.visible = [];
  }
  hide() { this.mesh.count = 0; this.visible = []; for (const parts of this.airliners.values()) for (const part of parts) part.count = 0; }
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
      const visual = aircraftVisual(sample.aircraft?.typeCode, sample.aircraft?.modelName);
      const radius = markerRadius(distance, camera.fov, viewportHeight) * Math.sqrt(sample.freshness);
      const spec = visual ? AIRLINERS[visual.model] : null;
      const metersPerPixel = 2 * distance * Math.tan(camera.fov * Math.PI / 360) / Math.max(1, viewportHeight);
      const groundLimit = sample.approach?.runway ? Math.max(1, (sample.altitudeM - sample.approach.runway.elevation) / 30) : 12;
      const modelScale = spec ? Math.min(12, groundLimit, Math.max(1, 18 * metersPerPixel / spec.span)) * Math.sqrt(sample.freshness) : 1;
      this.sphere.set(this.point, spec ? Math.max(radius, Math.hypot(visual.length, spec.span, 14) * modelScale / 2) : radius);
      if (!this.frustum.intersectsSphere(this.sphere)) continue;
      candidates.push({ sample, distance, radius, visual, modelScale, position: this.point.clone() });
    }
    candidates.sort((a, b) => a.distance - b.distance);
    this.visible = candidates.slice(0, this.limit);
    // Camera-relative instance coordinates preserve float precision at Earth-scale positions.
    this.mesh.position.copy(camera.position);
    const counts = Object.fromEntries(Array.from(this.airliners.keys(), key => [key, 0])); let spheres = 0;
    for (const parts of this.airliners.values()) for (const part of parts) part.position.copy(camera.position);
    for (const item of this.visible) {
      this.relative.subVectors(item.position, camera.position);
      if (item.visual) {
        const sample = item.sample, spec = AIRLINERS[item.visual.model];
        // A bounded visual enlargement keeps the silhouette readable at map distances.
        const scale = item.modelScale;
        const heading = (sample.trueTrackDeg ?? 0) * Math.PI / 180;
        const pitch = Math.atan2(sample.verticalRateMps ?? 0, Math.max(1, sample.velocityMps ?? 1));
        const bank = (sample.bankDeg ?? 0) * Math.PI / 180;
        WGS84_ELLIPSOID.getObjectFrame(sample.latitudeDeg*Math.PI/180, sample.longitudeDeg*Math.PI/180, sample.altitudeM, heading, pitch, bank, this.matrix, CAMERA_FRAME);
        this.matrix.premultiply(mapMatrix).setPosition(this.relative).scale(new Vector3(scale, scale, scale * item.visual.length / spec.length));
        const index = counts[item.visual.model]++;
        for (const part of this.airliners.get(item.visual.model)) part.setMatrixAt(index, this.matrix);
      } else {
        this.matrix.makeScale(item.radius, item.radius, item.radius).setPosition(this.relative);
        this.mesh.setMatrixAt(spheres++, this.matrix);
      }
    }
    this.mesh.count = spheres;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.updateMatrixWorld();
    for (const [key, parts] of this.airliners) for (const part of parts) {
      part.count = counts[key]; part.instanceMatrix.needsUpdate = true; part.updateMatrixWorld();
    }
  }
  dispose() {
    this.root.removeFromParent(); this.geometry.dispose(); this.material.dispose(); this.mesh.dispose();
    for (const parts of this.airliners.values()) for (const part of parts) { part.geometry.dispose(); part.material.dispose(); part.dispose(); }
  }
}
