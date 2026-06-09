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

type GizmoDrag = {
  field: keyof Cylinder;
  startMouseX: number;
  startMouseY: number;
  startValue: number;
  screenAxis: THREE.Vector2;
  min: number;
  max: number;
  sensitivity: number;
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
  const gizmoHandlesRef = useRef<THREE.Mesh[]>([]);
  const gizmoDragRef = useRef<GizmoDrag | null>(null);
  const hoveredFieldRef = useRef<string | null>(null);

  const cylinders = useSignal<Cylinder[]>([]);
  const selected = useSignal<number | null>(null);
  const placing = useSignal(false);

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

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.2);
    sun.position.set(8, 14, 6);
    sun.castShadow = true;
    scene.add(sun);

    scene.add(new THREE.GridHelper(20, 20, 0x334466, 0x222244));

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshBasicMaterial({ visible: false, side: THREE.DoubleSide }),
    );
    ground.rotation.x = -Math.PI / 2;
    scene.add(ground);
    groundRef.current = ground;

    // ── Gizmo ─────────────────────────────────────────────────────────────
    const gizmoGroup = new THREE.Group();
    gizmoGroup.visible = false;
    scene.add(gizmoGroup);

    // Per-mesh material so each can be independently colored on hover
    const mkMat = (color: number) =>
      new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });

    // Map field → [shaft, cone] or [sphere] for hover updates
    const gizmoMeshesByField = new Map<string, THREE.Mesh[]>();

    const shaftGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.5, 8);
    const coneGeo  = new THREE.ConeGeometry(0.14, 0.35, 8);
    const sphereGeo = new THREE.SphereGeometry(0.2, 12, 12);

    // Build an interactive arrow (shaft + cone share the same field/axis data)
    const addArrow = (
      normalColor: number, hoverColor: number,
      shaftPos: THREE.Vector3, conePos: THREE.Vector3, rz: number, rx: number,
      field: keyof Cylinder, worldAxis: THREE.Vector3,
      min: number, max: number, sensitivity: number,
    ) => {
      const ud = { field, worldAxis: worldAxis.clone(), min, max, sensitivity, normalColor, hoverColor };
      const meshes: THREE.Mesh[] = [];
      for (const [geo, pos] of [[shaftGeo, shaftPos], [coneGeo, conePos]] as [THREE.BufferGeometry, THREE.Vector3][]) {
        const m = new THREE.Mesh(geo, mkMat(normalColor));
        m.position.copy(pos);
        m.rotation.z = rz; m.rotation.x = rx;
        m.renderOrder = 998;
        m.userData = ud;
        gizmoGroup.add(m);
        gizmoHandlesRef.current.push(m);
        meshes.push(m);
      }
      gizmoMeshesByField.set(field as string, meshes);
    };

    // Build an interactive sphere handle (height / radius)
    const addSphere = (
      normalColor: number, hoverColor: number, pos: THREE.Vector3,
      field: keyof Cylinder, worldAxis: THREE.Vector3,
      min: number, max: number, sensitivity: number,
    ) => {
      const ud = { field, worldAxis: worldAxis.clone(), min, max, sensitivity, normalColor, hoverColor };
      const m = new THREE.Mesh(sphereGeo, mkMat(normalColor));
      m.position.copy(pos);
      m.renderOrder = 999;
      m.userData = ud;
      gizmoGroup.add(m);
      gizmoHandlesRef.current.push(m);
      gizmoMeshesByField.set(field as string, [m]);
      return m;
    };

    // X=red, Y=green, Z=blue — shafts 0→1.5, cones 1.5→1.85
    addArrow(0xff4444, 0xff9999, new THREE.Vector3(0.75, 0, 0),  new THREE.Vector3(1.675, 0, 0),  -Math.PI / 2, 0,          "x", new THREE.Vector3(1, 0, 0), -9,  9,  14);
    addArrow(0x44ff44, 0x99ff99, new THREE.Vector3(0, 0.75, 0),  new THREE.Vector3(0, 1.675, 0),  0,            0,          "y", new THREE.Vector3(0, 1, 0),  0,  8,  10);
    addArrow(0x4488ff, 0x88bbff, new THREE.Vector3(0, 0, 0.75),  new THREE.Vector3(0, 0, 1.675),  0,            Math.PI / 2,"z", new THREE.Vector3(0, 0, 1), -9,  9,  14);

    // Height (yellow) and radius (cyan) sphere handles — positioned dynamically in loop
    const heightHandle = addSphere(0xffdd00, 0xffee88, new THREE.Vector3(0, 3, 0),   "height", new THREE.Vector3(0, 1, 0), 0.2, 10, 8);
    const radiusHandle = addSphere(0x00ddff, 0x88eeff, new THREE.Vector3(1, 0, 0),   "radius", new THREE.Vector3(1, 0, 0), 0.1,  4, 5);

    // Dynamic connector lines for height and radius handles
    const mkDynLine = (color: number) => {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.45 }));
      line.renderOrder = 997;
      gizmoGroup.add(line);
      return geo;
    };
    const hLineGeo = mkDynLine(0xffdd00);
    const rLineGeo = mkDynLine(0x00ddff);

    // Hover helpers
    const setHover = (field: string | null) => {
      if (field === hoveredFieldRef.current) return;
      if (hoveredFieldRef.current) {
        for (const m of gizmoMeshesByField.get(hoveredFieldRef.current) ?? []) {
          (m.material as THREE.MeshBasicMaterial).color.setHex(m.userData.normalColor);
        }
      }
      hoveredFieldRef.current = field;
      if (field) {
        for (const m of gizmoMeshesByField.get(field) ?? []) {
          (m.material as THREE.MeshBasicMaterial).color.setHex(m.userData.hoverColor);
        }
      }
      canvas.style.cursor = field ? "grab" : "";
    };
    // ── End gizmo ──────────────────────────────────────────────────────────

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

      const selId = selected.value;
      if (selId !== null) {
        const cyl = cylinders.value.find((c) => c.id === selId);
        if (cyl) {
          gizmoGroup.visible = true;
          gizmoGroup.position.set(cyl.x, cyl.y, cyl.z);

          const hOff = cyl.height + 0.35;
          const rOff = cyl.radius + 0.35;
          heightHandle.position.set(0, hOff, 0);
          radiusHandle.position.set(rOff, cyl.height / 2, 0);

          const hp = hLineGeo.attributes.position as THREE.BufferAttribute;
          hp.setXYZ(0, 0, cyl.height, 0); hp.setXYZ(1, 0, hOff, 0); hp.needsUpdate = true;

          const rp = rLineGeo.attributes.position as THREE.BufferAttribute;
          rp.setXYZ(0, 0, cyl.height / 2, 0); rp.setXYZ(1, rOff, cyl.height / 2, 0); rp.needsUpdate = true;
        } else {
          gizmoGroup.visible = false;
        }
      } else {
        gizmoGroup.visible = false;
      }

      renderer.render(scene, camera);
    };
    loop();

    const ro = new ResizeObserver(() => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    });
    ro.observe(canvas);

    const screenAxis = (worldAxis: THREE.Vector3): THREE.Vector2 => {
      const o = new THREE.Vector3(0, 0, 0).project(camera);
      const a = worldAxis.clone().project(camera);
      return new THREE.Vector2(a.x - o.x, -(a.y - o.y)).normalize();
    };

    const raycastNDC = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      return { ray, ndc };
    };

    const onDown = (e: MouseEvent) => {
      if (e.button !== 0) return;

      if (gizmoGroup.visible && gizmoHandlesRef.current.length > 0) {
        const { ray } = raycastNDC(e.clientX, e.clientY);
        const hits = ray.intersectObjects(gizmoHandlesRef.current);
        if (hits.length > 0) {
          const ud = hits[0].object.userData;
          const cyl = cylinders.value.find((c) => c.id === selected.value);
          if (cyl) {
            gizmoDragRef.current = {
              field: ud.field,
              startMouseX: e.clientX,
              startMouseY: e.clientY,
              startValue: cyl[ud.field as keyof Cylinder] as number,
              screenAxis: screenAxis(ud.worldAxis as THREE.Vector3),
              min: ud.min, max: ud.max, sensitivity: ud.sensitivity,
            };
            setHover(null);
            canvas.style.cursor = "grabbing";
            dragMovedRef.current = true;
            return;
          }
        }
      }

      orbitRef.current.dragging = true;
      orbitRef.current.lx = e.clientX;
      orbitRef.current.ly = e.clientY;
      dragMovedRef.current = false;
    };

    const onMove = (e: MouseEvent) => {
      const drag = gizmoDragRef.current;
      if (drag) {
        const dx = e.clientX - drag.startMouseX;
        const dy = e.clientY - drag.startMouseY;
        const dot = (dx / canvas.clientWidth) * 2 * drag.screenAxis.x
                  + (dy / canvas.clientHeight) * 2 * drag.screenAxis.y;
        const newVal = Math.max(drag.min, Math.min(drag.max, drag.startValue + dot * drag.sensitivity));
        const selId = selected.value;
        cylinders.value = cylinders.value.map((c) =>
          c.id === selId ? { ...c, [drag.field]: parseFloat(newVal.toFixed(3)) } : c
        );
        return;
      }

      if (orbitRef.current.dragging) {
        const dx = e.clientX - orbitRef.current.lx;
        const dy = e.clientY - orbitRef.current.ly;
        if (Math.abs(dx) + Math.abs(dy) > 4) dragMovedRef.current = true;
        orbitRef.current.theta -= dx * 0.008;
        orbitRef.current.phi = Math.max(0.15, Math.min(1.55, orbitRef.current.phi + dy * 0.008));
        orbitRef.current.lx = e.clientX;
        orbitRef.current.ly = e.clientY;
        syncCamera();
        return;
      }

      // Hover detection (only when idle)
      if (gizmoGroup.visible) {
        const { ray } = raycastNDC(e.clientX, e.clientY);
        const hits = ray.intersectObjects(gizmoHandlesRef.current);
        setHover(hits.length > 0 ? hits[0].object.userData.field as string : null);
      } else {
        setHover(null);
      }
    };

    const onUp = () => {
      orbitRef.current.dragging = false;
      if (gizmoDragRef.current) {
        gizmoDragRef.current = null;
        canvas.style.cursor = "";
      }
    };

    const onWheel = (e: WheelEvent) => {
      orbitRef.current.r = Math.max(3, Math.min(50, orbitRef.current.r + e.deltaY * 0.02));
      syncCamera();
    };

    const onLeave = () => setHover(null);

    canvas.addEventListener("mousedown", onDown);
    canvas.addEventListener("mouseleave", onLeave);
    globalThis.addEventListener("mousemove", onMove);
    globalThis.addEventListener("mouseup", onUp);
    canvas.addEventListener("wheel", onWheel, { passive: true });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      gizmoHandlesRef.current = [];
      canvas.removeEventListener("mousedown", onDown);
      canvas.removeEventListener("mouseleave", onLeave);
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
