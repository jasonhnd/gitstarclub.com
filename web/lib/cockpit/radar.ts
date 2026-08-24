export type RadarNodeView = {
  id: string;
  x: number;
  y: number;
  color: string;
  size: number;
  intensity: number;
  trail: number;
};

export type RadarHandle = {
  setNodes: (nodes: RadarNodeView[]) => void;
  pick: (clientX: number, clientY: number) => string | null;
  resize: () => void;
  dispose: () => void;
  engine: "webgl" | "canvas2d";
};

type ThreeModule = typeof import("three");

export async function mountRadar(canvas: HTMLCanvasElement): Promise<RadarHandle> {
  try {
    const THREE = await import("three");
    return mountWebgl(canvas, THREE);
  } catch {
    return mountCanvas2d(canvas);
  }
}

function mountWebgl(canvas: HTMLCanvasElement, THREE: ThreeModule): RadarHandle {
  let renderer: InstanceType<ThreeModule["WebGLRenderer"]>;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
  } catch {
    return mountCanvas2d(canvas);
  }
  renderer.setClearColor(0x07080a, 1);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.set(0, 0, 5);

  const rings = new THREE.Group();
  const ringMat = new THREE.LineBasicMaterial({ color: 0xf2a900, transparent: true, opacity: 0.12 });
  for (const r of [0.28, 0.52, 0.78]) {
    const pts = Array.from({ length: 97 }, (_, i) => {
      const a = (i / 96) * Math.PI * 2;
      return new THREE.Vector3(Math.cos(a) * r, Math.sin(a) * r * 0.78, 0);
    });
    rings.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), ringMat));
  }
  scene.add(rings);

  const texture = makeStarTexture(THREE);
  const maxPoints = 512;
  const geometry = new THREE.PlaneGeometry(1, 1);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    toneMapped: false,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, maxPoints);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  scene.add(mesh);

  const dummy = new THREE.Object3D();
  const color = new THREE.Color();
  let nodes: RadarNodeView[] = [];

  const handle: RadarHandle = {
    engine: "webgl",
    setNodes(next) {
      nodes = next;
      writeInstances(canvas, next, mesh, dummy, color, camera);
      renderer.render(scene, camera);
    },
    pick(clientX, clientY) {
      return pickNode(canvas, nodes, clientX, clientY);
    },
    resize() {
      const { width, height } = sizeOf(canvas);
      renderer.setSize(width, height, false);
      writeInstances(canvas, nodes, mesh, dummy, color, camera);
      renderer.render(scene, camera);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
      ringMat.dispose();
      renderer.dispose();
    },
  };

  handle.resize();
  return handle;
}

function writeInstances(
  canvas: HTMLCanvasElement,
  nodes: RadarNodeView[],
  mesh: InstanceType<ThreeModule["InstancedMesh"]>,
  dummy: InstanceType<ThreeModule["Object3D"]>,
  color: InstanceType<ThreeModule["Color"]>,
  camera: InstanceType<ThreeModule["OrthographicCamera"]>,
) {
  const { width, height } = sizeOf(canvas);
  const aspect = width / Math.max(1, height);
  camera.left = -aspect;
  camera.right = aspect;
  camera.top = 1;
  camera.bottom = -1;
  camera.updateProjectionMatrix();

  const count = Math.min(nodes.length, 512);
  mesh.count = count;
  for (let i = 0; i < count; i++) {
    const n = nodes[i];
    const [wx, wy] = toWorld(n.x, n.y, aspect);
    const scale = n.size <= 0 ? 0 : 0.012 + n.size * 0.055;
    dummy.position.set(wx, wy, 0);
    dummy.scale.set(scale * aspect, scale, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    color.set(n.color);
    color.multiplyScalar(0.35 + n.intensity * 0.9);
    mesh.setColorAt(i, color);
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

function mountCanvas2d(canvas: HTMLCanvasElement): RadarHandle {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d canvas unavailable");
  const drawCtx = ctx;
  let nodes: RadarNodeView[] = [];

  const handle: RadarHandle = {
    engine: "canvas2d",
    setNodes(next) {
      nodes = next;
      draw();
    },
    pick(clientX, clientY) {
      return pickNode(canvas, nodes, clientX, clientY);
    },
    resize() {
      const { width, height } = sizeOf(canvas);
      canvas.width = Math.round(width * Math.min(2, window.devicePixelRatio || 1));
      canvas.height = Math.round(height * Math.min(2, window.devicePixelRatio || 1));
      draw();
    },
    dispose() {},
  };

  function draw() {
    const { width, height } = sizeOf(canvas);
    const dpr = canvas.width / Math.max(1, width);
    drawCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawCtx.fillStyle = "#07080a";
    drawCtx.fillRect(0, 0, width, height);
    drawCtx.strokeStyle = "rgba(242,169,0,0.12)";
    drawCtx.lineWidth = 1;
    for (const r of [0.18, 0.32, 0.46]) {
      drawCtx.beginPath();
      drawCtx.ellipse(width / 2, height / 2, width * r, height * r, 0, 0, Math.PI * 2);
      drawCtx.stroke();
    }
    drawCtx.globalCompositeOperation = "lighter";
    for (const n of nodes) {
      if (n.size <= 0) continue;
      const x = n.x * width;
      const y = n.y * height;
      const r = 1.6 + n.size * 10;
      const g = drawCtx.createRadialGradient(x, y, 0, x, y, r * 4);
      g.addColorStop(0, n.color);
      g.addColorStop(0.22, n.color);
      g.addColorStop(1, "rgba(0,0,0,0)");
      drawCtx.globalAlpha = 0.25 + n.intensity * 0.55;
      drawCtx.fillStyle = g;
      drawCtx.beginPath();
      drawCtx.arc(x, y, r * 4, 0, Math.PI * 2);
      drawCtx.fill();
      drawCtx.globalAlpha = 0.9;
      drawCtx.fillStyle = "#fff8e8";
      drawCtx.beginPath();
      drawCtx.arc(x, y, Math.max(0.8, r * 0.28), 0, Math.PI * 2);
      drawCtx.fill();
    }
    drawCtx.globalCompositeOperation = "source-over";
    drawCtx.globalAlpha = 1;
  }

  handle.resize();
  return handle;
}

function makeStarTexture(THREE: ThreeModule) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  if (!g) throw new Error("texture canvas");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.18, "rgba(255,248,220,0.9)");
  grd.addColorStop(0.42, "rgba(255,186,59,0.35)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const texture = new THREE.CanvasTexture(c);
  texture.needsUpdate = true;
  return texture;
}

function toWorld(x: number, y: number, aspect: number): [number, number] {
  return [(x - 0.5) * 2 * aspect, (0.5 - y) * 2];
}

function sizeOf(canvas: HTMLCanvasElement): { width: number; height: number } {
  return {
    width: Math.max(1, canvas.clientWidth),
    height: Math.max(1, canvas.clientHeight),
  };
}

function pickNode(canvas: HTMLCanvasElement, nodes: RadarNodeView[], clientX: number, clientY: number): string | null {
  const rect = canvas.getBoundingClientRect();
  const px = (clientX - rect.left) / Math.max(1, rect.width);
  const py = (clientY - rect.top) / Math.max(1, rect.height);
  let best: { id: string; d: number } | null = null;
  for (const n of nodes) {
    if (n.size <= 0) continue;
    const dx = n.x - px;
    const dy = n.y - py;
    const d = dx * dx + dy * dy;
    if (d < 0.0016 && (!best || d < best.d)) best = { id: n.id, d };
  }
  return best?.id ?? null;
}
