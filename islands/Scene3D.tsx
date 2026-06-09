import { useComputed, useSignal } from "@preact/signals";
import { useEffect, useRef } from "preact/hooks";
import * as THREE from "three";

type Cylinder = {
  id: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
};

let uid = 1;

export default function Scene3D() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const meshMapRef = useRef<Map<number, THREE.Mesh>>(new Map());
  const groundRef = useRef<THREE.Mesh | null>(null);
  const orbitRef = useRef({ theta: 0.4, phi: 1.1, r: 15, dragging: false, lx: 0, ly: 0 });
  const dragMovedRef = useRef(false);

  const cylinders = useSignal<Cylinder[]>([]);
  const selected = useSignal<number | null>(null);
  const placing = useSignal(false);

  // Init Three.js
  useEffect(() => {
    const canvas = canvasRef.current!;
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x181824);
    scene.fog = new THREE.Fog(0x181824, 25, 60);
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(55, canvas.clientWidth / canvas.clientHeight, 0.1, 500);
    cameraRef.current = camera;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(globalThis.devicePixelRatio ?? 1);
    renderer.setSize(canvas.clientWidth, canvas.clientHeight, false);
    renderer.shadowMap.enabled = true;
    rendererRef.current = renderer;

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(8, 14, 6);
    sun.castShadow = true;
    scene.add(sun);

    // Grid
    scene.add(new THREE.GridHelper(20, 20, 0x334466, 0x222244));

    // Invisible ground plane for raycasting
    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    groundRef.current = ground;

    const syncCamera = () => {
      const { theta, phi, r } = orbitRef.current;
      camera.position.set(
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
        r * Math.sin(phi) * Math.cos(theta),
      );
      camera.lookAt(0, 0, 0);
    };
    syncCamera();

    let raf: number;
    const loop = () => {
      raf = requestAnimationFrame(loop);
      renderer.render(scene, camera);
    };
    loop();

    const ro = new ResizeObserver(() => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    });
    ro.observe(canvas);

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      orbitRef.current.dragging = true;
      orbitRef.current.lx = e.clientX;
      orbitRef.current.ly = e.clientY;
      dragMovedRef.current = false;
    };
    const onMove = (e: MouseEvent) => {
      if (!orbitRef.current.dragging) return;
      const dx = e.clientX - orbitRef.current.lx;
      const dy = e.clientY - orbitRef.current.ly;
      if (Math.abs(dx) + Math.abs(dy) > 4) dragMovedRef.current = true;
      orbitRef.current.theta -= dx * 0.008;
      orbitRef.current.phi = Math.max(0.15, Math.min(1.55, orbitRef.current.phi + dy * 0.008));
      orbitRef.current.lx = e.clientX;
      orbitRef.current.ly = e.clientY;
      syncCamera();
    };
    const onUp = () => { orbitRef.current.dragging = false; };
    const onWheel = (e: WheelEvent) => {
      orbitRef.current.r = Math.max(3, Math.min(50, orbitRef.current.r + e.deltaY * 0.02));
      syncCamera();
    };

    canvas.addEventListener("mousedown", onDown);
    globalThis.addEventListener("mousemove", onMove);
    globalThis.addEventListener("mouseup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: true });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      canvas.removeEventListener("mousedown", onDown);
      globalThis.removeEventListener("mousemove", onMove);
      globalThis.removeEventListener("mouseup", onUp);
      canvas.removeEventListener("wheel", onWheel);
    };
  }, []);

  // Sync cylinders state → Three.js meshes
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const ids = new Set(cylinders.value.map((c) => c.id));

    for (const [id, mesh] of meshMapRef.current) {
      if (!ids.has(id)) {
        scene.remove(mesh);
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
        meshMapRef.current.delete(id);
      }
    }

    for (const cyl of cylinders.value) {
      const color = cyl.id === selected.value ? 0xff7744 : 0x3399ff;

      if (!meshMapRef.current.has(cyl.id)) {
        const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 });
        // Unit cylinder: radius=1, height=1 — driven entirely by scale
        const mesh = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 32), mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        mesh.userData.id = cyl.id;
        scene.add(mesh);
        meshMapRef.current.set(cyl.id, mesh);
      }

      const mesh = meshMapRef.current.get(cyl.id)!;
      mesh.scale.set(cyl.radius, cyl.height, cyl.radius);
      mesh.position.set(cyl.x, cyl.y + cyl.height / 2, cyl.z);
      (mesh.material as THREE.MeshStandardMaterial).color.setHex(color);
    }
  }, [cylinders.value, selected.value]);

  const handleClick = (e: MouseEvent) => {
    if (dragMovedRef.current) return;
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, cameraRef.current!);

    if (placing.value) {
      const hits = ray.intersectObject(groundRef.current!);
      if (hits.length > 0) {
        const p = hits[0].point;
        cylinders.value = [
          ...cylinders.value,
          { id: uid++, x: parseFloat(p.x.toFixed(2)), y: 0, z: parseFloat(p.z.toFixed(2)), radius: 0.5, height: 2 },
        ];
        placing.value = false;
      }
      return;
    }

    const hits = ray.intersectObjects([...meshMapRef.current.values()]);
    selected.value = hits.length > 0 ? (hits[0].object.userData.id as number) : null;
  };

  const updateProp = (field: keyof Cylinder, val: number) => {
    cylinders.value = cylinders.value.map((c) => (c.id === selected.value ? { ...c, [field]: val } : c));
  };

  const selectedCyl = useComputed(() => cylinders.value.find((c) => c.id === selected.value));

  const sliders = [
    { key: "x" as const, label: "X", min: -9, max: 9, step: 0.1 },
    { key: "y" as const, label: "Y (lift)", min: 0, max: 8, step: 0.1 },
    { key: "z" as const, label: "Z", min: -9, max: 9, step: 0.1 },
    { key: "radius" as const, label: "Radius", min: 0.1, max: 4, step: 0.05 },
    { key: "height" as const, label: "Height", min: 0.2, max: 10, step: 0.1 },
  ] as const;

  return (
    <div style="position:relative;width:100vw;height:100vh;overflow:hidden;font-family:ui-sans-serif,sans-serif;">
      <canvas
        ref={canvasRef}
        style="display:block;width:100%;height:100%;"
        onClick={handleClick}
      />

      <aside style="position:absolute;top:0;left:0;width:210px;height:100%;background:rgba(8,8,18,0.88);color:#ccc;padding:12px;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;overflow-y:auto;">
        <span style="font-size:13px;font-weight:700;color:#88aaff;letter-spacing:.06em;">3D SCENE</span>

        <button
          onClick={() => { placing.value = !placing.value; }}
          style={`padding:6px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;color:#fff;background:${placing.value ? "#bb3311" : "#2255cc"};`}
        >
          {placing.value ? "✕  Cancel" : "+  Add Cylinder"}
        </button>

        {placing.value && (
          <p style="font-size:11px;color:#6677aa;margin:0;">Click the ground to place</p>
        )}

        {cylinders.value.length > 0 && (
          <div style="font-size:10px;color:#445;text-transform:uppercase;letter-spacing:.08em;margin-top:4px;">
            Objects
          </div>
        )}

        {cylinders.value.map((c) => (
          <div
            key={c.id}
            onClick={() => { selected.value = c.id === selected.value ? null : c.id; }}
            style={`padding:5px 8px;border-radius:3px;cursor:pointer;font-size:11px;user-select:none;
              background:${c.id === selected.value ? "#152238" : "#0e0e1a"};
              color:${c.id === selected.value ? "#88aaff" : "#999"};
              border:1px solid ${c.id === selected.value ? "#2a4488" : "transparent"};`}
          >
            Cylinder {c.id}
          </div>
        ))}

        {selectedCyl.value && (
          <div style="margin-top:4px;display:flex;flex-direction:column;gap:8px;border-top:1px solid #1e1e30;padding-top:10px;">
            <span style="font-size:10px;color:#445;text-transform:uppercase;letter-spacing:.08em;">Properties</span>
            {sliders.map(({ key, label, min, max, step }) => (
              <label key={key} style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#aaa;">
                <span style="display:flex;justify-content:space-between;">
                  <span>{label}</span>
                  <span style="color:#88aaff;">{selectedCyl.value![key].toFixed(2)}</span>
                </span>
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={step}
                  value={selectedCyl.value![key]}
                  onInput={(e) =>
                    updateProp(key, parseFloat((e.target as HTMLInputElement).value))}
                  style="width:100%;accent-color:#3388ff;"
                />
              </label>
            ))}
            <button
              onClick={() => {
                cylinders.value = cylinders.value.filter((c) => c.id !== selected.value);
                selected.value = null;
              }}
              style="padding:4px 8px;background:#771111;border:none;border-radius:3px;color:#eee;font-size:11px;cursor:pointer;"
            >
              Delete
            </button>
          </div>
        )}
      </aside>

      <div style="position:absolute;bottom:10px;right:12px;color:#333;font-size:10px;text-align:right;pointer-events:none;">
        Left-drag · orbit &nbsp;|&nbsp; Scroll · zoom &nbsp;|&nbsp; Click · select
      </div>
    </div>
  );
}
