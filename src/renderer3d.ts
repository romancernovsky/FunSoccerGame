import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { FIELD, type Player, type Snapshot } from "./shared";
import { CAMERA_ELEVATION, cameraFrustum, type Camera } from "./camera";
const materials = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: string, metalness = 0) {
  const key = color + metalness;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color, roughness: 0.58, metalness });
    materials.set(key, m);
  }
  return m;
}
const cube = new THREE.BoxGeometry(1, 1, 1),
  round = new RoundedBoxGeometry(1, 1, 1, 2, 0.15),
  sphere = new THREE.SphereGeometry(1, 16, 12);
function mesh(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  x: number,
  y: number,
  z: number,
  sx = 1,
  sy = sx,
  sz = sx,
) {
  const m = new THREE.Mesh(geometry, material);
  m.position.set(x, y, z);
  m.scale.set(sx, sy, sz);
  m.castShadow = sx > 0.09 || sy > 0.13;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}
function box(
  p: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  w: number,
  h: number,
  d: number,
  color: string,
  rounded = false,
) {
  return mesh(p, rounded ? round : cube, mat(color), x, y, z, w, h, d);
}
function orb(
  p: THREE.Object3D,
  x: number,
  y: number,
  z: number,
  r: number,
  color: string,
  sx = 1,
  sy = 1,
  sz = 1,
) {
  return mesh(p, sphere, mat(color), x, y, z, r * sx, r * sy, r * sz);
}
function textTexture(text: string, fg: string, bg = "transparent", size = 512) {
  const c = document.createElement("canvas");
  c.width = size;
  c.height = 128;
  const g = c.getContext("2d")!;
  if (bg !== "transparent") {
    g.fillStyle = bg;
    g.fillRect(0, 0, size, 128);
  }
  g.fillStyle = fg;
  g.font = "900 58px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText(text, size / 2, 64, size - 20);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function pitchTexture() {
  const c = document.createElement("canvas");
  c.width = 2400;
  c.height = 1400;
  const g = c.getContext("2d")!;
  g.scale(2, 2);
  for (let i = 0; i < 16; i++) {
    g.fillStyle = i % 2 ? "#338d59" : "#2c8050";
    g.fillRect(i * 75, 0, 75, 700);
  }
  let seed = 382;
  const rand = () => {
    seed = (seed * 16807) % 2147483647;
    return seed / 2147483647;
  };
  for (let i = 0; i < 28000; i++) {
    g.fillStyle = i % 2 ? "#c3e69814" : "#073a2a14";
    g.fillRect(rand() * 1200, rand() * 700, 0.7, 0.7 + rand() * 2);
  }
  g.fillStyle = "#53bfff18";
  g.fillRect(0, 205, 155, 290);
  g.fillStyle = "#ffb25219";
  g.fillRect(1045, 205, 155, 290);
  g.strokeStyle = "#e1efce";
  g.lineWidth = 3;
  g.strokeRect(3, 3, 1194, 694);
  g.beginPath();
  g.moveTo(600, 0);
  g.lineTo(600, 700);
  g.stroke();
  g.beginPath();
  g.arc(600, 350, FIELD.centerCircleRadius, 0, Math.PI * 2);
  g.stroke();
  for (const left of [true, false]) {
    g.strokeRect(left ? 0 : 1045, 205, 155, 290);
    g.strokeRect(left ? 0 : 1140, 265, 60, 170);
    g.beginPath();
    g.arc(left ? 105 : 1095, 350, 4, 0, Math.PI * 2);
    g.fillStyle = "#dfedc9";
    g.fill();
  }
  g.beginPath();
  g.arc(600, 350, 4, 0, Math.PI * 2);
  g.fill();
  g.font = "900 42px sans-serif";
  g.textAlign = "center";
  g.fillStyle = "#e4f2d90c";
  g.fillText("OFFICE", 600, 235);
  g.fillText("ARENA", 600, 495);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}
let shadowTexture: THREE.CanvasTexture | undefined;
function contactShadow() {
  if (!shadowTexture) {
    const canvas = document.createElement("canvas");
    canvas.width = 64;
    canvas.height = 64;
    const c = canvas.getContext("2d")!,
      g = c.createRadialGradient(32, 32, 2, 32, 32, 31);
    g.addColorStop(0, "#071c2999");
    g.addColorStop(0.4, "#071c2966");
    g.addColorStop(1, "#071c2900");
    c.fillStyle = g;
    c.fillRect(0, 0, 64, 64);
    shadowTexture = new THREE.CanvasTexture(canvas);
  }
  return shadowTexture;
}
type Avatar = {
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Group;
  pointer: THREE.Mesh;
  left: THREE.Group;
  right: THREE.Group;
  ring: THREE.Mesh;
  team: string;
  keeper: boolean;
  shirt: THREE.Mesh;
  gloves: THREE.Mesh[];
};
export class Arena3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.OrthographicCamera();
  private actors = new Map<string, Avatar>();
  private ball = new THREE.Group();
  private ballSurface = new THREE.Group();
  private ballShell: THREE.Mesh;
  private ballGlow: THREE.Mesh;
  private trail: THREE.Mesh[] = [];
  private history: THREE.Vector3[] = [];
  private v = new THREE.Vector3();
  private width = 0;
  private height = 0;
  private clock = 0;
  private frameCount = 0;
  private averageDt = 0;
  private lowQuality = false;
  constructor() {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: "high-performance",
    });
    this.renderer.domElement.id = "arena";
    this.renderer.domElement.addEventListener("webglcontextlost", (event) => {
      event.preventDefault();
      this.renderer.domElement.dataset.contextLost = "true";
    });
    this.renderer.domElement.addEventListener("webglcontextrestored", () => {
      this.renderer.domElement.dataset.contextLost = "false";
    });
    this.renderer.domElement.setAttribute(
      "aria-label",
      "Live 3D football arena",
    );
    this.renderer.domElement.dataset.renderer = "webgl";
    this.renderer.setPixelRatio(
      Math.min(
        devicePixelRatio,
        matchMedia("(pointer:coarse)").matches ? 1.5 : 2,
      ),
    );
    this.renderer.shadowMap.enabled = false;

    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color("#0b2030");
    this.scene.fog = new THREE.Fog("#0b2030", 26, 55);
    this.scene.add(new THREE.HemisphereLight("#d7f3ff", "#284637", 2.4));
    const sun = new THREE.DirectionalLight("#fff2d3", 3);
    sun.position.set(-3, 12, 7);
    sun.castShadow = false;
    sun.shadow.mapSize.set(1024, 1024);
    Object.assign(sun.shadow.camera, {
      left: -10,
      right: 10,
      top: 10,
      bottom: -10,
      near: 0.5,
      far: 35,
    });
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.025;
    sun.target.position.set(6, 0, 3.5);
    this.scene.add(sun, sun.target);
    const rim = new THREE.DirectionalLight("#8abfff", 1.4);
    rim.position.set(10, 6, -8);
    this.scene.add(rim);
    this.buildStadium();
    this.ballSurface.position.y = 0.11;
    this.ball.add(this.ballSurface);
    this.ballShell = orb(this.ballSurface, 0, 0, 0, 0.115, "#fff5da");
    const patches = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.116, 0),
      new THREE.MeshStandardMaterial({
        color: "#18394a",
        wireframe: true,
        roughness: 0.6,
      }),
    );
    this.ballSurface.add(patches);
    const pentagon = new THREE.CircleGeometry(0.045, 5);
    const patch = mesh(this.ballSurface, pentagon, mat("#193648"), 0, 0.109, 0);
    patch.rotation.x = -Math.PI / 2;
    this.ballGlow = mesh(
      this.ball,
      new THREE.RingGeometry(0.15, 0.18, 32),
      new THREE.MeshBasicMaterial({
        color: "#fff1a6",
        transparent: true,
        opacity: 0.35,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      0,
      0.012,
      0,
    );
    this.ballGlow.rotation.x = -Math.PI / 2;
    this.ballGlow.castShadow = false;
    this.scene.add(this.ball);
    for (let i = 0; i < 10; i++) {
      const m = mesh(
        this.scene,
        new THREE.SphereGeometry(1, 8, 6),
        new THREE.MeshBasicMaterial({
          color: "#ffdf94",
          transparent: true,
          opacity: i / 40,
          depthWrite: false,
        }),
        0,
        0.1,
        0,
        0.03,
      );
      m.visible = false;
      this.trail.push(m);
    }
    this.camera.near = 0.1;
    this.camera.far = 65;
  }
  private buildStadium() {
    const scene = this.scene;
    box(scene, 6, -0.55, 3.5, 17, 0.5, 12, "#071a28", true);
    box(scene, 6, -0.24, 3.5, 13.6, 0.45, 8.6, "#163b4a", true);
    box(scene, 6, -0.05, 3.5, 12.2, 0.12, 7.2, "#23573f", true);
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(12, 7),
      new THREE.MeshStandardMaterial({ map: pitchTexture(), roughness: 0.94 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(6, 0.016, 3.5);
    ground.receiveShadow = true;
    scene.add(ground);
    // Padded blue/amber end boards and illuminated rails.
    for (const north of [true, false]) {
      const z = north ? -0.16 : 7.16;
      box(scene, 6, 0.16, z, 12.65, 0.32, 0.17, "#183d50", true);
      for (let i = 0; i < 12; i++) {
        const color = i < 6 ? "#5ec4ff" : "#ffb16c";
        const glow = new THREE.MeshStandardMaterial({
          color,
          emissive: color,
          emissiveIntensity: 0.8,
        });
        mesh(scene, cube, glow, i + 0.5, 0.335, z, 0.94, 0.028, 0.08);
      }
      for (const [x, label, color] of [
        [2.1, "LEADERS", "#83d3ff"],
        [6, "OFFICE ARENA", "#e3f8bc"],
        [9.9, "WORKERS", "#ffc38a"],
      ] as const) {
        const sign = new THREE.Mesh(
          new THREE.PlaneGeometry(2.7, 0.23),
          new THREE.MeshBasicMaterial({
            map: textTexture(label, color, "#102738"),
            transparent: true,
          }),
        );
        sign.position.set(x, 0.22, z + (north ? 0.095 : -0.095));
        if (!north) sign.rotation.y = Math.PI;
        scene.add(sign);
      }
    }
    for (const left of [true, false]) {
      const x = left ? -0.13 : 12.13;
      for (const z of [1.1, 5.9]) {
        box(scene, x, 0.16, z, 0.18, 0.32, 2.2, "#214556", true);
        mesh(
          scene,
          cube,
          new THREE.MeshStandardMaterial({
            color: left ? "#6bcaff" : "#ffbd77",
            emissive: left ? "#319ddd" : "#ee8f37",
            emissiveIntensity: 0.7,
          }),
          x,
          0.335,
          z,
          0.08,
          0.025,
          2.15,
        );
      }
    }
    // Seating bowls use instancing: hundreds of crowd members in just three draw calls.
    const positions: { x: number; y: number; z: number; blue: boolean }[] = [];
    for (const north of [true, false])
      for (let row = 0; row < 3; row++) {
        const z = north ? -0.48 - row * 0.29 : 7.48 + row * 0.29;
        box(
          scene,
          6,
          0.08 + row * 0.14,
          z,
          13.3,
          0.18,
          0.32,
          row % 2 ? "#25485b" : "#1a3547",
          true,
        );
        for (let i = 0; i < 62; i++)
          positions.push({
            x: -0.5 + i * 0.215,
            y: 0.25 + row * 0.14,
            z,
            blue: i < 31,
          });
      }
    const crowd = new THREE.InstancedMesh(
        sphere,
        mat("#ffffff"),
        positions.length,
      ),
      shirts = new THREE.InstancedMesh(round, mat("#ffffff"), positions.length);
    const dummy = new THREE.Object3D(),
      color = new THREE.Color();
    positions.forEach((p, i) => {
      dummy.position.set(p.x, p.y + 0.08, p.z);
      dummy.scale.set(0.065, 0.072, 0.065);
      dummy.updateMatrix();
      crowd.setMatrixAt(i, dummy.matrix);
      crowd.setColorAt(i, color.set(["#d4a67d", "#eec9a1", "#976c50"][i % 3]));
      dummy.position.y = p.y - 0.03;
      dummy.scale.set(0.12, 0.11, 0.09);
      dummy.updateMatrix();
      shirts.setMatrixAt(i, dummy.matrix);
      shirts.setColorAt(
        i,
        color.set(
          p.blue
            ? i % 3
              ? "#3d95d3"
              : "#b4e6ff"
            : i % 3
              ? "#e99250"
              : "#ffdb98",
        ),
      );
    });
    scene.add(crowd, shirts);
    // Four sculptural floodlight towers frame the arena.
    for (const x of [-0.65, 12.65])
      for (const z of [-0.6, 7.6]) {
        box(scene, x, 0.6, z, 0.09, 1.3, 0.09, "#557584");
        box(scene, x, 1.25, z, 0.58, 0.23, 0.18, "#214452", true);
        const light = new THREE.MeshStandardMaterial({
          color: "#f0fbff",
          emissive: "#d7f3ff",
          emissiveIntensity: 2,
        });
        for (let i = 0; i < 3; i++)
          mesh(
            scene,
            cube,
            light,
            x - 0.18 + i * 0.18,
            1.25,
            z + 0.1,
            0.13,
            0.14,
            0.035,
          );
      }
    for (const left of [true, false]) this.goal(left);
  }
  private goal(left: boolean) {
    const group = new THREE.Group(),
      x = left ? 0 : 12,
      back = left ? -0.48 : 12.48,
      color = left ? "#97ddff" : "#ffd3a2";
    for (const z of [2.45, 4.55]) {
      box(group, x, 0.37, z, 0.055, 0.74, 0.055, "#f4fbec", true);
      box(group, back, 0.32, z, 0.045, 0.64, 0.045, color, true);
      box(group, (x + back) / 2, 0.68, z, 0.52, 0.045, 0.045, color, true);
    }
    box(group, x, 0.72, 3.5, 0.06, 0.06, 2.15, "#fffce8", true);
    box(group, back, 0.64, 3.5, 0.045, 0.045, 2.15, color, true);
    const lines: number[] = [];
    const line = (a: number[], b: number[]) => lines.push(...a, ...b);
    for (let z = 2.45; z < 4.56; z += 0.11) {
      line([back, 0.02, z], [back, 0.64, z]);
      line([x, 0.72, z], [back, 0.64, z]);
    }
    for (let y = 0.02; y < 0.66; y += 0.1)
      line([back, y, 2.45], [back, y, 4.55]);
    for (const z of [2.45, 4.55])
      for (let y = 0.02; y < 0.7; y += 0.1) line([x, y, z], [back, y * 0.9, z]);
    const net = new THREE.LineSegments(
      new THREE.BufferGeometry().setAttribute(
        "position",
        new THREE.Float32BufferAttribute(lines, 3),
      ),
      new THREE.LineBasicMaterial({
        color: "#b9e0dd",
        transparent: true,
        opacity: 0.5,
      }),
    );
    group.add(net);
    this.scene.add(group);
  }
  private avatar(p: Player): Avatar {
    const root = new THREE.Group(),
      body = new THREE.Group(),
      left = new THREE.Group(),
      right = new THREE.Group();
    root.add(body);
    body.add(left, right);
    left.position.set(-0.09, 0, 0);
    right.position.set(0.09, 0, 0);
    const hash = [...p.id].reduce((a, v) => a + v.charCodeAt(0), 0),
      skin = ["#edbf97", "#b97c55", "#f3cfa5", "#805039", "#d5a078"][hash % 5],
      blue = p.team === "LEADERS",
      hair = (
        blue
          ? ["#f5d77e", "#e9c361", "#ffe3a0", "#e4ba58"]
          : ["#2d2631", "#563a29", "#32272c", "#3d2d25"]
      )[hash % 4],
      shirtColor = blue ? "#168bf5" : "#f58228";
    for (const leg of [left, right]) {
      box(leg, 0, 0.085, 0.025, 0.125, 0.12, 0.21, "#163044", true);
      box(leg, 0, 0.18, 0, 0.095, 0.13, 0.1, "#f0f3d6", true);
    }
    box(body, 0, 0.28, 0, 0.31, 0.16, 0.23, blue ? "#173f89" : "#8d422c", true);
    const shirt = box(body, 0, 0.47, 0, 0.37, 0.32, 0.29, shirtColor, true);
    // Front collar, shirt stripe, badge and back number.
    box(
      body,
      -0.11,
      0.48,
      0.15,
      0.027,
      0.23,
      0.015,
      blue ? "#92ddff" : "#ffde9c",
    );
    box(
      body,
      0.11,
      0.48,
      0.15,
      0.027,
      0.23,
      0.015,
      blue ? "#92ddff" : "#ffde9c",
    );
    box(body, 0, 0.605, 0.12, 0.13, 0.03, 0.04, "#f2f5d8", true);
    const numberTexture = textTexture(
      String((hash % 19) + 1).padStart(2, "0"),
      "#effcff",
    );
    const numberMaterial = new THREE.MeshBasicMaterial({
      map: numberTexture,
      transparent: true,
      depthWrite: false,
    });
    const number = mesh(
      body,
      new THREE.PlaneGeometry(0.16, 0.12),
      numberMaterial,
      0,
      0.47,
      0.153,
    );
    const back = number.clone();
    back.position.z = -0.153;
    back.rotation.y = Math.PI;
    body.add(back);
    const gloves: THREE.Mesh[] = [];
    for (const side of [-1, 1]) {
      orb(body, side * 0.245, 0.46, 0, 0.11, shirtColor, 0.8, 1.3, 0.85);
      gloves.push(
        orb(body, side * 0.255, 0.34, 0.025, 0.08, p.keeper ? "#eeffb7" : skin),
      );
    }
    const head = new THREE.Group();
    head.name = "head";
    head.position.y = 0.77;
    body.add(head);
    orb(head, 0, 0, 0, 0.21, skin, 1, 1.08, 0.95);
    orb(head, -0.21, 0, 0, 0.048, skin);
    orb(head, 0.21, 0, 0, 0.048, skin);
    const hairstyle = new THREE.Group();
    hairstyle.name = "hair";
    head.add(hairstyle);
    const hairCap = new THREE.Mesh(
      new THREE.SphereGeometry(0.215, 16, 8, 0, Math.PI * 2, 0, Math.PI * 0.45),
      mat(hair),
    );
    hairCap.position.set(0, 0.045, 0);
    hairCap.castShadow = true;
    hairstyle.add(hairCap);
    for (const hx of [-0.11, 0, 0.1])
      orb(hairstyle, hx, 0.11, 0.1, 0.065, hair, 1.3, 0.55, 0.7);
    // One rigid face rig: eye whites, pupils and highlights inherit head turns.
    // Lift the eyes toward the brow so the overhead camera can read the gaze.
    const face = new THREE.Group();
    face.name = "face";
    face.position.set(0, 0.07, 0.18);
    head.add(face);
    for (const [side, x] of [
      ["left", -0.075],
      ["right", 0.075],
    ] as const) {
      const eye = new THREE.Group();
      eye.name = `${side}-eye`;
      eye.position.x = x;
      face.add(eye);
      orb(eye, 0, 0, 0, 0.052, "#fff8df", 1, 1.1, 0.45).name = "white";
      orb(eye, 0, 0, 0.026, 0.027, "#162a38", 1, 1, 0.4).name = "pupil";
      orb(eye, -0.008, 0.012, 0.039, 0.007, "#ffffff").name = "highlight";
    }
    orb(face, 0, -0.105, 0.044, 0.027, skin, 0.7, 0.65, 1.2);
    const mouth = new THREE.Mesh(
      new THREE.TorusGeometry(0.045, 0.008, 4, 12, Math.PI),
      mat("#744538"),
    );
    mouth.position.set(0, -0.119, 0.031);
    mouth.rotation.z = Math.PI;
    face.add(mouth);
    const ring = mesh(
      root,
      new THREE.RingGeometry(0.28, 0.315, 48),
      new THREE.MeshBasicMaterial({
        color: "#ddff91",
        transparent: true,
        opacity: 0.9,
        side: THREE.DoubleSide,
        depthWrite: false,
      }),
      0,
      0.025,
      0,
    );
    ring.rotation.x = -Math.PI / 2;
    ring.visible = false;
    ring.castShadow = false;
    const texture = contactShadow();
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(0.78, 0.65),
      new THREE.MeshBasicMaterial({
        map: texture,
        transparent: true,
        depthWrite: false,
        opacity: 0.65,
      }),
    );
    shadow.rotation.x = -Math.PI / 2;
    shadow.position.y = 0.022;
    root.add(shadow);
    const direction = new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        [-0.065, 0, -0.055, 0.065, 0, -0.055, 0, 0, 0.12],
        3,
      ),
    );
    direction.computeVertexNormals();
    const pointer = new THREE.Mesh(
      direction,
      new THREE.MeshBasicMaterial({
        color: blue ? "#b1e7ff" : "#ffd5a0",
        side: THREE.DoubleSide,
        transparent: true,
        opacity: 0.85,
      }),
    );
    root.add(pointer);
    this.scene.add(root);
    return {
      root,
      body,
      head,
      pointer,
      left,
      right,
      ring,
      team: p.team,
      keeper: p.keeper,
      shirt,
      gloves,
    };
  }
  render(
    state: Snapshot,
    time: number,
    dt: number,
    view: Camera,
    localId: string | null,
    width: number,
    height: number,
  ) {
    if (this.width !== width || this.height !== height) {
      this.width = width;
      this.height = height;
      this.renderer.setSize(width, height, false);
    }
    this.frameCount++;
    this.averageDt = this.averageDt * 0.9 + dt * 0.1;
    if (this.frameCount > 15 && this.averageDt > 0.045 && !this.lowQuality) {
      this.lowQuality = true;
      this.renderer.setPixelRatio(0.85);
    }
    if (this.clock === 0)
      this.ball.position.set(state.ball.x / 100, 0, state.ball.y / 100);
    const frustum = cameraFrustum({ width, height });
    this.camera.left = -frustum.halfWidth / 100;
    this.camera.right = frustum.halfWidth / 100;
    this.camera.top = frustum.halfHeight / 100;
    this.camera.bottom = -frustum.halfHeight / 100;
    this.camera.zoom = view.zoom;
    const cx = 6 + (view.x - 660) / 100,
      cz = 3.5 + (view.y - 400) / 100;
    this.camera.position.set(cx, 19, cz + 7.5);
    this.camera.lookAt(cx, 0, cz);
    this.camera.updateProjectionMatrix();
    this.renderer.domElement.dataset.cameraElevation = (
      (CAMERA_ELEVATION * 180) /
      Math.PI
    ).toFixed(1);
    this.renderer.domElement.dataset.cameraWidth = (
      (frustum.halfWidth * 2) /
      view.zoom
    ).toFixed(1);
    const smoothing = 1 - Math.exp(-dt * 18);
    const live = new Set(state.players.map((p) => p.id));
    for (const [id, a] of this.actors)
      if (!live.has(id)) {
        this.scene.remove(a.root);
        this.actors.delete(id);
        for (const child of a.body.children)
          if (
            child instanceof THREE.Mesh &&
            child.material instanceof THREE.MeshBasicMaterial &&
            child.material.map
          ) {
            child.geometry.dispose();
            child.material.map.dispose();
            child.material.dispose();
          }
      }
    for (const p of state.players) {
      let a = this.actors.get(p.id);
      if (!a) {
        a = this.avatar(p);
        a.root.position.set(p.x / 100, 0, p.y / 100);
        this.actors.set(p.id, a);
      }
      if (a.team !== p.team || a.keeper !== p.keeper) {
        this.scene.remove(a.root);
        a = this.avatar(p);
        a.root.position.set(p.x / 100, 0, p.y / 100);
        this.actors.set(p.id, a);
      }
      a.root.position.x += (p.x / 100 - a.root.position.x) * smoothing;
      a.root.position.z += (p.y / 100 - a.root.position.z) * smoothing;
      const angle = Math.atan2(p.fx, p.fy);
      let delta = angle - a.body.rotation.y;
      delta = Math.atan2(Math.sin(delta), Math.cos(delta));
      a.body.rotation.y += delta * smoothing;
      // The head inherits the body's smoothed movement heading.
      a.head.rotation.y = 0;
      a.body.rotation.x = state.now < p.dashUntil ? -0.15 : 0;
      a.pointer.position.set(p.fx * 0.37, 0.028, p.fy * 0.37);
      a.pointer.rotation.y = Math.atan2(p.fx, p.fy);
      const moving = Math.hypot(p.input.x, p.input.y) > 0.1,
        step = moving
          ? Math.sin(time / (state.now < p.dashUntil ? 45 : 85) + p.x) * 0.45
          : 0;
      a.left.rotation.x = step;
      a.right.rotation.x = -step;
      a.body.position.y = moving
        ? Math.abs(step) * 0.025
        : Math.sin(time / 500 + p.x) * 0.008;
      a.ring.visible = p.id === localId || state.ball.owner === p.id;
      (a.ring.material as THREE.MeshBasicMaterial).color.set(
        p.id === localId ? "#dcff83" : "#ffe4a1",
      );
      a.ring.scale.setScalar(p.id === localId ? 1.15 : 1);
      a.root.visible = p.connected || Math.floor(time / 350) % 2 === 0;
    }
    this.ball.position.x +=
      (state.ball.x / 100 - this.ball.position.x) * smoothing;
    this.ball.position.z +=
      (state.ball.y / 100 - this.ball.position.z) * smoothing;
    this.ballSurface.rotation.x += state.ball.vy * dt * 0.025;
    this.ballSurface.rotation.z -= state.ball.vx * dt * 0.025;
    this.ballGlow.scale.setScalar(1 + Math.sin(time / 180) * 0.1);
    this.history.push(this.ball.position.clone());
    if (this.history.length > 10) this.history.shift();
    const fast =
      Math.hypot(state.ball.vx, state.ball.vy) > 180 && !state.ball.owner;
    this.trail.forEach((m, i) => {
      const point = this.history[i];
      m.visible = !!point && fast;
      if (point) {
        m.position.copy(point);
        m.position.y = 0.11;
        m.scale.setScalar(0.025 + i * 0.006);
      }
    });
    const local = localId ? this.actors.get(localId) : null;
    const label = local
      ? `Live 3D football arena. Your kit is ${local.team === "LEADERS" ? "blue (LEADERS)" : "orange (WORKERS)"}.`
      : "Live 3D football arena";
    if (this.renderer.domElement.getAttribute("aria-label") !== label)
      this.renderer.domElement.setAttribute("aria-label", label);
    this.clock = time;

    this.renderer.render(this.scene, this.camera);
  }
  /** Readability assist only: ball physics and authoritative coordinates are unchanged. */
  drawMobileBall(c: CanvasRenderingContext2D, localId: string) {
    const p = this.project(this.ball.position.x, 0.13, this.ball.position.z);
    const x = (p.x * this.width) / 1320,
      y = (p.y * this.height) / 800;
    const blockedByThumb =
      y > this.height - 112 && (x < 110 || x > this.width - 154);
    const visible =
      x >= 12 &&
      x <= this.width - 12 &&
      y >= 12 &&
      y <= this.height - 12 &&
      !blockedByThumb;
    c.save();
    c.setTransform(
      c.canvas.width / this.width,
      0,
      0,
      c.canvas.height / this.height,
      0,
      0,
    );
    if (visible) {
      c.beginPath();
      c.arc(x, y, 10, 0, Math.PI * 2);
      c.fillStyle = "#fff08c";
      c.fill();
      c.beginPath();
      c.arc(x, y, 8, 0, Math.PI * 2);
      c.fillStyle = "#fffef0";
      c.fill();
      c.lineWidth = 2;
      c.strokeStyle = "#102532";
      c.stroke();
      c.beginPath();
      for (let i = 0; i < 5; i++) {
        const a = (i * Math.PI * 2) / 5 - Math.PI / 2;
        const px = x + Math.cos(a) * 3.4,
          py = y + Math.sin(a) * 3.4;
        if (!i) c.moveTo(px, py);
        else c.lineTo(px, py);
      }
      c.closePath();
      c.fillStyle = "#102532";
      c.fill();
    } else {
      const dx = x - this.width / 2,
        dy = y - this.height / 2;
      const t = Math.min(
        (this.width / 2 - 28) / Math.max(1, Math.abs(dx)),
        (this.height / 2 - 30) / Math.max(1, Math.abs(dy)),
        1,
      );
      const bx = Math.max(
        28,
        Math.min(this.width - 28, this.width / 2 + dx * t),
      );
      let by = Math.max(
        28,
        Math.min(this.height - 34, this.height / 2 + dy * t),
      );
      if (bx < 120 || bx > this.width - 160)
        by = Math.min(by, this.height - 128);
      c.fillStyle = "#0b2435ee";
      c.strokeStyle = "#fff08c";
      c.lineWidth = 1.5;
      c.beginPath();
      c.roundRect(bx - 22, by - 20, 44, 40, 9);
      c.fill();
      c.stroke();
      c.save();
      c.translate(bx, by - 5);
      c.rotate(Math.atan2(dy, dx));
      c.strokeStyle = "#fff8bc";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(-7, 0);
      c.lineTo(7, 0);
      c.moveTo(2, -5);
      c.lineTo(7, 0);
      c.lineTo(2, 5);
      c.stroke();
      c.restore();
      c.fillStyle = "#fff8bc";
      c.font = "700 9px sans-serif";
      c.textAlign = "center";
      c.fillText("BALL", bx, by + 12);
    }
    c.restore();
    c.canvas.dataset.ballVisibility = visible ? "visible" : "direction";
    c.canvas.dataset.ballCorePixels = "14";
    c.canvas.dataset.ballX = x.toFixed(1);
    c.canvas.dataset.ballY = y.toFixed(1);
  }
  drawPlayerLocation(
    c: CanvasRenderingContext2D,
    localId: string,
    mobile: boolean,
  ) {
    const local = this.actors.get(localId);
    if (!local) return;
    const head = this.project(
      local.root.position.x,
      0.8,
      local.root.position.z,
    );
    const x = (head.x * this.width) / 1320,
      y = (head.y * this.height) / 800;
    const covered =
      mobile && y > this.height - 112 && (x < 110 || x > this.width - 154);
    const visible =
      !covered &&
      x >= 20 &&
      x <= this.width - 20 &&
      y >= 16 &&
      y <= this.height - 20;
    c.canvas.dataset.playerX = x.toFixed(1);
    c.canvas.dataset.playerY = y.toFixed(1);
    c.canvas.dataset.playerVisibility = visible ? "visible" : "direction";
    if (visible) {
      delete c.canvas.dataset.playerIndicatorX;
      delete c.canvas.dataset.playerIndicatorY;
      return;
    }
    const dx = x - this.width / 2,
      dy = y - this.height / 2;
    const t = Math.min(
      (this.width / 2 - 30) / Math.max(1, Math.abs(dx)),
      (this.height / 2 - 14) / Math.max(1, Math.abs(dy)),
      1,
    );
    let px = Math.max(30, Math.min(this.width - 30, this.width / 2 + dx * t));
    const py = Math.max(
      14,
      Math.min(this.height - 14, this.height / 2 + dy * t),
    );
    // An edge-attached cue cannot be mistaken for another character's YOU badge.
    if (mobile && py < 30) px = Math.max(80, Math.min(this.width - 80, px));
    if (mobile && py > this.height - 112 && (px < 120 || px > this.width - 160))
      px = Math.max(130, Math.min(this.width - 174, px));
    c.canvas.dataset.playerIndicatorX = px.toFixed(1);
    c.canvas.dataset.playerIndicatorY = py.toFixed(1);
    c.save();
    c.setTransform(
      c.canvas.width / this.width,
      0,
      0,
      c.canvas.height / this.height,
      0,
      0,
    );
    c.fillStyle = "#0b2435f0";
    c.strokeStyle = "#dcff91";
    c.lineWidth = 1.5;
    c.beginPath();
    c.roundRect(px - 29, py - 14, 58, 28, 7);
    c.fill();
    c.stroke();
    c.save();
    c.translate(px - 17, py);
    c.rotate(Math.atan2(dy, dx));
    c.strokeStyle = "#dcff91";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-7, 0);
    c.lineTo(7, 0);
    c.moveTo(2, -5);
    c.lineTo(7, 0);
    c.lineTo(2, 5);
    c.stroke();
    c.restore();
    c.fillStyle = "#dcff91";
    c.font = "800 10px sans-serif";
    c.textAlign = "center";
    c.fillText("YOU", px + 9, py + 4);
    c.restore();
  }
  private project(x: number, y: number, z: number) {
    this.v.set(x, y, z).project(this.camera);
    return {
      x: (this.v.x * 0.5 + 0.5) * 1320,
      y: (-0.5 * this.v.y + 0.5) * 800,
    };
  }
  drawLabels(
    c: CanvasRenderingContext2D,
    state: Snapshot,
    localId: string | null,
    mobile: boolean,
  ) {
    type Rect = { x: number; y: number; w: number; h: number };
    const placed: Rect[] = [];
    const actors = state.players
      .map((p) => ({ p, a: this.actors.get(p.id)! }))
      .filter((v) => v.a);
    const overlaps = (a: Rect, b: Rect) =>
      a.x < b.x + b.w + 4 &&
      a.x + a.w + 4 > b.x &&
      a.y < b.y + b.h + 3 &&
      a.y + a.h + 3 > b.y;
    const bodies = actors.map(({ a }) => {
      const ground = this.project(a.root.position.x, 0, a.root.position.z);
      const head = this.project(a.root.position.x, 1.15, a.root.position.z);
      const edge = this.project(
        a.root.position.x + 0.32,
        0.5,
        a.root.position.z,
      );
      const halfWidth = Math.max(23, Math.abs(edge.x - ground.x) + 5);
      return {
        x: ground.x - halfWidth,
        y: head.y - 5,
        w: halfWidth * 2,
        h: ground.y - head.y + 14,
      };
    });
    const fontSize = mobile ? Math.max(18, (9 * 1320) / this.width) : 14;
    c.save();
    c.textAlign = "center";
    c.font = `800 ${fontSize}px sans-serif`;
    for (const { p, a } of actors.sort(
      (a, b) =>
        (b.p.id === localId ? 2 : b.p.id === state.ball.owner ? 1 : 0) -
        (a.p.id === localId ? 2 : a.p.id === state.ball.owner ? 1 : 0),
    )) {
      const ground = this.project(a.root.position.x, 0, a.root.position.z),
        head = this.project(a.root.position.x, 1.05, a.root.position.z);
      if (ground.x < -50 || ground.x > 1370 || ground.y < -50 || ground.y > 850)
        continue;
      const text = p.name.toUpperCase(),
        w = c.measureText(text).width + 17,
        h = mobile ? Math.max(25, (13 * 800) / this.height) : 22;
      let box: Rect = { x: ground.x - w / 2, y: ground.y + 9, w, h };
      let found = false;
      for (const dy of [9, 36, -78, 64, -106, 92, -134]) {
        for (const dx of [0, -70, 70, -140, 140]) {
          const candidate = {
            x: Math.max(8, Math.min(1312 - w, ground.x - w / 2 + dx)),
            y: Math.max(14, Math.min(780 - h, ground.y + dy)),
            w,
            h,
          };
          if (
            !placed.some((r) => overlaps(candidate, r)) &&
            !bodies.some((r) => overlaps(candidate, r))
          ) {
            box = candidate;
            found = true;
            break;
          }
        }
        if (found) break;
      }
      if (mobile && !found && p.id !== localId && p.id !== state.ball.owner)
        continue;
      placed.push(box);
      c.lineWidth = 1;
      if (
        Math.abs(box.x + w / 2 - ground.x) > 15 ||
        Math.abs(box.y - ground.y - 9) > 10
      ) {
        c.strokeStyle = p.team === "LEADERS" ? "#a3dbff8a" : "#ffce9a8a";
        c.beginPath();
        c.moveTo(ground.x, ground.y);
        c.lineTo(box.x + w / 2, box.y + h / 2);
        c.stroke();
      }
      c.fillStyle = p.id === localId ? "#dfff93" : "#102739ed";
      c.strokeStyle = p.team === "LEADERS" ? "#92d6ff99" : "#ffc99299";
      c.beginPath();
      c.roundRect(box.x, box.y, w, h, 6);
      c.fill();
      c.stroke();
      c.fillStyle = p.id === localId ? "#1b362a" : "#fff7dd";
      c.fillText(text, box.x + w / 2, box.y + h - 6);
      if (p.id === localId) {
        const bx = ground.x < 100 ? ground.x + 38 : ground.x - 94,
          by = head.y < 80 ? head.y + 25 : head.y + 4;
        c.fillStyle = "#dcff91";
        c.strokeStyle = "#133043";
        c.lineWidth = 2;
        c.beginPath();
        c.roundRect(bx, by, 56, 28, 7);
        c.fill();
        c.stroke();
        c.fillStyle = "#153140";
        c.font = "900 20px sans-serif";
        c.fillText("YOU", bx + 28, by + 21);
        c.font = `800 ${fontSize}px sans-serif`;
      }
      if (p.keeper) {
        c.fillStyle = "#f6ffd6";
        c.font = "800 11px sans-serif";
        c.fillText("GK", head.x, head.y - 4);
        c.font = `800 ${fontSize}px sans-serif`;
      }
      if (p.chargeAt) {
        const value = Math.min(1, (state.now - p.chargeAt) / 1000);
        c.fillStyle = "#10283a";
        c.fillRect(head.x - 24, head.y - 13, 48, 6);
        c.fillStyle = "#e7ff9a";
        c.fillRect(head.x - 23, head.y - 12, 46 * value, 4);
      }
    }
    c.restore();
  }
}
