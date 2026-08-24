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
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    return mountCanvas2d(canvas);
  }
  renderer.setClearColor(0x000000, 0);
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));

  const scene = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
  camera.position.z = 2;
  camera.rotation.set(0, 0, 0);

  const texture = makeCircleTexture(THREE);
  const maxPoints = 512;
  const positions = new Float32Array(maxPoints * 3);
  const colors = new Float32Array(maxPoints * 3);
  const sizes = new Float32Array(maxPoints);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("size", new THREE.BufferAttribute(sizes, 1));

  const material = new THREE.ShaderMaterial({
    uniforms: { pointTexture: { value: texture } },
    vertexShader: `
      attribute float size;
      varying vec3 vColor;
      void main() {
        vColor = color;
        vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = size;
        gl_Position = projectionMatrix * mvPosition;
      }
    `,
    fragmentShader: `
      uniform sampler2D pointTexture;
      varying vec3 vColor;
      void main() {
        vec4 t = texture2D(pointTexture, gl_PointCoord);
        if (t.a < 0.05) discard;
        gl_FragColor = vec4(vColor, t.a);
      }
    `,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const points = new THREE.Points(geometry, material);
  scene.add(points);

  const trailPositions = new Float32Array(maxPoints * 6);
  const trailColors = new Float32Array(maxPoints * 6);
  const trailGeometry = new THREE.BufferGeometry();
  trailGeometry.setAttribute("position", new THREE.BufferAttribute(trailPositions, 3));
  trailGeometry.setAttribute("color", new THREE.BufferAttribute(trailColors, 3));
  const trailMaterial = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.55,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  const trails = new THREE.LineSegments(trailGeometry, trailMaterial);
  scene.add(trails);

  let nodes: RadarNodeView[] = [];

  const handle: RadarHandle = {
    engine: "webgl",
    setNodes(next) {
      nodes = next;
      writeNodes(THREE, canvas, next, positions, colors, sizes, trailPositions, trailColors, geometry, trailGeometry);
      render();
    },
    pick(clientX, clientY) {
      return pickNode(canvas, nodes, clientX, clientY);
    },
    resize() {
      const { width, height } = sizeOf(canvas);
      renderer.setSize(width, height, false);
      const aspect = width / Math.max(1, height);
      camera.left = -aspect;
      camera.right = aspect;
      camera.top = 1;
      camera.bottom = -1;
      camera.updateProjectionMatrix();
      writeNodes(THREE, canvas, nodes, positions, colors, sizes, trailPositions, trailColors, geometry, trailGeometry);
      render();
    },
    dispose() {
      geometry.dispose();
      material.dispose();
      texture.dispose();
      trailGeometry.dispose();
      trailMaterial.dispose();
      renderer.dispose();
    },
  };

  function render() {
    renderer.render(scene, camera);
  }

  try {
    handle.resize();
    return handle;
  } catch {
    handle.dispose();
    return mountCanvas2d(canvas);
  }
}

function writeNodes(
  THREE: ThreeModule,
  canvas: HTMLCanvasElement,
  nodes: RadarNodeView[],
  positions: Float32Array,
  colors: Float32Array,
  sizes: Float32Array,
  trailPositions: Float32Array,
  trailColors: Float32Array,
  geometry: InstanceType<ThreeModule["BufferGeometry"]>,
  trailGeometry: InstanceType<ThreeModule["BufferGeometry"]>,
) {
  const { width, height } = sizeOf(canvas);
  const aspect = width / Math.max(1, height);
  const color = new THREE.Color();
  let trailCount = 0;
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    const [wx, wy] = toWorld(n.x, n.y, aspect);
    positions[i * 3] = wx;
    positions[i * 3 + 1] = wy;
    positions[i * 3 + 2] = 0;
    color.set(n.color);
    const dim = 0.28 + n.intensity * 0.72;
    colors[i * 3] = color.r * dim;
    colors[i * 3 + 1] = color.g * dim;
    colors[i * 3 + 2] = color.b * dim;
    sizes[i] = 4 + n.size * 22;
    if (n.trail > 0.05) {
      const len = 0.03 + n.trail * 0.08;
      const t = trailCount * 6;
      trailPositions[t] = wx;
      trailPositions[t + 1] = wy;
      trailPositions[t + 2] = 0;
      trailPositions[t + 3] = wx - len * aspect;
      trailPositions[t + 4] = wy - len * 0.25;
      trailPositions[t + 5] = 0;
      trailColors[t] = color.r;
      trailColors[t + 1] = color.g;
      trailColors[t + 2] = color.b;
      trailColors[t + 3] = color.r * 0.1;
      trailColors[t + 4] = color.g * 0.1;
      trailColors[t + 5] = color.b * 0.1;
      trailCount += 1;
    }
  }
  geometry.setDrawRange(0, nodes.length);
  geometry.attributes.position.needsUpdate = true;
  geometry.attributes.color.needsUpdate = true;
  geometry.attributes.size.needsUpdate = true;
  trailGeometry.setDrawRange(0, trailCount * 2);
  trailGeometry.attributes.position.needsUpdate = true;
  trailGeometry.attributes.color.needsUpdate = true;
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
    drawCtx.clearRect(0, 0, width, height);
    for (const n of nodes) {
      const x = n.x * width;
      const y = n.y * height;
      const r = 2 + n.size * 9;
      if (n.trail > 0.05) {
        drawCtx.strokeStyle = n.color;
        drawCtx.globalAlpha = 0.35;
        drawCtx.beginPath();
        drawCtx.moveTo(x, y);
        drawCtx.lineTo(x - (18 + n.trail * 28), y - 6);
        drawCtx.stroke();
      }
      const g = drawCtx.createRadialGradient(x, y, 0, x, y, r * 3);
      g.addColorStop(0, n.color);
      g.addColorStop(1, "rgba(0,0,0,0)");
      drawCtx.globalAlpha = 0.2 + n.intensity * 0.5;
      drawCtx.fillStyle = g;
      drawCtx.beginPath();
      drawCtx.arc(x, y, r * 3, 0, Math.PI * 2);
      drawCtx.fill();
      drawCtx.globalAlpha = 0.7 + n.intensity * 0.3;
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

function makeCircleTexture(THREE: ThreeModule) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 64;
  const g = c.getContext("2d");
  if (!g) throw new Error("texture canvas");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.35, "rgba(255,255,255,0.55)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
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
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  return { width, height };
}

function pickNode(canvas: HTMLCanvasElement, nodes: RadarNodeView[], clientX: number, clientY: number): string | null {
  const rect = canvas.getBoundingClientRect();
  const px = (clientX - rect.left) / Math.max(1, rect.width);
  const py = (clientY - rect.top) / Math.max(1, rect.height);
  let best: { id: string; d: number } | null = null;
  for (const n of nodes) {
    const dx = n.x - px;
    const dy = n.y - py;
    const d = dx * dx + dy * dy;
    if (d < 0.0018 && (!best || d < best.d)) best = { id: n.id, d };
  }
  return best?.id ?? null;
}
