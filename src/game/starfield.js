import { BufferGeometry, Color, Float32BufferAttribute, Points, ShaderMaterial, Vector3 } from 'three';

// Independent phases and two frequencies keep the stars from pulsing in unison.
export function starBrightness(time, phase, rate) {
  return .56 + .30 * Math.sin(time * rate + phase) + .14 * Math.sin(time * rate * 2.31 + phase * 1.7);
}
export function createStarfield({ count = 6000, radius = 4.9e6, size = 2, seed = 737320 } = {}) {
  const random = () => { seed = (Math.imul(1664525, seed) + 1013904223) >>> 0; return seed / 4294967296; };
  const positions = [], colors = [], phases = [], rates = [], sizes = [];
  const color = new Color();
  for (let i = 0; i < count; i++) {
    const z = random() * 2 - 1, angle = random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
    positions.push(Math.cos(angle) * r * radius, Math.sin(angle) * r * radius, z * radius);
    color.setHex(random() > .8 ? 0xffdeb2 : random() > .4 ? 0xffffff : 0xb6d0ff).multiplyScalar(.5 + random() * .5);
    colors.push(color.r, color.g, color.b);
    phases.push(random() * Math.PI * 2); rates.push(.7 + random() * 2.3); sizes.push(size * (.65 + random() * .9));
  }
  const geometry = new BufferGeometry();
  for (const [key, values, n] of [['position', positions, 3], ['color', colors, 3], ['phase', phases, 1], ['rate', rates, 1], ['starSize', sizes, 1]]) geometry.setAttribute(key, new Float32BufferAttribute(values, n));
  const material = new ShaderMaterial({
    uniforms: { time: { value: 0 }, opacity: { value: 1 }, space: { value: 1 }, starUp: { value: new Vector3(0, 1, 0) }, pixelRatio: { value: Math.min(globalThis.devicePixelRatio ?? 1, 2) } },
    transparent: true, depthWrite: false, fog: false, toneMapped: false,
    vertexShader: `attribute vec3 color; attribute float phase, rate, starSize;
      uniform float time, pixelRatio; uniform vec3 starUp;
      varying vec3 vColor; varying float vLight, vHeight;
      void main() {
        vColor = color;
        vLight = .56 + .30 * sin(time * rate + phase) + .14 * sin(time * rate * 2.31 + phase * 1.7);
        vHeight = dot(normalize(mat3(modelMatrix) * position), starUp);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = starSize * pixelRatio * (.85 + .3 * vLight);
      }`,
    fragmentShader: `uniform float opacity, space; varying vec3 vColor; varying float vLight, vHeight;
      void main() {
        float r = length(gl_PointCoord - .5) * 2.0;
        float a = (1.0 - smoothstep(.2, 1.0, r)) * vLight * opacity;
        a *= mix(smoothstep(0.0, .08, vHeight), 1.0, space);
        gl_FragColor = vec4(vColor, a);
        #include <colorspace_fragment>
      }`,
  });
  const stars = new Points(geometry, material);
  stars.name = 'space-stars'; stars.frustumCulled = false; stars.renderOrder = -99; stars.raycast = () => {};
  stars.userData.update = (time, opacity = 1, space = 1, up) => {
    material.uniforms.time.value = time; material.uniforms.opacity.value = opacity; material.uniforms.space.value = space;
    if (up) material.uniforms.starUp.value.copy(up);
    stars.visible = opacity > 0;
  };
  return stars;
}
