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
  renderer.setClearColor(0x0b0c0e, 1);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.set(0, 0, 5);

  const maxPoints = 512;
  const geometry = new THREE.CircleGeometry(1, 28);
  const material = new THREE.MeshBasicMaterial({
    transparent: true,
    depthWrite: false,
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
      writeInstances(THREE, canvas, next, mesh, dummy, color, camera);
      renderer.render(scene, camera);
    },
    pick(clientX, clientY) {
      return pickNode(canvas, nodes, clientX, clientY);
    },
    resize() {
      const { width, height } = sizeOf(canvas);
      renderer.setSize(width, height, false);
      writeInstances(THREE, canvas, nodes, mesh, dummy, color, camera);
      renderer.render(scene, camera);
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      renderer.dispose();
    },
  };

  handle.resize();
  return handle;
}

function writeInstances(
  THREE: ThreeModule,
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
    const scale = n.size > 0.001 ? 0.018 + n.size * 0.16 : 0;
    dummy.position.set(wx, wy, 0);
    dummy.scale.set(scale, scale, 1);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    color.set(n.color);
    const shade = 0.45 + n.intensity * 0.55;
    mesh.setColorAt(i, color.multiplyScalar(shade));
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
    drawCtx.fillStyle = "#0b0c0e";
    drawCtx.fillRect(0, 0, width, height);
    for (const n of nodes) {
      if (n.size <= 0.001) continue;
      const x = n.x * width;
      const y = n.y * height;
      const r = 3 + n.size * 28;
      const g = drawCtx.createRadialGradient(x, y, 0, x, y, r * 2.4);
      g.addColorStop(0, n.color);
      g.addColorStop(1, "rgba(0,0,0,0)");
      drawCtx.globalAlpha = 0.35 + n.intensity * 0.5;
      drawCtx.fillStyle = g;
      drawCtx.beginPath();
      drawCtx.arc(x, y, r * 2.4, 0, Math.PI * 2);
      drawCtx.fill();
      drawCtx.globalAlpha = 0.85;
      drawCtx.fillStyle = n.color;
      drawCtx.beginPath();
      drawCtx.arc(x, y, r, 0, Math.PI * 2);
      drawCtx.fill();
    }
    drawCtx.globalAlpha = 1;
  }

  handle.resize();
  return handle;
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
    if (n.size <= 0.001) continue;
    const dx = n.x - px;
    const dy = n.y - py;
    const d = dx * dx + dy * dy;
    if (d < 0.0022 && (!best || d < best.d)) best = { id: n.id, d };
  }
  return best?.id ?? null;
}
