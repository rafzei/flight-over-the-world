import { Color, DataTexture, DoubleSide, Mesh, MeshBasicMaterial, MeshStandardMaterial, RGBAFormat, RingGeometry, SphereGeometry, SRGBColorSpace, RepeatWrapping, LinearFilter, LinearMipmapLinearFilter } from 'three';

const clamp = (v, lo = 0, hi = 1) => Math.max(lo, Math.min(hi, v));
function noise(x, y) { return Math.sin(x * 7.13 + Math.sin(y * 4.7)) * Math.sin(y * 9.2 + Math.sin(x * 3.4)); }
function planetTexture(body) {
  const width = 512, height = 256, data = new Uint8Array(width * height * 4), base = new Color(body.color);
  // Authored procedural colour maps: no runtime external image dependency.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = x / width * Math.PI * 2, v = y / height * Math.PI, lat = v - Math.PI / 2;
    const n = noise(u * 3, v * 3), fine = noise(u * 15, v * 15);
    let shade = 1, r = base.r, g = base.g, b = base.b;
    if (body.gas || body.id === 'venus') {
      const warp = .08 * Math.sin(u * 5 + v * 8) + .03 * n;
      const bands = Math.sin((v + warp) * (body.id === 'jupiter' ? 32 : 22));
      shade = body.id === 'uranus' ? .9 + .035 * bands : .83 + .16 * bands + .055 * fine;
      if (body.id === 'jupiter') {
        const storm = Math.hypot((u - 4.3) / .32, (lat + .34) / .13);
        if (storm < 1) { r = .64; g = .20 + .08 * storm; b = .08; shade = .8 + .2 * Math.sin(storm * 18); }
      }
      if (body.id === 'neptune' && Math.hypot((u - 4.1) / .3, (lat + .35) / .12) < 1) shade *= .5;
    } else {
      shade = .75 + .20 * n + .08 * fine;
      if (body.id === 'mars') {
        shade *= 1 - .3 * clamp(noise(u * 2, v * 2) + .15);
        if (Math.abs(lat) > 1.36 + .025 * n) { r = .8; g = .83; b = .78; }
        if (Math.abs(lat + .12 + .06 * Math.sin(u * 3)) < .016 && u > 2.5 && u < 3.8) shade *= .55;
      }
      if (body.id === 'mercury') {
        const cells = Math.sin(u * 83) * Math.sin(v * 61);
        shade *= .8 + .2 * Math.abs(cells) + .16 * Math.exp(-((Math.abs(cells) - .7) ** 2) / .012);
      }
    }
    const i = (y * width + x) * 4;
    // The data is sRGB encoded so standard materials light it consistently.
    const color = new Color(clamp(r * shade), clamp(g * shade), clamp(b * shade)).convertLinearToSRGB();
    data[i] = color.r * 255; data[i + 1] = color.g * 255; data[i + 2] = color.b * 255; data[i + 3] = 255;
  }
  const texture = new DataTexture(data, width, height, RGBAFormat);
  texture.colorSpace = SRGBColorSpace; texture.wrapS = RepeatWrapping; texture.magFilter = LinearFilter; texture.minFilter = LinearMipmapLinearFilter; texture.generateMipmaps = true; texture.needsUpdate = true;
  return texture;
}
export function createPlanetVisual(body, scale) {
  const geometry = new SphereGeometry(body.radius * scale, 96, 64); geometry.rotateX(Math.PI / 2);
  const texture = body.id === 'sun' ? null : planetTexture(body);
  const material = body.id === 'sun' ? new MeshBasicMaterial({ color: body.color, toneMapped: false })
    : new MeshStandardMaterial({ map: texture, roughness: 1 });
  const mesh = new Mesh(geometry, material); mesh.name = `physical-${body.id}`;
  mesh.userData.body = body; mesh.userData.radius = body.radius * scale;
  if (body.rings) {
    const data = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) {
      const t = i / 255, gap = t > .60 && t < .64;
      data[i * 4] = 195; data[i * 4 + 1] = 179; data[i * 4 + 2] = 146;
      data[i * 4 + 3] = gap ? 10 : (body.id === 'uranus' ? 60 : 170) + Math.sin(i * .18) * 25 + Math.sin(i * .6) * 10;
    }
    const ringsTexture = new DataTexture(data, 256, 1, RGBAFormat); ringsTexture.magFilter = LinearFilter; ringsTexture.minFilter = LinearFilter; ringsTexture.colorSpace = SRGBColorSpace; ringsTexture.needsUpdate = true;
    const inner = body.radius * scale * body.rings[0], outer = body.radius * scale * body.rings[1];
    const ringsGeometry = new RingGeometry(inner, outer, 160);
    const pos = ringsGeometry.attributes.position, uv = ringsGeometry.attributes.uv;
    for (let i = 0; i < pos.count; i++) uv.setXY(i, (Math.hypot(pos.getX(i), pos.getY(i)) - inner) / (outer - inner), .5);
    const rings = new Mesh(ringsGeometry, new MeshStandardMaterial({ map: ringsTexture, emissive: 0x584932, emissiveIntensity: .15, side: DoubleSide, transparent: true, depthWrite: false, roughness: 1 }));
    rings.name = `${body.id}-rings`; mesh.add(rings);
  }
  return mesh;
}
