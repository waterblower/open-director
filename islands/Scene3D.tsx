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

type ImagePlane = {
  id: number;
  name: string;
  url: string;
  x: number;
  y: number;
  z: number;
  rotX: number;
  rotY: number;
  rotZ: number;
  width: number;
  height: number;
};

// GizmoDrag uses a callback so one handler covers both object types
type GizmoDrag = {
  startMouseX: number;
  startMouseY: number;
  startValue: number;
  screenAxis: THREE.Vector2;
  min: number;
  max: number;
  sensitivity: number;
  commit: (val: number) => void;
};

const texLoader = new THREE.TextureLoader();
let uid = 1;

export default function Scene3D() {
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const sceneRef    = useRef<THREE.Scene | null>(null);
  const cameraRef   = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

  const meshMapRef      = useRef<Map<number, THREE.Mesh>>(new Map());
  const imageMeshMapRef = useRef<Map<number, THREE.Mesh>>(new Map());
  const imageUrlMapRef  = useRef<Map<number, string>>(new Map());
  const groundRef       = useRef<THREE.Mesh | null>(null);

  const orbitRef      = useRef({ theta: 0.4, phi: 1.1, r: 15, tx: 0, ty: 0, tz: 0, dragging: false, midDragging: false, lx: 0, ly: 0 });
  const dragMovedRef  = useRef(false);
  const keysRef        = useRef<Set<string>>(new Set());
  const syncCameraRef  = useRef<(() => void) | null>(null);
  const gizmoHandlesRef = useRef<THREE.Mesh[]>([]);
  const gizmoDragRef    = useRef<GizmoDrag | null>(null);
  const hoveredFieldRef = useRef<string | null>(null);
  const fileInputRef    = useRef<HTMLInputElement>(null);

  const cylinders      = useSignal<Cylinder[]>([]);
  const selected       = useSignal<number | null>(null);
  const placing        = useSignal(false);
  const images         = useSignal<ImagePlane[]>([]);
  const selectedImgId  = useSignal<number | null>(null);

  // ── Three.js init ──────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current!;
    const scene  = new THREE.Scene();
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

    // ── Gizmo ──────────────────────────────────────────────────────────
    const gizmoGroup = new THREE.Group();
    gizmoGroup.visible = false;
    scene.add(gizmoGroup);

    const mkMat = (color: number) =>
      new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.9 });

    // Each field maps to [shaft, cone] or [sphere] for batch hover updates
    const meshesByField = new Map<string, THREE.Mesh[]>();

    const shaftGeo  = new THREE.CylinderGeometry(0.07, 0.07, 1.5, 8);
    const coneGeo   = new THREE.ConeGeometry(0.14, 0.35, 8);
    const sphereGeo = new THREE.SphereGeometry(0.2, 12, 12);

    const addArrow = (
      nc: number, hc: number,
      sPos: THREE.Vector3, cPos: THREE.Vector3, rz: number, rx: number,
      field: string, axis: THREE.Vector3, min: number, max: number, sens: number,
    ) => {
      const ud = { field, axis: axis.clone(), min, max, sens, nc, hc };
      const meshes: THREE.Mesh[] = [];
      for (const [geo, pos] of [[shaftGeo, sPos], [coneGeo, cPos]] as [THREE.BufferGeometry, THREE.Vector3][]) {
        const m = new THREE.Mesh(geo, mkMat(nc));
        m.position.copy(pos); m.rotation.z = rz; m.rotation.x = rx;
        m.renderOrder = 998; m.userData = ud;
        gizmoGroup.add(m);
        gizmoHandlesRef.current.push(m);
        meshes.push(m);
      }
      meshesByField.set(field, meshes);
    };

    const addSphere = (
      nc: number, hc: number, pos: THREE.Vector3,
      field: string, axis: THREE.Vector3, min: number, max: number, sens: number,
    ) => {
      const ud = { field, axis: axis.clone(), min, max, sens, nc, hc };
      const m = new THREE.Mesh(sphereGeo, mkMat(nc));
      m.position.copy(pos); m.renderOrder = 999; m.userData = ud;
      gizmoGroup.add(m);
      gizmoHandlesRef.current.push(m);
      meshesByField.set(field, [m]);
      return m;
    };

    // X/Y/Z translation — shared for cylinders and images
    addArrow(0xff4444, 0xff9999, new THREE.Vector3(0.75, 0, 0),  new THREE.Vector3(1.675, 0, 0),  -Math.PI / 2, 0,           "x", new THREE.Vector3(1, 0, 0), -9, 9,  14);
    addArrow(0x44ff44, 0x99ff99, new THREE.Vector3(0, 0.75, 0),  new THREE.Vector3(0, 1.675, 0),  0,            0,           "y", new THREE.Vector3(0, 1, 0), -5, 10, 10);
    addArrow(0x4488ff, 0x88bbff, new THREE.Vector3(0, 0, 0.75),  new THREE.Vector3(0, 0, 1.675),  0,            Math.PI / 2, "z", new THREE.Vector3(0, 0, 1), -9, 9,  14);

    // Cylinder-only handles (hidden for images)
    const heightHandle = addSphere(0xffdd00, 0xffee88, new THREE.Vector3(0, 3, 0),   "height", new THREE.Vector3(0, 1, 0), 0.2, 10, 8);
    const radiusHandle = addSphere(0x00ddff, 0x88eeff, new THREE.Vector3(1, 0, 0),   "radius", new THREE.Vector3(1, 0, 0), 0.1, 4,  5);

    const mkDynLine = (color: number) => {
      const geo  = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, depthTest: false, transparent: true, opacity: 0.4 }));
      line.renderOrder = 997; gizmoGroup.add(line);
      return { line, geo };
    };
    const { line: hLine, geo: hGeo } = mkDynLine(0xffdd00);
    const { line: rLine, geo: rGeo } = mkDynLine(0x00ddff);

    const setHover = (field: string | null) => {
      if (field === hoveredFieldRef.current) return;
      if (hoveredFieldRef.current)
        for (const m of meshesByField.get(hoveredFieldRef.current) ?? [])
          (m.material as THREE.MeshBasicMaterial).color.setHex(m.userData.nc);
      hoveredFieldRef.current = field;
      if (field)
        for (const m of meshesByField.get(field) ?? [])
          (m.material as THREE.MeshBasicMaterial).color.setHex(m.userData.hc);
      canvas.style.cursor = field ? "grab" : "";
    };
    // ── End gizmo ──────────────────────────────────────────────────────

    const syncCamera = () => {
      const { theta, phi, r, tx, ty, tz } = orbitRef.current;
      camera.position.set(
        tx + r * Math.sin(phi) * Math.sin(theta),
        ty + r * Math.cos(phi),
        tz + r * Math.sin(phi) * Math.cos(theta),
      );
      camera.lookAt(tx, ty, tz);
    };
    syncCameraRef.current = syncCamera;
    syncCamera();

    let raf: number;
    const loop = () => {
      raf = requestAnimationFrame(loop);

      const selCylId = selected.value;
      const selImgId = selectedImgId.value;
      let active = false;
      const isCyl = selCylId !== null;

      if (isCyl) {
        const cyl = cylinders.value.find(c => c.id === selCylId);
        if (cyl) {
          active = true;
          gizmoGroup.position.set(cyl.x, cyl.y, cyl.z);
          const hOff = cyl.height + 0.35, rOff = cyl.radius + 0.35;
          heightHandle.position.set(0, hOff, 0);
          radiusHandle.position.set(rOff, cyl.height / 2, 0);
          const hp = hGeo.attributes.position as THREE.BufferAttribute;
          hp.setXYZ(0, 0, cyl.height, 0); hp.setXYZ(1, 0, hOff, 0); hp.needsUpdate = true;
          const rp = rGeo.attributes.position as THREE.BufferAttribute;
          rp.setXYZ(0, 0, cyl.height / 2, 0); rp.setXYZ(1, rOff, cyl.height / 2, 0); rp.needsUpdate = true;
        }
      } else if (selImgId !== null) {
        const img = images.value.find(i => i.id === selImgId);
        if (img) { active = true; gizmoGroup.position.set(img.x, img.y, img.z); }
      }

      gizmoGroup.visible   = active;
      heightHandle.visible = isCyl && active;
      radiusHandle.visible = isCyl && active;
      hLine.visible        = isCyl && active;
      rLine.visible        = isCyl && active;

      // WASD pan — move anchor in camera's XZ plane
      const keys = keysRef.current;
      if (keys.size > 0) {
        const { theta } = orbitRef.current;
        const spd = 0.04;
        if (keys.has("w")) { orbitRef.current.tx -= Math.sin(theta) * spd; orbitRef.current.tz -= Math.cos(theta) * spd; }
        if (keys.has("s")) { orbitRef.current.tx += Math.sin(theta) * spd; orbitRef.current.tz += Math.cos(theta) * spd; }
        if (keys.has("a")) { orbitRef.current.tx -= Math.cos(theta) * spd; orbitRef.current.tz += Math.sin(theta) * spd; }
        if (keys.has("d")) { orbitRef.current.tx += Math.cos(theta) * spd; orbitRef.current.tz -= Math.sin(theta) * spd; }
        syncCamera();
      }

      renderer.render(scene, camera);
    };
    loop();

    const ro = new ResizeObserver(() => {
      const w = canvas.clientWidth, h = canvas.clientHeight;
      camera.aspect = w / h; camera.updateProjectionMatrix();
      renderer.setSize(w, h, false);
    });
    ro.observe(canvas);

    const projectAxis = (axis: THREE.Vector3): THREE.Vector2 => {
      const o = new THREE.Vector3(0, 0, 0).project(camera);
      const a = axis.clone().project(camera);
      return new THREE.Vector2(a.x - o.x, -(a.y - o.y)).normalize();
    };

    const mkRay = (clientX: number, clientY: number) => {
      const rect = canvas.getBoundingClientRect();
      const ndc  = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(ndc, camera);
      return ray;
    };

    const onDown = (e: MouseEvent) => {
      if (e.button === 1) {
        e.preventDefault();
        orbitRef.current.midDragging = true;
        orbitRef.current.lx = e.clientX;
        orbitRef.current.ly = e.clientY;
        return;
      }
      if (e.button !== 0) return;

      // Gizmo hit-test (visible handles only)
      if (gizmoGroup.visible) {
        const ray     = mkRay(e.clientX, e.clientY);
        const visible = gizmoHandlesRef.current.filter(m => m.visible);
        const hits    = ray.intersectObjects(visible);
        if (hits.length > 0) {
          const ud       = hits[0].object.userData;
          const field    = ud.field as string;
          const selCylId = selected.value;
          const selImgId = selectedImgId.value;

          let startValue: number | undefined;
          let commit: ((val: number) => void) | undefined;

          if (selCylId !== null) {
            const cyl = cylinders.value.find(c => c.id === selCylId);
            const val = cyl ? (cyl as Record<string, unknown>)[field] : undefined;
            if (typeof val === "number") {
              startValue = val;
              commit = (v) => { cylinders.value = cylinders.value.map(c => c.id === selCylId ? { ...c, [field]: v } : c); };
            }
          } else if (selImgId !== null) {
            const img = images.value.find(i => i.id === selImgId);
            const val = img ? (img as Record<string, unknown>)[field] : undefined;
            if (typeof val === "number") {
              startValue = val;
              commit = (v) => { images.value = images.value.map(i => i.id === selImgId ? { ...i, [field]: v } as ImagePlane : i); };
            }
          }

          if (startValue !== undefined && commit !== undefined) {
            gizmoDragRef.current = {
              startMouseX: e.clientX, startMouseY: e.clientY,
              startValue, screenAxis: projectAxis(ud.axis as THREE.Vector3),
              min: ud.min, max: ud.max, sensitivity: ud.sens, commit,
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
      if (orbitRef.current.midDragging) {
        const dx = e.clientX - orbitRef.current.lx;
        const dy = e.clientY - orbitRef.current.ly;
        orbitRef.current.theta -= dx * 0.008;
        orbitRef.current.phi   = Math.max(0.15, Math.min(1.55, orbitRef.current.phi + dy * 0.008));
        orbitRef.current.lx    = e.clientX;
        orbitRef.current.ly    = e.clientY;
        syncCamera();
        return;
      }
      const drag = gizmoDragRef.current;
      if (drag) {
        const dx  = e.clientX - drag.startMouseX;
        const dy  = e.clientY - drag.startMouseY;
        const dot = (dx / canvas.clientWidth) * 2 * drag.screenAxis.x
                  + (dy / canvas.clientHeight) * 2 * drag.screenAxis.y;
        drag.commit(parseFloat(Math.max(drag.min, Math.min(drag.max, drag.startValue + dot * drag.sensitivity)).toFixed(3)));
        return;
      }
      if (orbitRef.current.dragging) {
        const dx = e.clientX - orbitRef.current.lx, dy = e.clientY - orbitRef.current.ly;
        if (Math.abs(dx) + Math.abs(dy) > 4) dragMovedRef.current = true;
        orbitRef.current.theta -= dx * 0.008;
        orbitRef.current.phi   = Math.max(0.15, Math.min(1.55, orbitRef.current.phi + dy * 0.008));
        orbitRef.current.lx    = e.clientX;
        orbitRef.current.ly    = e.clientY;
        syncCamera();
        return;
      }
      if (gizmoGroup.visible) {
        const ray     = mkRay(e.clientX, e.clientY);
        const visible = gizmoHandlesRef.current.filter(m => m.visible);
        const hits    = ray.intersectObjects(visible);
        setHover(hits.length > 0 ? hits[0].object.userData.field as string : null);
      } else {
        setHover(null);
      }
    };

    const onUp = (e: MouseEvent) => {
      if (e.button === 1) { orbitRef.current.midDragging = false; return; }
      orbitRef.current.dragging = false;
      if (gizmoDragRef.current) { gizmoDragRef.current = null; canvas.style.cursor = ""; }
    };

    const onWheel = (e: WheelEvent) => {
      orbitRef.current.r = Math.max(3, Math.min(50, orbitRef.current.r + e.deltaY * 0.02));
      syncCamera();
    };

    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const key = e.key.toLowerCase();
      if (["w", "a", "s", "d"].includes(key)) { e.preventDefault(); keysRef.current.add(key); }
    };
    const onKeyUp = (e: KeyboardEvent) => { keysRef.current.delete(e.key.toLowerCase()); };

    canvas.addEventListener("mousedown",   onDown);
    canvas.addEventListener("mouseleave",  () => setHover(null));
    globalThis.addEventListener("mousemove", onMove);
    globalThis.addEventListener("mouseup",   onUp);
    canvas.addEventListener("wheel",       onWheel, { passive: true });
    canvas.addEventListener("contextmenu", (e) => e.preventDefault());
    globalThis.addEventListener("keydown", onKeyDown);
    globalThis.addEventListener("keyup",   onKeyUp);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer.dispose();
      gizmoHandlesRef.current = [];
      canvas.removeEventListener("mousedown",   onDown);
      globalThis.removeEventListener("mousemove", onMove);
      globalThis.removeEventListener("mouseup",   onUp);
      canvas.removeEventListener("wheel", onWheel);
      globalThis.removeEventListener("keydown", onKeyDown);
      globalThis.removeEventListener("keyup",   onKeyUp);
    };
  }, []);

  // ── Sync cylinder meshes ───────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const ids = new Set(cylinders.value.map(c => c.id));
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
        const mesh = new THREE.Mesh(
          new THREE.CylinderGeometry(1, 1, 1, 32),
          new THREE.MeshStandardMaterial({ color, roughness: 0.5, metalness: 0.2 }),
        );
        mesh.castShadow = true; mesh.receiveShadow = true;
        mesh.userData = { id: cyl.id, kind: "cylinder" };
        scene.add(mesh);
        meshMapRef.current.set(cyl.id, mesh);
      }
      const mesh = meshMapRef.current.get(cyl.id)!;
      mesh.scale.set(cyl.radius, cyl.height, cyl.radius);
      mesh.position.set(cyl.x, cyl.y + cyl.height / 2, cyl.z);
      (mesh.material as THREE.MeshStandardMaterial).color.setHex(color);
    }
  }, [cylinders.value, selected.value]);

  // ── Sync image meshes ─────────────────────────────────────────────────
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;

    const ids = new Set(images.value.map(i => i.id));
    for (const [id, mesh] of imageMeshMapRef.current) {
      if (!ids.has(id)) {
        scene.remove(mesh);
        (mesh.material as THREE.MeshBasicMaterial).map?.dispose();
        (mesh.material as THREE.Material).dispose();
        mesh.geometry.dispose();
        const url = imageUrlMapRef.current.get(id);
        if (url) URL.revokeObjectURL(url);
        imageUrlMapRef.current.delete(id);
        imageMeshMapRef.current.delete(id);
      }
    }
    for (const img of images.value) {
      if (!imageMeshMapRef.current.has(img.id)) {
        imageUrlMapRef.current.set(img.id, img.url);

        const texture = texLoader.load(img.url, (tex) => {
          // Correct height to match the image's natural aspect ratio
          const aspect = tex.image.width / tex.image.height;
          images.value = images.value.map(i =>
            i.id === img.id ? { ...i, height: parseFloat((i.width / aspect).toFixed(2)) } : i
          );
        });
        texture.colorSpace = THREE.SRGBColorSpace;

        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(1, 1),
          new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true }),
        );
        mesh.userData = { id: img.id, kind: "image" };

        // Orange border shown when selected
        const outline = new THREE.LineSegments(
          new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
          new THREE.LineBasicMaterial({ color: 0xff7744, depthTest: false }),
        );
        outline.renderOrder = 100; outline.visible = false;
        mesh.add(outline);
        mesh.userData.outline = outline;

        scene.add(mesh);
        imageMeshMapRef.current.set(img.id, mesh);
      }

      const mesh = imageMeshMapRef.current.get(img.id)!;
      mesh.scale.set(img.width, img.height, 1);
      mesh.position.set(img.x, img.y, img.z);
      mesh.rotation.set((img.rotX * Math.PI) / 180, (img.rotY * Math.PI) / 180, (img.rotZ * Math.PI) / 180);
      (mesh.userData.outline as THREE.LineSegments).visible = img.id === selectedImgId.value;
    }
  }, [images.value, selectedImgId.value]);

  // ── Click: place cylinder or select object ────────────────────────────
  const handleClick = (e: MouseEvent) => {
    if (dragMovedRef.current) return;
    const canvas = canvasRef.current!;
    const rect   = canvas.getBoundingClientRect();
    const ray    = new THREE.Raycaster();
    ray.setFromCamera(
      new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1),
      cameraRef.current!,
    );

    if (placing.value) {
      const hits = ray.intersectObject(groundRef.current!);
      if (hits.length > 0) {
        const p = hits[0].point;
        cylinders.value = [...cylinders.value, { id: uid++, x: parseFloat(p.x.toFixed(2)), y: 0, z: parseFloat(p.z.toFixed(2)), radius: 0.5, height: 2 }];
        placing.value = false;
      }
      return;
    }

    const hits = ray.intersectObjects([...meshMapRef.current.values(), ...imageMeshMapRef.current.values()]);
    if (hits.length > 0) {
      const { kind, id } = hits[0].object.userData as { kind: string; id: number };
      if (kind === "image") { selectedImgId.value = id; selected.value = null; }
      else                  { selected.value = id; selectedImgId.value = null; }
    } else {
      selected.value = null; selectedImgId.value = null;
    }
  };

  const updateCyl = (field: keyof Cylinder, val: number) =>
    (cylinders.value = cylinders.value.map(c => c.id === selected.value ? { ...c, [field]: val } : c));

  const updateImg = (field: keyof ImagePlane, val: number) =>
    (images.value = images.value.map(i => i.id === selectedImgId.value ? { ...i, [field]: val } as ImagePlane : i));

  const selectedCyl = useComputed(() => cylinders.value.find(c => c.id === selected.value));
  const selectedImg = useComputed(() => images.value.find(i => i.id === selectedImgId.value));

  const cylSliders = [
    { key: "x" as const,      label: "X",      min: -9,  max: 9,  step: 0.1  },
    { key: "y" as const,      label: "Y lift",  min: 0,   max: 8,  step: 0.1  },
    { key: "z" as const,      label: "Z",      min: -9,  max: 9,  step: 0.1  },
    { key: "radius" as const, label: "Radius",  min: 0.1, max: 4,  step: 0.05 },
    { key: "height" as const, label: "Height",  min: 0.2, max: 10, step: 0.1  },
  ] as const;

  const imgSliders: { key: keyof ImagePlane; label: string; min: number; max: number; step: number; unit?: string }[] = [
    { key: "x",    label: "X",       min: -9,   max: 9,   step: 0.1 },
    { key: "y",    label: "Y",       min: -2,   max: 10,  step: 0.1 },
    { key: "z",    label: "Z",       min: -9,   max: 9,   step: 0.1 },
    { key: "width",  label: "Width",  min: 0.1,  max: 10,  step: 0.1 },
    { key: "height", label: "Height", min: 0.1,  max: 10,  step: 0.1 },
    { key: "rotX", label: "Rot X",   min: -180, max: 180, step: 1, unit: "°" },
    { key: "rotY", label: "Rot Y",   min: -180, max: 180, step: 1, unit: "°" },
    { key: "rotZ", label: "Rot Z",   min: -180, max: 180, step: 1, unit: "°" },
  ];

  const hasObjects = cylinders.value.length > 0 || images.value.length > 0;

  const sidebarItem = (active: boolean, label: string, onClick: () => void) => (
    <div
      onClick={onClick}
      style={`padding:5px 8px;border-radius:3px;cursor:pointer;font-size:11px;user-select:none;
        background:${active ? "#152238" : "#0e0e1a"};
        color:${active ? "#88aaff" : "#999"};
        border:1px solid ${active ? "#2a4488" : "transparent"};`}
    >{label}</div>
  );

  return (
    <div style="position:relative;width:100vw;height:100vh;overflow:hidden;font-family:ui-sans-serif,sans-serif;">
      <canvas ref={canvasRef} style="display:block;width:100%;height:100%;" onClick={handleClick} />

      <aside style="position:absolute;top:0;left:0;width:214px;height:100%;background:rgba(8,8,18,0.88);color:#ccc;padding:12px;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;overflow-y:auto;">
        <span style="font-size:13px;font-weight:700;color:#88aaff;letter-spacing:.06em;">3D SCENE</span>

        {/* Add buttons */}
        <button
          onClick={() => { placing.value = !placing.value; selectedImgId.value = null; }}
          style={`padding:6px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;color:#fff;background:${placing.value ? "#bb3311" : "#2255cc"};`}
        >
          {placing.value ? "✕  Cancel" : "+  Cylinder"}
        </button>
        <button
          onClick={() => fileInputRef.current?.click()}
          style="padding:6px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;color:#fff;background:#226633;"
        >
          +  Image
        </button>
        <input
          ref={fileInputRef} type="file" accept="image/*" style="display:none;"
          onChange={(e) => {
            const file = (e.target as HTMLInputElement).files?.[0];
            if (!file) return;
            const newImg: ImagePlane = {
              id: uid++, name: file.name, url: URL.createObjectURL(file),
              x: 0, y: 1.5, z: 0, rotX: 0, rotY: 0, rotZ: 0, width: 2, height: 2,
            };
            images.value     = [...images.value, newImg];
            selectedImgId.value = newImg.id;
            selected.value   = null;
            placing.value    = false;
            (e.target as HTMLInputElement).value = "";
          }}
        />

        {placing.value && <p style="font-size:11px;color:#6677aa;margin:0;">Click the ground to place</p>}

        {/* Object list */}
        {hasObjects && <div style="font-size:10px;color:#445;text-transform:uppercase;letter-spacing:.08em;margin-top:4px;">Objects</div>}
        {cylinders.value.map(c =>
          sidebarItem(c.id === selected.value, `Cylinder ${c.id}`, () => {
            selected.value     = c.id === selected.value ? null : c.id;
            if (selected.value !== null) selectedImgId.value = null;
          })
        )}
        {images.value.map(i =>
          <div
            key={i.id}
            onClick={() => { selectedImgId.value = i.id === selectedImgId.value ? null : i.id; if (selectedImgId.value !== null) selected.value = null; }}
            style={`padding:5px 8px;border-radius:3px;cursor:pointer;font-size:11px;user-select:none;
              background:${i.id === selectedImgId.value ? "#152218" : "#0e0e1a"};
              color:${i.id === selectedImgId.value ? "#88ffaa" : "#999"};
              border:1px solid ${i.id === selectedImgId.value ? "#2a5533" : "transparent"};`}
          >
            {i.name.length > 22 ? i.name.slice(0, 20) + "…" : i.name}
          </div>
        )}

        {/* Cylinder properties */}
        {selectedCyl.value && (
          <div style="margin-top:4px;display:flex;flex-direction:column;gap:8px;border-top:1px solid #1e1e30;padding-top:10px;">
            <span style="font-size:10px;color:#445;text-transform:uppercase;letter-spacing:.08em;">Properties</span>
            {cylSliders.map(({ key, label, min, max, step }) => (
              <label key={key} style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#aaa;">
                <span style="display:flex;justify-content:space-between;">
                  <span>{label}</span>
                  <span style="color:#88aaff;">{selectedCyl.value![key].toFixed(2)}</span>
                </span>
                <input type="range" min={min} max={max} step={step} value={selectedCyl.value![key]}
                  onInput={(e) => updateCyl(key, parseFloat((e.target as HTMLInputElement).value))}
                  style="width:100%;accent-color:#3388ff;" />
              </label>
            ))}
            <button onClick={() => { cylinders.value = cylinders.value.filter(c => c.id !== selected.value); selected.value = null; }}
              style="padding:4px 8px;background:#771111;border:none;border-radius:3px;color:#eee;font-size:11px;cursor:pointer;">
              Delete
            </button>
          </div>
        )}

        {/* Image properties */}
        {selectedImg.value && (
          <div style="margin-top:4px;display:flex;flex-direction:column;gap:8px;border-top:1px solid #1e1e30;padding-top:10px;">
            <span style="font-size:10px;color:#445;text-transform:uppercase;letter-spacing:.08em;">Properties</span>
            {imgSliders.map(({ key, label, min, max, step, unit }) => (
              <label key={key as string} style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#aaa;">
                <span style="display:flex;justify-content:space-between;">
                  <span>{label}</span>
                  <span style="color:#88ffaa;">
                    {(selectedImg.value![key] as number).toFixed(unit ? 0 : 2)}{unit ?? ""}
                  </span>
                </span>
                <input type="range" min={min} max={max} step={step} value={selectedImg.value![key] as number}
                  onInput={(e) => updateImg(key, parseFloat((e.target as HTMLInputElement).value))}
                  style="width:100%;accent-color:#33aa55;" />
              </label>
            ))}
            <button onClick={() => { images.value = images.value.filter(i => i.id !== selectedImgId.value); selectedImgId.value = null; }}
              style="padding:4px 8px;background:#771111;border:none;border-radius:3px;color:#eee;font-size:11px;cursor:pointer;">
              Delete
            </button>
          </div>
        )}
      </aside>

      <button
        onClick={() => { orbitRef.current.tx = 0; orbitRef.current.ty = 0; orbitRef.current.tz = 0; syncCameraRef.current?.(); }}
        style="position:absolute;top:12px;right:12px;padding:5px 10px;background:rgba(20,20,40,0.85);border:1px solid #2a4488;border-radius:4px;color:#88aaff;font-size:11px;cursor:pointer;"
      >
        Reset View
      </button>

      <div style="position:absolute;bottom:10px;right:12px;color:#333;font-size:10px;text-align:right;pointer-events:none;">
        WASD · pan &nbsp;|&nbsp; Mid-drag · orbit &nbsp;|&nbsp; Scroll · zoom &nbsp;|&nbsp; Click · select
      </div>
    </div>
  );
}
