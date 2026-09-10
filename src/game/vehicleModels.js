import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { passengerType, preparePassengerDetails } from "./passengerDetails.js";

export async function loadVehicleModel(spec) {
  if (spec.create) return spec.create();
  const gltf = await new GLTFLoader().loadAsync(spec.file);
  return preparePassengerDetails(gltf.scene, passengerType(spec));
}

// Models are loaded/created independently, so unused loads own their resources.
export function disposeModelResources(root) {
  const resources = new Set();
  root.traverse(node => {
    if (node.geometry) resources.add(node.geometry);
    for (const material of (Array.isArray(node.material) ? node.material : [node.material])) {
      if (!material) continue;
      resources.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) resources.add(value);
    }
  });
  for (const resource of resources) resource.dispose();
}
