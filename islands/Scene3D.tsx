import { Signal, useComputed, useSignal } from "@preact/signals";
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

type OrbitState = {
    theta: number;
    phi: number;
    r: number;
    tx: number;
    ty: number;
    tz: number;
    dragging: boolean;
    midDragging: boolean;
    lx: number;
    ly: number;
};
type ImageDragState = {
    id: number;
    plane: THREE.Plane;
    offsetX: number;
    offsetZ: number;
};

const mkOnDown = (args: {
    orbitRef: { current: OrbitState };
    gizmoGroup: THREE.Group;
    gizmoHandlesRef: { current: THREE.Mesh[] };
    selected: Signal<number | null>;
    selectedImgId: Signal<number | null>;
    cylinders: Signal<Cylinder[]>;
    images: Signal<ImagePlane[]>;
    gizmoDragRef: { current: GizmoDrag | null };
    projectAxis: (axis: THREE.Vector3) => THREE.Vector2;
    setHover: (field: string | null) => void;
    canvas: HTMLCanvasElement;
    camera: THREE.PerspectiveCamera;
    dragMovedRef: { current: boolean };
    imageMeshMapRef: { current: Map<number, THREE.Mesh> };
    imageDragRef: { current: ImageDragState | null };
}) =>
(e: MouseEvent) => {
    const {
        orbitRef,
        gizmoGroup,
        gizmoHandlesRef,
        selected,
        selectedImgId,
        cylinders,
        images,
        gizmoDragRef,
        projectAxis,
        setHover,
        canvas,
        camera,
        dragMovedRef,
        imageMeshMapRef,
        imageDragRef,
    } = args;

    // Middle-click starts orbit drag; preventDefault suppresses browser autoscroll.
    // Right-click and other buttons are ignored — only left-click reaches hit-testing below.
    if (e.button === 1) {
        e.preventDefault();
        orbitRef.current.midDragging = true;
        orbitRef.current.lx = e.clientX;
        orbitRef.current.ly = e.clientY;
        return;
    }
    if (e.button !== 0) return;

    const ray = mkRay(canvas, camera, e.clientX, e.clientY);

    // Gizmo hit-test (visible handles only)
    if (gizmoGroup.visible) {
        const visible = gizmoHandlesRef.current.filter((m) => m.visible);
        const hits = ray.intersectObjects(visible);
        if (hits.length > 0) {
            const ud = hits[0].object.userData;
            const field = ud.field as string;
            const selCylId = selected.value;
            const selImgId = selectedImgId.value;

            let startValue: number | undefined;
            let commit: ((val: number) => void) | undefined;

            if (selCylId !== null) {
                const cyl = cylinders.value.find((c) => c.id === selCylId);
                const val = cyl
                    ? (cyl as Record<string, unknown>)[field]
                    : undefined;
                if (typeof val === "number") {
                    startValue = val;
                    commit = (v) => {
                        cylinders.value = cylinders.value.map((c) =>
                            c.id === selCylId ? { ...c, [field]: v } : c
                        );
                    };
                }
            } else if (selImgId !== null) {
                const img = images.value.find((i) => i.id === selImgId);
                const val = img
                    ? (img as Record<string, unknown>)[field]
                    : undefined;
                if (typeof val === "number") {
                    startValue = val;
                    commit = (v) => {
                        images.value = images.value.map((i) =>
                            i.id === selImgId
                                ? { ...i, [field]: v } as ImagePlane
                                : i
                        );
                    };
                }
            }

            if (startValue !== undefined && commit !== undefined) {
                gizmoDragRef.current = {
                    startMouseX: e.clientX,
                    startMouseY: e.clientY,
                    startValue,
                    screenAxis: projectAxis(ud.axis as THREE.Vector3),
                    min: ud.min,
                    max: ud.max,
                    sensitivity: ud.sens,
                    commit,
                };
                setHover(null);
                canvas.style.cursor = "grabbing";
                dragMovedRef.current = true;
                return;
            }
        }
    }

    // Image mesh drag — hit test against all image planes
    const imgHits = ray.intersectObjects(
        [...imageMeshMapRef.current.values()],
        false,
    );
    if (imgHits.length > 0) {
        const { id } = imgHits[0].object.userData as { id: number };
        const img = images.value.find((i) => i.id === id);
        if (img) {
            const dragPlane = new THREE.Plane(
                new THREE.Vector3(0, 1, 0),
                -img.y,
            );
            const hitPoint = new THREE.Vector3();
            ray.ray.intersectPlane(dragPlane, hitPoint);
            imageDragRef.current = {
                id,
                plane: dragPlane,
                offsetX: img.x - hitPoint.x,
                offsetZ: img.z - hitPoint.z,
            };
            dragMovedRef.current = false;
            return;
        }
    }

    orbitRef.current.dragging = true;
    orbitRef.current.lx = e.clientX;
    orbitRef.current.ly = e.clientY;
    dragMovedRef.current = false;
};

const mkRay = (
    canvas: HTMLCanvasElement,
    camera: THREE.PerspectiveCamera,
    clientX: number,
    clientY: number,
) => {
    const rect = canvas.getBoundingClientRect();
    const ndc = new THREE.Vector2(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);
    return ray;
};

type SceneFile = {
    version: number;
    camera?: {
        theta: number;
        phi: number;
        r: number;
        tx: number;
        ty: number;
        tz: number;
    };
    cylinders?: Cylinder[];
    images?: (Omit<ImagePlane, "url"> & { data: string })[];
    panorama?: { name: string; data: string } | null;
};

async function blobUrlToDataUrl(url: string): Promise<string> {
    const blob = await fetch(url).then((r) => r.blob());
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// ── Scene localStorage helpers ─────────────────────────────────────────
const LS_INDEX = "od_scenes";
const LS_DATA = "od_scene_";
const LS_AUTO = "od_autosave";

type SceneIndexEntry = { id: string; name: string; savedAt: number };

function lsIndex(): SceneIndexEntry[] {
    try {
        return JSON.parse(localStorage.getItem(LS_INDEX) ?? "[]");
    } catch {
        return [];
    }
}
function lsSetIndex(v: SceneIndexEntry[]): void {
    localStorage.setItem(LS_INDEX, JSON.stringify(v));
}
function lsScene(id: string): SceneFile | null {
    try {
        const s = localStorage.getItem(LS_DATA + id);
        return s ? JSON.parse(s) : null;
    } catch {
        return null;
    }
}
function lsSetScene(id: string, d: SceneFile): void {
    localStorage.setItem(LS_DATA + id, JSON.stringify(d));
}
function lsDel(id: string): void {
    localStorage.removeItem(LS_DATA + id);
    lsSetIndex(lsIndex().filter((e) => e.id !== id));
}

// Collect current scene state → SceneFile (converts blob URLs to data URLs)
const mkCaptureScene = (args: {
    cylinders: Signal<Cylinder[]>;
    images: Signal<ImagePlane[]>;
    panoUrl: Signal<string | null>;
    panoName: Signal<string | null>;
    orbitRef: { current: OrbitState };
}) =>
async (): Promise<SceneFile> => {
    const { cylinders, images, panoUrl, panoName, orbitRef } = args;
    const imgData = await Promise.all(
        images.value.map(async ({ url, ...rest }) => ({
            ...rest,
            data: await blobUrlToDataUrl(url),
        })),
    );
    const panoData = panoUrl.value
        ? {
            name: panoName.value ?? "",
            data: await blobUrlToDataUrl(panoUrl.value),
        }
        : null;
    const { theta, phi, r, tx, ty, tz } = orbitRef.current;
    return {
        version: 1,
        camera: { theta, phi, r, tx, ty, tz },
        cylinders: cylinders.value,
        images: imgData,
        panorama: panoData,
    };
};

// Apply a SceneFile → signals (converts data URLs back to blob URLs)
const mkApplyScene = (args: {
    cylinders: Signal<Cylinder[]>;
    images: Signal<ImagePlane[]>;
    selected: Signal<number | null>;
    selectedImgId: Signal<number | null>;
    placing: Signal<boolean>;
    panoUrl: Signal<string | null>;
    panoName: Signal<string | null>;
    orbitRef: { current: OrbitState };
    syncCameraRef: { current: (() => void) | null };
}) =>
async (data: SceneFile): Promise<void> => {
    const {
        cylinders,
        images,
        selected,
        selectedImgId,
        placing,
        panoUrl,
        panoName,
        orbitRef,
        syncCameraRef,
    } = args;

    for (const img of images.value) URL.revokeObjectURL(img.url);
    if (panoUrl.value) URL.revokeObjectURL(panoUrl.value);

    const loaded: ImagePlane[] = await Promise.all(
        (data.images ?? []).map(async ({ data: d, ...rest }) => {
            const blob = await fetch(d).then((r) => r.blob());
            return { ...rest, id: uid++, url: URL.createObjectURL(blob) };
        }),
    );

    cylinders.value = (data.cylinders ?? []).map((c) => ({ ...c, id: uid++ }));
    images.value = loaded;
    selected.value = null;
    selectedImgId.value = null;
    placing.value = false;

    if (data.panorama) {
        const blob = await fetch(data.panorama.data).then((r) => r.blob());
        panoUrl.value = URL.createObjectURL(blob);
        panoName.value = data.panorama.name;
    } else {
        panoUrl.value = null;
        panoName.value = null;
    }

    if (data.camera) {
        Object.assign(orbitRef.current, data.camera);
        orbitRef.current.dragging = false;
        orbitRef.current.midDragging = false;
        syncCameraRef.current?.();
    }
};

const texLoader = new THREE.TextureLoader();
let uid = 1;

export default function Scene3D() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const sceneRef = useRef<THREE.Scene | null>(null);
    const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
    const rendererRef = useRef<THREE.WebGLRenderer | null>(null);

    const meshMapRef = useRef<Map<number, THREE.Mesh>>(new Map());
    const imageMeshMapRef = useRef<Map<number, THREE.Mesh>>(new Map());
    const imageUrlMapRef = useRef<Map<number, string>>(new Map());
    const groundRef = useRef<THREE.Mesh | null>(null);

    const orbitRef = useRef({
        theta: 0.4,
        phi: 1.1,
        r: 15,
        tx: 0,
        ty: 0,
        tz: 0,
        dragging: false,
        midDragging: false,
        lx: 0,
        ly: 0,
    });
    const dragMovedRef = useRef(false);
    const keysRef = useRef<Set<string>>(new Set());
    const syncCameraRef = useRef<(() => void) | null>(null);
    const gizmoHandlesRef = useRef<THREE.Mesh[]>([]);
    const gizmoDragRef = useRef<GizmoDrag | null>(null);
    const imageDragRef = useRef<
        | { id: number; plane: THREE.Plane; offsetX: number; offsetZ: number }
        | null
    >(null);
    const hoveredFieldRef = useRef<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const panoFileRef = useRef<HTMLInputElement>(null);
    const panoTexRef = useRef<THREE.Texture | null>(null);
    const loadFileRef = useRef<HTMLInputElement>(null);
    const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    const cylinders = useSignal<Cylinder[]>([]);
    const selected = useSignal<number | null>(null);
    const placing = useSignal(false);
    const images = useSignal<ImagePlane[]>([]);
    const selectedImgId = useSignal<number | null>(null);
    const panoUrl = useSignal<string | null>(null);
    const panoName = useSignal<string | null>(null);
    const saving = useSignal(false);
    const sceneName = useSignal("Untitled");
    const sceneId = useSignal<string | null>(null);
    const sceneIndex = useSignal<SceneIndexEntry[]>(lsIndex());
    const showScenes = useSignal(false);
    const saveModal = useSignal<"save" | "saveas" | null>(null);
    const saveModalName = useSignal("");

    // ── Three.js init ──────────────────────────────────────────────────────
    useEffect(() => {
        const canvas = canvasRef.current!;
        const scene = new THREE.Scene();
        scene.background = new THREE.Color(0x181824);
        scene.fog = new THREE.Fog(0x181824, 25, 60);
        sceneRef.current = scene;

        const camera = new THREE.PerspectiveCamera(
            55,
            canvas.clientWidth / canvas.clientHeight,
            0.1,
            500,
        );
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
            new THREE.MeshBasicMaterial({
                visible: false,
                side: THREE.DoubleSide,
            }),
        );
        ground.rotation.x = -Math.PI / 2;
        scene.add(ground);
        groundRef.current = ground;

        // ── Gizmo ──────────────────────────────────────────────────────────
        const gizmoGroup = new THREE.Group();
        gizmoGroup.visible = false;
        scene.add(gizmoGroup);

        const mkMat = (color: number) =>
            new THREE.MeshBasicMaterial({
                color,
                depthTest: false,
                transparent: true,
                opacity: 0.9,
            });

        // Each field maps to [shaft, cone] or [sphere] for batch hover updates
        const meshesByField = new Map<string, THREE.Mesh[]>();

        const shaftGeo = new THREE.CylinderGeometry(0.07, 0.07, 1.5, 8);
        const coneGeo = new THREE.ConeGeometry(0.14, 0.35, 8);
        const sphereGeo = new THREE.SphereGeometry(0.2, 12, 12);

        const addArrow = (
            nc: number,
            hc: number,
            sPos: THREE.Vector3,
            cPos: THREE.Vector3,
            rz: number,
            rx: number,
            field: string,
            axis: THREE.Vector3,
            min: number,
            max: number,
            sens: number,
        ) => {
            const ud = { field, axis: axis.clone(), min, max, sens, nc, hc };
            const meshes: THREE.Mesh[] = [];
            for (
                const [geo, pos] of [[shaftGeo, sPos], [coneGeo, cPos]] as [
                    THREE.BufferGeometry,
                    THREE.Vector3,
                ][]
            ) {
                const m = new THREE.Mesh(geo, mkMat(nc));
                m.position.copy(pos);
                m.rotation.z = rz;
                m.rotation.x = rx;
                m.renderOrder = 998;
                m.userData = ud;
                gizmoGroup.add(m);
                gizmoHandlesRef.current.push(m);
                meshes.push(m);
            }
            meshesByField.set(field, meshes);
        };

        const addSphere = (
            nc: number,
            hc: number,
            pos: THREE.Vector3,
            field: string,
            axis: THREE.Vector3,
            min: number,
            max: number,
            sens: number,
        ) => {
            const ud = { field, axis: axis.clone(), min, max, sens, nc, hc };
            const m = new THREE.Mesh(sphereGeo, mkMat(nc));
            m.position.copy(pos);
            m.renderOrder = 999;
            m.userData = ud;
            gizmoGroup.add(m);
            gizmoHandlesRef.current.push(m);
            meshesByField.set(field, [m]);
            return m;
        };

        // X/Y/Z translation — shared for cylinders and images
        addArrow(
            0xff4444,
            0xff9999,
            new THREE.Vector3(0.75, 0, 0),
            new THREE.Vector3(1.675, 0, 0),
            -Math.PI / 2,
            0,
            "x",
            new THREE.Vector3(1, 0, 0),
            -9,
            9,
            14,
        );
        addArrow(
            0x44ff44,
            0x99ff99,
            new THREE.Vector3(0, 0.75, 0),
            new THREE.Vector3(0, 1.675, 0),
            0,
            0,
            "y",
            new THREE.Vector3(0, 1, 0),
            -5,
            10,
            10,
        );
        addArrow(
            0x4488ff,
            0x88bbff,
            new THREE.Vector3(0, 0, 0.75),
            new THREE.Vector3(0, 0, 1.675),
            0,
            Math.PI / 2,
            "z",
            new THREE.Vector3(0, 0, 1),
            -9,
            9,
            14,
        );

        // Cylinder-only handles (hidden for images)
        const heightHandle = addSphere(
            0xffdd00,
            0xffee88,
            new THREE.Vector3(0, 3, 0),
            "height",
            new THREE.Vector3(0, 1, 0),
            0.2,
            10,
            8,
        );
        const radiusHandle = addSphere(
            0x00ddff,
            0x88eeff,
            new THREE.Vector3(1, 0, 0),
            "radius",
            new THREE.Vector3(1, 0, 0),
            0.1,
            4,
            5,
        );

        const mkDynLine = (color: number) => {
            const geo = new THREE.BufferGeometry().setFromPoints([
                new THREE.Vector3(),
                new THREE.Vector3(),
            ]);
            const line = new THREE.Line(
                geo,
                new THREE.LineBasicMaterial({
                    color,
                    depthTest: false,
                    transparent: true,
                    opacity: 0.4,
                }),
            );
            line.renderOrder = 997;
            gizmoGroup.add(line);
            return { line, geo };
        };
        const { line: hLine, geo: hGeo } = mkDynLine(0xffdd00);
        const { line: rLine, geo: rGeo } = mkDynLine(0x00ddff);

        const setHover = (field: string | null) => {
            if (field === hoveredFieldRef.current) return;
            if (hoveredFieldRef.current) {
                for (
                    const m of meshesByField.get(hoveredFieldRef.current) ?? []
                ) {
                    (m.material as THREE.MeshBasicMaterial).color.setHex(
                        m.userData.nc,
                    );
                }
            }
            hoveredFieldRef.current = field;
            if (field) {
                for (const m of meshesByField.get(field) ?? []) {
                    (m.material as THREE.MeshBasicMaterial).color.setHex(
                        m.userData.hc,
                    );
                }
            }
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
                const cyl = cylinders.value.find((c) => c.id === selCylId);
                if (cyl) {
                    active = true;
                    gizmoGroup.position.set(cyl.x, cyl.y, cyl.z);
                    const hOff = cyl.height + 0.35, rOff = cyl.radius + 0.35;
                    heightHandle.position.set(0, hOff, 0);
                    radiusHandle.position.set(rOff, cyl.height / 2, 0);
                    const hp = hGeo.attributes
                        .position as THREE.BufferAttribute;
                    hp.setXYZ(0, 0, cyl.height, 0);
                    hp.setXYZ(1, 0, hOff, 0);
                    hp.needsUpdate = true;
                    const rp = rGeo.attributes
                        .position as THREE.BufferAttribute;
                    rp.setXYZ(0, 0, cyl.height / 2, 0);
                    rp.setXYZ(1, rOff, cyl.height / 2, 0);
                    rp.needsUpdate = true;
                }
            } else if (selImgId !== null) {
                const img = images.value.find((i) => i.id === selImgId);
                if (img) {
                    active = true;
                    gizmoGroup.position.set(img.x, img.y, img.z);
                }
            }

            gizmoGroup.visible = active;
            heightHandle.visible = isCyl && active;
            radiusHandle.visible = isCyl && active;
            hLine.visible = isCyl && active;
            rLine.visible = isCyl && active;

            // WASD pan — move anchor in camera's XZ plane
            const keys = keysRef.current;
            if (keys.size > 0) {
                const { theta } = orbitRef.current;
                const spd = 0.04;
                if (keys.has("w")) {
                    orbitRef.current.tx -= Math.sin(theta) * spd;
                    orbitRef.current.tz -= Math.cos(theta) * spd;
                }
                if (keys.has("s")) {
                    orbitRef.current.tx += Math.sin(theta) * spd;
                    orbitRef.current.tz += Math.cos(theta) * spd;
                }
                if (keys.has("a")) {
                    orbitRef.current.tx -= Math.cos(theta) * spd;
                    orbitRef.current.tz += Math.sin(theta) * spd;
                }
                if (keys.has("d")) {
                    orbitRef.current.tx += Math.cos(theta) * spd;
                    orbitRef.current.tz -= Math.sin(theta) * spd;
                }
                syncCamera();
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

        const projectAxis = (axis: THREE.Vector3): THREE.Vector2 => {
            const o = new THREE.Vector3(0, 0, 0).project(camera);
            const a = axis.clone().project(camera);
            return new THREE.Vector2(a.x - o.x, -(a.y - o.y)).normalize();
        };

        const onDown = mkOnDown({
            orbitRef,
            gizmoGroup,
            gizmoHandlesRef,
            selected,
            selectedImgId,
            cylinders,
            images,
            gizmoDragRef,
            projectAxis,
            setHover,
            canvas,
            camera,
            dragMovedRef,
            imageMeshMapRef,
            imageDragRef,
        });

        const onMove = (e: MouseEvent) => {
            if (orbitRef.current.midDragging) {
                const dx = e.clientX - orbitRef.current.lx;
                const dy = e.clientY - orbitRef.current.ly;
                orbitRef.current.theta -= dx * 0.008;
                orbitRef.current.phi = Math.max(
                    0.15,
                    Math.min(1.55, orbitRef.current.phi + dy * 0.008),
                );
                orbitRef.current.lx = e.clientX;
                orbitRef.current.ly = e.clientY;
                syncCamera();
                return;
            }
            const imgDrag = imageDragRef.current;
            if (imgDrag) {
                dragMovedRef.current = true;
                canvas.style.cursor = "grabbing";
                const r = mkRay(canvas, camera, e.clientX, e.clientY);
                const hit = new THREE.Vector3();
                if (r.ray.intersectPlane(imgDrag.plane, hit)) {
                    images.value = images.value.map((i) =>
                        i.id === imgDrag.id
                            ? {
                                ...i,
                                x: parseFloat(
                                    (hit.x + imgDrag.offsetX).toFixed(3),
                                ),
                                z: parseFloat(
                                    (hit.z + imgDrag.offsetZ).toFixed(3),
                                ),
                            }
                            : i
                    );
                }
                return;
            }
            const drag = gizmoDragRef.current;
            if (drag) {
                const dx = e.clientX - drag.startMouseX;
                const dy = e.clientY - drag.startMouseY;
                const dot = (dx / canvas.clientWidth) * 2 * drag.screenAxis.x +
                    (dy / canvas.clientHeight) * 2 * drag.screenAxis.y;
                drag.commit(
                    parseFloat(
                        Math.max(
                            drag.min,
                            Math.min(
                                drag.max,
                                drag.startValue + dot * drag.sensitivity,
                            ),
                        ).toFixed(3),
                    ),
                );
                return;
            }
            if (orbitRef.current.dragging) {
                const dx = e.clientX - orbitRef.current.lx,
                    dy = e.clientY - orbitRef.current.ly;
                if (Math.abs(dx) + Math.abs(dy) > 4) {
                    dragMovedRef.current = true;
                }
                orbitRef.current.theta -= dx * 0.008;
                orbitRef.current.phi = Math.max(
                    0.15,
                    Math.min(1.55, orbitRef.current.phi + dy * 0.008),
                );
                orbitRef.current.lx = e.clientX;
                orbitRef.current.ly = e.clientY;
                syncCamera();
                return;
            }
            // Hover: gizmo handles take priority, then image planes
            if (gizmoGroup.visible) {
                const r = mkRay(canvas, camera, e.clientX, e.clientY);
                const visible = gizmoHandlesRef.current.filter((m) =>
                    m.visible
                );
                const hits = r.intersectObjects(visible);
                setHover(
                    hits.length > 0
                        ? hits[0].object.userData.field as string
                        : null,
                );
            } else {
                setHover(null);
            }
            if (!hoveredFieldRef.current) {
                const r = mkRay(canvas, camera, e.clientX, e.clientY);
                const imgHits = r.intersectObjects([
                    ...imageMeshMapRef.current.values(),
                ], false);
                canvas.style.cursor = imgHits.length > 0 ? "move" : "";
            }
        };

        const onUp = (e: MouseEvent) => {
            if (e.button === 1) {
                orbitRef.current.midDragging = false;
                return;
            }
            if (imageDragRef.current) {
                imageDragRef.current = null;
                canvas.style.cursor = "";
                return;
            }
            orbitRef.current.dragging = false;
            if (gizmoDragRef.current) {
                gizmoDragRef.current = null;
                canvas.style.cursor = "";
            }
        };

        const onWheel = (e: WheelEvent) => {
            orbitRef.current.r = Math.max(
                3,
                Math.min(50, orbitRef.current.r + e.deltaY * 0.02),
            );
            syncCamera();
        };

        const onKeyDown = (e: KeyboardEvent) => {
            const tag = (e.target as HTMLElement).tagName;
            if (tag === "INPUT" || tag === "TEXTAREA") return;
            const key = e.key.toLowerCase();
            if (["w", "a", "s", "d"].includes(key)) {
                e.preventDefault();
                keysRef.current.add(key);
            }
        };
        const onKeyUp = (e: KeyboardEvent) => {
            keysRef.current.delete(e.key.toLowerCase());
        };

        canvas.addEventListener("mousedown", onDown);
        canvas.addEventListener("mouseleave", () => setHover(null));
        globalThis.addEventListener("mousemove", onMove);
        globalThis.addEventListener("mouseup", onUp);
        canvas.addEventListener("wheel", onWheel, { passive: true });
        canvas.addEventListener("contextmenu", (e) => e.preventDefault());
        globalThis.addEventListener("keydown", onKeyDown);
        globalThis.addEventListener("keyup", onKeyUp);

        return () => {
            cancelAnimationFrame(raf);
            ro.disconnect();
            renderer.dispose();
            gizmoHandlesRef.current = [];
            canvas.removeEventListener("mousedown", onDown);
            globalThis.removeEventListener("mousemove", onMove);
            globalThis.removeEventListener("mouseup", onUp);
            canvas.removeEventListener("wheel", onWheel);
            globalThis.removeEventListener("keydown", onKeyDown);
            globalThis.removeEventListener("keyup", onKeyUp);
        };
    }, []);

    // ── Sync cylinder meshes ───────────────────────────────────────────────
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
                const mesh = new THREE.Mesh(
                    new THREE.CylinderGeometry(1, 1, 1, 32),
                    new THREE.MeshStandardMaterial({
                        color,
                        roughness: 0.5,
                        metalness: 0.2,
                    }),
                );
                mesh.castShadow = true;
                mesh.receiveShadow = true;
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

        const ids = new Set(images.value.map((i) => i.id));
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
                    images.value = images.value.map((i) =>
                        i.id === img.id
                            ? {
                                ...i,
                                height: parseFloat(
                                    (i.width / aspect).toFixed(2),
                                ),
                            }
                            : i
                    );
                });
                texture.colorSpace = THREE.SRGBColorSpace;

                const mesh = new THREE.Mesh(
                    new THREE.PlaneGeometry(1, 1),
                    new THREE.MeshBasicMaterial({
                        map: texture,
                        side: THREE.DoubleSide,
                        transparent: true,
                    }),
                );
                mesh.userData = { id: img.id, kind: "image" };

                // Orange border shown when selected
                const outline = new THREE.LineSegments(
                    new THREE.EdgesGeometry(new THREE.PlaneGeometry(1, 1)),
                    new THREE.LineBasicMaterial({
                        color: 0xff7744,
                        depthTest: false,
                    }),
                );
                outline.renderOrder = 100;
                outline.visible = false;
                mesh.add(outline);
                mesh.userData.outline = outline;

                scene.add(mesh);
                imageMeshMapRef.current.set(img.id, mesh);
            }

            const mesh = imageMeshMapRef.current.get(img.id)!;
            mesh.scale.set(img.width, img.height, 1);
            mesh.position.set(img.x, img.y, img.z);
            mesh.rotation.set(
                (img.rotX * Math.PI) / 180,
                (img.rotY * Math.PI) / 180,
                (img.rotZ * Math.PI) / 180,
            );
            (mesh.userData.outline as THREE.LineSegments).visible =
                img.id === selectedImgId.value;
        }
    }, [images.value, selectedImgId.value]);

    // ── Sync panorama background ──────────────────────────────────────────
    useEffect(() => {
        const scene = sceneRef.current;
        if (!scene) return;

        // Dispose previous texture and revoke its blob URL
        if (panoTexRef.current) {
            panoTexRef.current.dispose();
            panoTexRef.current = null;
        }

        if (panoUrl.value) {
            const tex = texLoader.load(panoUrl.value);
            tex.mapping = THREE.EquirectangularReflectionMapping;
            tex.colorSpace = THREE.SRGBColorSpace;
            panoTexRef.current = tex;
            scene.background = tex;
            scene.environment = tex;
            scene.fog = null;

            return () => {
                URL.revokeObjectURL(panoUrl.value!);
            };
        } else {
            scene.background = new THREE.Color(0x181824);
            scene.environment = null;
            scene.fog = new THREE.Fog(0x181824, 25, 60);
        }
    }, [panoUrl.value]);

    // ── Scene management ───────────────────────────────────────────────────
    const captureScene = mkCaptureScene({
        cylinders,
        images,
        panoUrl,
        panoName,
        orbitRef,
    });
    const applyScene = mkApplyScene({
        cylinders,
        images,
        selected,
        selectedImgId,
        placing,
        panoUrl,
        panoName,
        orbitRef,
        syncCameraRef,
    });

    // Persist a named scene to localStorage and update the index
    const persistScene = async (name: string, id: string) => {
        const data = await captureScene();
        lsSetScene(id, data);
        const idx = lsIndex();
        const entry: SceneIndexEntry = { id, name, savedAt: Date.now() };
        const pos = idx.findIndex((e) => e.id === id);
        if (pos >= 0) idx[pos] = entry;
        else idx.unshift(entry);
        lsSetIndex(idx);
        sceneIndex.value = lsIndex();
        sceneName.value = name;
        sceneId.value = id;
    };

    // Save: overwrite current scene if one is open, otherwise show the name modal
    const saveScene = async () => {
        if (sceneId.value) {
            saving.value = true;
            try {
                await persistScene(sceneName.value, sceneId.value);
            } finally {
                saving.value = false;
            }
        } else {
            saveModalName.value = sceneName.value;
            saveModal.value = "save";
        }
    };

    // Save As: always prompt for a new name
    const saveSceneAs = () => {
        saveModalName.value = sceneName.value;
        saveModal.value = "saveas";
    };

    // Confirm from the modal
    const confirmSave = async () => {
        const name = saveModalName.value.trim();
        if (!name) return;
        const id = saveModal.value === "saveas"
            ? `s_${Date.now()}`
            : (sceneId.value ?? `s_${Date.now()}`);
        saveModal.value = null;
        saving.value = true;
        try {
            await persistScene(name, id);
        } finally {
            saving.value = false;
        }
    };

    // Load a named scene from localStorage
    const loadSceneById = async (id: string) => {
        const data = lsScene(id);
        if (!data) return;
        await applyScene(data);
        const entry = lsIndex().find((e) => e.id === id);
        sceneId.value = id;
        sceneName.value = entry?.name ?? "Untitled";
        showScenes.value = false;
    };

    // Delete a named scene from localStorage
    const deleteSceneById = (id: string) => {
        lsDel(id);
        sceneIndex.value = lsIndex();
        if (sceneId.value === id) sceneId.value = null;
    };

    // Export current scene as a downloadable file
    const exportScene = async () => {
        saving.value = true;
        try {
            const data = await captureScene();
            const a = document.createElement("a");
            a.href = URL.createObjectURL(
                new Blob([JSON.stringify(data, null, 2)], {
                    type: "application/json",
                }),
            );
            a.download = `${sceneName.value}.od.json`;
            a.click();
        } finally {
            saving.value = false;
        }
    };

    // Import scene from a JSON file (does not create a named entry)
    const importScene = async (file: File) => {
        const data = JSON.parse(await file.text()) as SceneFile;
        await applyScene(data);
        sceneId.value = null;
        sceneName.value = file.name.replace(/\.(od\.)?json$/i, "");
    };

    // Auto-save: debounce 2 s after any scene modification
    useEffect(() => {
        if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
        autoSaveTimer.current = setTimeout(async () => {
            autoSaveTimer.current = null;
            try {
                const data = await captureScene();
                if (sceneId.value) {
                    // Keep the named scene up to date
                    lsSetScene(sceneId.value, data);
                    const idx = lsIndex().map((e) =>
                        e.id === sceneId.value
                            ? { ...e, savedAt: Date.now() }
                            : e
                    );
                    lsSetIndex(idx);
                    sceneIndex.value = lsIndex();
                }
                // Always write to the autosave slot as crash recovery
                localStorage.setItem(LS_AUTO, JSON.stringify(data));
            } catch { /* storage quota exceeded — fail silently */ }
        }, 2000);
    }, [cylinders.value, images.value, panoUrl.value, panoName.value]);

    // ── Click: place cylinder or select object ────────────────────────────
    const handleClick = (e: MouseEvent) => {
        if (dragMovedRef.current) return;
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        const ray = new THREE.Raycaster();
        ray.setFromCamera(
            new THREE.Vector2(
                ((e.clientX - rect.left) / rect.width) * 2 - 1,
                -((e.clientY - rect.top) / rect.height) * 2 + 1,
            ),
            cameraRef.current!,
        );

        if (placing.value) {
            const hits = ray.intersectObject(groundRef.current!);
            if (hits.length > 0) {
                const p = hits[0].point;
                cylinders.value = [...cylinders.value, {
                    id: uid++,
                    x: parseFloat(p.x.toFixed(2)),
                    y: 0,
                    z: parseFloat(p.z.toFixed(2)),
                    radius: 0.5,
                    height: 2,
                }];
                placing.value = false;
            }
            return;
        }

        const hits = ray.intersectObjects([
            ...meshMapRef.current.values(),
            ...imageMeshMapRef.current.values(),
        ], false);
        if (hits.length > 0) {
            const { kind, id } = hits[0].object.userData as {
                kind: string;
                id: number;
            };
            if (kind === "image") {
                selectedImgId.value = id;
                selected.value = null;
            } else {
                selected.value = id;
                selectedImgId.value = null;
            }
        } else {
            selected.value = null;
            selectedImgId.value = null;
        }
    };

    const updateCyl = (
        field: keyof Cylinder,
        val: number,
    ) => (cylinders.value = cylinders.value.map((c) =>
        c.id === selected.value ? { ...c, [field]: val } : c
    ));

    const updateImg = (
        field: keyof ImagePlane,
        val: number,
    ) => (images.value = images.value.map((i) =>
        i.id === selectedImgId.value ? { ...i, [field]: val } as ImagePlane : i
    ));

    const selectedCyl = useComputed(() =>
        cylinders.value.find((c) => c.id === selected.value)
    );
    const selectedImg = useComputed(() =>
        images.value.find((i) => i.id === selectedImgId.value)
    );

    const cylSliders = [
        { key: "x" as const, label: "X", min: -9, max: 9, step: 0.1 },
        { key: "y" as const, label: "Y lift", min: 0, max: 8, step: 0.1 },
        { key: "z" as const, label: "Z", min: -9, max: 9, step: 0.1 },
        {
            key: "radius" as const,
            label: "Radius",
            min: 0.1,
            max: 4,
            step: 0.05,
        },
        {
            key: "height" as const,
            label: "Height",
            min: 0.2,
            max: 10,
            step: 0.1,
        },
    ] as const;

    const imgSliders: {
        key: keyof ImagePlane;
        label: string;
        min: number;
        max: number;
        step: number;
        unit?: string;
    }[] = [
        { key: "x", label: "X", min: -9, max: 9, step: 0.1 },
        { key: "y", label: "Y", min: -2, max: 10, step: 0.1 },
        { key: "z", label: "Z", min: -9, max: 9, step: 0.1 },
        { key: "width", label: "Width", min: 0.1, max: 10, step: 0.1 },
        { key: "height", label: "Height", min: 0.1, max: 10, step: 0.1 },
        {
            key: "rotX",
            label: "Rot X",
            min: -180,
            max: 180,
            step: 1,
            unit: "°",
        },
        {
            key: "rotY",
            label: "Rot Y",
            min: -180,
            max: 180,
            step: 1,
            unit: "°",
        },
        {
            key: "rotZ",
            label: "Rot Z",
            min: -180,
            max: 180,
            step: 1,
            unit: "°",
        },
    ];

    const hasObjects = cylinders.value.length > 0 || images.value.length > 0;

    const sidebarItem = (
        active: boolean,
        label: string,
        onClick: () => void,
    ) => (
        <div
            onClick={onClick}
            style={`padding:5px 8px;border-radius:3px;cursor:pointer;font-size:11px;user-select:none;
        background:${active ? "#152238" : "#0e0e1a"};
        color:${active ? "#88aaff" : "#999"};
        border:1px solid ${active ? "#2a4488" : "transparent"};`}
        >
            {label}
        </div>
    );

    return (
        <div style="position:relative;width:100vw;height:100vh;overflow:hidden;font-family:ui-sans-serif,sans-serif;">
            <style>
                {`
        .od-btn { transition: filter 100ms ease, transform 80ms ease; }
        .od-btn:hover:not(:disabled) { filter: brightness(1.3); }
        .od-btn:active:not(:disabled) { filter: brightness(0.88); transform: translateY(1px); }
        .od-btn:disabled { opacity: 0.45; cursor: default !important; }
      `}
            </style>
            <canvas
                ref={canvasRef}
                style="display:block;width:100%;height:100%;"
                onClick={handleClick}
            />

            <aside style="position:absolute;top:0;left:0;width:214px;height:100%;background:rgba(8,8,18,0.88);color:#ccc;padding:12px;box-sizing:border-box;display:flex;flex-direction:column;gap:8px;overflow-y:auto;">
                <span style="font-size:13px;font-weight:700;color:#88aaff;letter-spacing:.06em;">
                    3D SCENE
                </span>

                {/* ── Scene management ── */}
                <div style="display:flex;flex-direction:column;gap:5px;">
                    <div
                        style="font-size:11px;color:#88aaff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;"
                        title={sceneName.value}
                    >
                        {sceneName.value}
                        {sceneId.value ? "" : " *"}
                    </div>
                    <button
                        class="od-btn"
                        onClick={() => showScenes.value = true}
                        style="padding:7px 10px;border:1px solid #2a3a66;border-radius:4px;font-size:12px;background:rgba(20,24,60,0.9);color:#88aaff;cursor:pointer;text-align:left;"
                    >
                        ☰ Scenes
                    </button>
                </div>
                <div style="border-top:1px solid #1e1e30;" />

                {/* Add buttons */}
                <button
                    class="od-btn"
                    onClick={() => {
                        placing.value = !placing.value;
                        selectedImgId.value = null;
                    }}
                    style={`padding:6px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;color:#fff;background:${
                        placing.value ? "#bb3311" : "#2255cc"
                    };`}
                >
                    {placing.value ? "✕  Cancel" : "+  Cylinder"}
                </button>
                <button
                    class="od-btn"
                    onClick={() => fileInputRef.current?.click()}
                    style="padding:6px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;color:#fff;background:#226633;"
                >
                    + Image
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    style="display:none;"
                    onChange={(e) => {
                        const file = (e.target as HTMLInputElement).files?.[0];
                        if (!file) return;
                        const newImg: ImagePlane = {
                            id: uid++,
                            name: file.name,
                            url: URL.createObjectURL(file),
                            x: 0,
                            y: 1.5,
                            z: 0,
                            rotX: 0,
                            rotY: 0,
                            rotZ: 0,
                            width: 2,
                            height: 2,
                        };
                        images.value = [...images.value, newImg];
                        selectedImgId.value = newImg.id;
                        selected.value = null;
                        placing.value = false;
                        (e.target as HTMLInputElement).value = "";
                    }}
                />

                {/* 360 Panorama */}
                <div style="border-top:1px solid #1e1e30;padding-top:8px;display:flex;flex-direction:column;gap:6px;">
                    <div style="font-size:10px;color:#445;text-transform:uppercase;letter-spacing:.08em;">
                        Environment
                    </div>
                    {panoName.value
                        ? (
                            <div style="display:flex;flex-direction:column;gap:4px;">
                                <span style="font-size:10px;color:#88aaff;word-break:break-all;">
                                    {panoName.value.length > 24
                                        ? panoName.value.slice(0, 22) + "…"
                                        : panoName.value}
                                </span>
                                <button
                                    class="od-btn"
                                    onClick={() => {
                                        panoUrl.value = null;
                                        panoName.value = null;
                                    }}
                                    style="padding:4px 8px;background:#331122;border:1px solid #552244;border-radius:3px;color:#cc88aa;font-size:11px;cursor:pointer;"
                                >
                                    Clear panorama
                                </button>
                            </div>
                        )
                        : (
                            <button
                                class="od-btn"
                                onClick={() => panoFileRef.current?.click()}
                                style="padding:6px 10px;border:none;border-radius:4px;cursor:pointer;font-size:12px;color:#fff;background:#443322;"
                            >
                                + 360 Panorama
                            </button>
                        )}
                    <input
                        ref={panoFileRef}
                        type="file"
                        accept="image/*"
                        style="display:none;"
                        onChange={(e) => {
                            const file = (e.target as HTMLInputElement).files
                                ?.[0];
                            if (!file) return;
                            panoUrl.value = URL.createObjectURL(file);
                            panoName.value = file.name;
                            (e.target as HTMLInputElement).value = "";
                        }}
                    />
                </div>

                {placing.value && (
                    <p style="font-size:11px;color:#6677aa;margin:0;">
                        Click the ground to place
                    </p>
                )}

                {/* Object list */}
                {hasObjects && (
                    <div style="font-size:10px;color:#445;text-transform:uppercase;letter-spacing:.08em;margin-top:4px;">
                        Objects
                    </div>
                )}
                {cylinders.value.map((c) =>
                    sidebarItem(
                        c.id === selected.value,
                        `Cylinder ${c.id}`,
                        () => {
                            selected.value = c.id === selected.value
                                ? null
                                : c.id;
                            if (selected.value !== null) {
                                selectedImgId.value = null;
                            }
                        },
                    )
                )}
                {images.value.map((i) => (
                    <div
                        key={i.id}
                        onClick={() => {
                            selectedImgId.value = i.id === selectedImgId.value
                                ? null
                                : i.id;
                            if (selectedImgId.value !== null) {
                                selected.value = null;
                            }
                        }}
                        style={`padding:5px 8px;border-radius:3px;cursor:pointer;font-size:11px;user-select:none;
              background:${
                            i.id === selectedImgId.value ? "#152218" : "#0e0e1a"
                        };
              color:${i.id === selectedImgId.value ? "#88ffaa" : "#999"};
              border:1px solid ${
                            i.id === selectedImgId.value
                                ? "#2a5533"
                                : "transparent"
                        };`}
                    >
                        {i.name.length > 22
                            ? i.name.slice(0, 20) + "…"
                            : i.name}
                    </div>
                ))}

                {/* Cylinder properties */}
                {selectedCyl.value && (
                    <div style="margin-top:4px;display:flex;flex-direction:column;gap:8px;border-top:1px solid #1e1e30;padding-top:10px;">
                        <span style="font-size:10px;color:#445;text-transform:uppercase;letter-spacing:.08em;">
                            Properties
                        </span>
                        {cylSliders.map(({ key, label, min, max, step }) => (
                            <label
                                key={key}
                                style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#aaa;"
                            >
                                <span style="display:flex;justify-content:space-between;">
                                    <span>{label}</span>
                                    <span style="color:#88aaff;">
                                        {selectedCyl.value![key].toFixed(2)}
                                    </span>
                                </span>
                                <input
                                    type="range"
                                    min={min}
                                    max={max}
                                    step={step}
                                    value={selectedCyl.value![key]}
                                    onInput={(e) =>
                                        updateCyl(
                                            key,
                                            parseFloat(
                                                (e.target as HTMLInputElement)
                                                    .value,
                                            ),
                                        )}
                                    style="width:100%;accent-color:#3388ff;"
                                />
                            </label>
                        ))}
                        <button
                            class="od-btn"
                            onClick={() => {
                                cylinders.value = cylinders.value.filter((c) =>
                                    c.id !== selected.value
                                );
                                selected.value = null;
                            }}
                            style="padding:4px 8px;background:#771111;border:none;border-radius:3px;color:#eee;font-size:11px;cursor:pointer;"
                        >
                            Delete
                        </button>
                    </div>
                )}

                {/* Image properties */}
                {selectedImg.value && (
                    <div style="margin-top:4px;display:flex;flex-direction:column;gap:8px;border-top:1px solid #1e1e30;padding-top:10px;">
                        <span style="font-size:10px;color:#445;text-transform:uppercase;letter-spacing:.08em;">
                            Properties
                        </span>
                        {imgSliders.map((
                            { key, label, min, max, step, unit },
                        ) => (
                            <label
                                key={key as string}
                                style="display:flex;flex-direction:column;gap:3px;font-size:11px;color:#aaa;"
                            >
                                <span style="display:flex;justify-content:space-between;">
                                    <span>{label}</span>
                                    <span style="color:#88ffaa;">
                                        {(selectedImg.value![key] as number)
                                            .toFixed(unit ? 0 : 2)}
                                        {unit ?? ""}
                                    </span>
                                </span>
                                <input
                                    type="range"
                                    min={min}
                                    max={max}
                                    step={step}
                                    value={selectedImg.value![key] as number}
                                    onInput={(e) =>
                                        updateImg(
                                            key,
                                            parseFloat(
                                                (e.target as HTMLInputElement)
                                                    .value,
                                            ),
                                        )}
                                    style="width:100%;accent-color:#33aa55;"
                                />
                            </label>
                        ))}
                        <button
                            class="od-btn"
                            onClick={() => {
                                images.value = images.value.filter((i) =>
                                    i.id !== selectedImgId.value
                                );
                                selectedImgId.value = null;
                            }}
                            style="padding:4px 8px;background:#771111;border:none;border-radius:3px;color:#eee;font-size:11px;cursor:pointer;"
                        >
                            Delete
                        </button>
                    </div>
                )}
            </aside>

            <button
                class="od-btn"
                onClick={() => {
                    orbitRef.current.tx = 0;
                    orbitRef.current.ty = 0;
                    orbitRef.current.tz = 0;
                    syncCameraRef.current?.();
                }}
                style="position:absolute;top:12px;right:12px;padding:5px 10px;background:rgba(20,20,40,0.85);border:1px solid #2a4488;border-radius:4px;color:#88aaff;font-size:11px;cursor:pointer;"
            >
                Reset View
            </button>

            <div style="position:absolute;bottom:10px;right:12px;color:#333;font-size:10px;text-align:right;pointer-events:none;">
                WASD · pan &nbsp;|&nbsp; Mid-drag · orbit &nbsp;|&nbsp; Scroll ·
                zoom &nbsp;|&nbsp; Click · select
            </div>

            {/* Hidden file input for import — lives at top level so it's always reachable */}
            <input
                ref={loadFileRef}
                type="file"
                accept=".json"
                style="display:none;"
                onChange={(e) => {
                    const file = (e.target as HTMLInputElement).files?.[0];
                    if (!file) return;
                    importScene(file);
                    (e.target as HTMLInputElement).value = "";
                }}
            />

            {/* Scenes modal */}
            {showScenes.value && (
                <div
                    style="position:fixed;inset:0;background:rgba(0,0,0,0.65);display:flex;align-items:center;justify-content:center;z-index:200;"
                    onClick={(e) => {
                        if (e.target === e.currentTarget && !saveModal.value) {
                            showScenes.value = false;
                        }
                    }}
                >
                    <div style="background:#0e0e1c;border:1px solid #2a3a66;border-radius:12px;padding:32px;width:580px;max-width:92vw;max-height:82vh;display:flex;flex-direction:column;gap:24px;box-shadow:0 20px 60px rgba(0,0,0,0.75);">
                        {/* Header */}
                        <div style="display:flex;align-items:center;justify-content:space-between;">
                            <span style="font-size:20px;font-weight:700;color:#88aaff;letter-spacing:.04em;">
                                Scenes
                            </span>
                            <button
                                class="od-btn"
                                onClick={() => {
                                    showScenes.value = false;
                                    saveModal.value = null;
                                }}
                                style="width:32px;height:32px;border:1px solid #2a3a66;border-radius:6px;background:transparent;color:#667;font-size:16px;cursor:pointer;display:flex;align-items:center;justify-content:center;"
                            >
                                ✕
                            </button>
                        </div>

                        {/* Save name input (shown when saving) */}
                        {saveModal.value
                            ? (
                                <div style="display:flex;flex-direction:column;gap:12px;background:rgba(20,28,70,0.7);border:1px solid #2a4488;border-radius:8px;padding:20px;">
                                    <span style="font-size:15px;color:#aabbdd;">
                                        {saveModal.value === "saveas"
                                            ? "Save as new scene"
                                            : "Save scene"}
                                    </span>
                                    <input
                                        type="text"
                                        value={saveModalName.value}
                                        onInput={(e) =>
                                            saveModalName.value =
                                                (e.target as HTMLInputElement)
                                                    .value}
                                        onKeyDown={(e) => {
                                            if (e.key === "Enter") {
                                                confirmSave();
                                            }
                                            if (e.key === "Escape") {
                                                saveModal.value = null;
                                            }
                                        }}
                                        placeholder="Scene name"
                                        autoFocus
                                        style="padding:10px 14px;background:#0c0c1a;border:1px solid #2a4488;border-radius:6px;color:#ddd;font-size:16px;outline:none;width:100%;box-sizing:border-box;"
                                    />
                                    <div style="display:flex;gap:10px;justify-content:flex-end;">
                                        <button
                                            class="od-btn"
                                            onClick={() =>
                                                saveModal.value = null}
                                            style="padding:8px 20px;background:transparent;border:1px solid #334455;border-radius:6px;color:#778899;font-size:14px;cursor:pointer;"
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            class="od-btn"
                                            onClick={confirmSave}
                                            disabled={!saveModalName.value
                                                .trim()}
                                            style={`padding:8px 20px;background:#1a2a6c;border:1px solid #3355aa;border-radius:6px;font-size:14px;cursor:${
                                                saveModalName.value.trim()
                                                    ? "pointer"
                                                    : "default"
                                            };color:${
                                                saveModalName.value.trim()
                                                    ? "#88aaff"
                                                    : "#445566"
                                            };`}
                                        >
                                            {saving.value ? "Saving…" : "Save"}
                                        </button>
                                    </div>
                                </div>
                            )
                            : (
                                <>
                                    {/* Current scene + action buttons */}
                                    <div style="display:flex;flex-direction:column;gap:12px;">
                                        <div style="font-size:14px;color:#667788;">
                                            Current scene:{" "}
                                            <span style="color:#88aaff;font-weight:600;">
                                                {sceneName.value}
                                            </span>
                                            {!sceneId.value && (
                                                <span style="color:#886655;font-style:italic;">
                                                    — unsaved
                                                </span>
                                            )}
                                        </div>
                                        <div style="display:flex;gap:10px;flex-wrap:wrap;">
                                            <button
                                                class="od-btn"
                                                onClick={saveScene}
                                                disabled={saving.value}
                                                style={`padding:10px 22px;border:1px solid #3355aa;border-radius:7px;font-size:15px;background:#1a2a6c;color:${
                                                    saving.value
                                                        ? "#445"
                                                        : "#88aaff"
                                                };cursor:${
                                                    saving.value
                                                        ? "default"
                                                        : "pointer"
                                                };font-weight:600;`}
                                            >
                                                {saving.value
                                                    ? "Saving…"
                                                    : "Save"}
                                            </button>
                                            <button
                                                class="od-btn"
                                                onClick={saveSceneAs}
                                                style="padding:10px 22px;border:1px solid #2a3a66;border-radius:7px;font-size:15px;background:rgba(20,24,60,0.9);color:#88aaff;cursor:pointer;"
                                            >
                                                Save As
                                            </button>
                                            <button
                                                class="od-btn"
                                                onClick={exportScene}
                                                disabled={saving.value}
                                                style={`padding:10px 22px;border:1px solid #2a3a55;border-radius:7px;font-size:15px;background:rgba(15,20,45,0.9);color:${
                                                    saving.value
                                                        ? "#445"
                                                        : "#99aabb"
                                                };cursor:${
                                                    saving.value
                                                        ? "default"
                                                        : "pointer"
                                                };`}
                                            >
                                                Export file
                                            </button>
                                            <button
                                                class="od-btn"
                                                onClick={() =>
                                                    loadFileRef.current
                                                        ?.click()}
                                                style="padding:10px 22px;border:1px solid #2a3a55;border-radius:7px;font-size:15px;background:rgba(15,20,45,0.9);color:#99aabb;cursor:pointer;"
                                            >
                                                Import file
                                            </button>
                                        </div>
                                    </div>

                                    {/* Divider */}
                                    <div style="border-top:1px solid #1a1a30;" />

                                    {/* Scene list */}
                                    <div style="display:flex;flex-direction:column;gap:8px;overflow-y:auto;flex:1;min-height:0;">
                                        <span style="font-size:13px;color:#445566;text-transform:uppercase;letter-spacing:.07em;">
                                            Saved scenes
                                        </span>
                                        {sceneIndex.value.length === 0
                                            ? (
                                                <div style="text-align:center;color:#334455;font-size:15px;padding:40px 0;">
                                                    No saved scenes yet
                                                </div>
                                            )
                                            : sceneIndex.value.map((entry) => (
                                                <div
                                                    key={entry.id}
                                                    style={`display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:8px;border:1px solid ${
                                                        entry.id ===
                                                                sceneId.value
                                                            ? "#2a4488"
                                                            : "#1a1a2e"
                                                    };background:${
                                                        entry.id ===
                                                                sceneId.value
                                                            ? "rgba(25,45,110,0.4)"
                                                            : "rgba(255,255,255,0.025)"
                                                    };`}
                                                >
                                                    <div style="flex:1;min-width:0;">
                                                        <div style="font-size:15px;color:#ccddee;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-weight:500;">
                                                            {entry.name}
                                                        </div>
                                                        <div style="font-size:12px;color:#445566;margin-top:3px;">
                                                            {new Date(
                                                                entry.savedAt,
                                                            ).toLocaleString(
                                                                [],
                                                                {
                                                                    month:
                                                                        "short",
                                                                    day: "numeric",
                                                                    year:
                                                                        "numeric",
                                                                    hour:
                                                                        "2-digit",
                                                                    minute:
                                                                        "2-digit",
                                                                },
                                                            )}
                                                        </div>
                                                    </div>
                                                    <button
                                                        class="od-btn"
                                                        onClick={() =>
                                                            loadSceneById(
                                                                entry.id,
                                                            )}
                                                        style="padding:8px 18px;font-size:14px;border:1px solid #2a4488;border-radius:6px;background:rgba(20,40,110,0.7);color:#88aaff;cursor:pointer;flex-shrink:0;font-weight:500;"
                                                    >
                                                        Load
                                                    </button>
                                                    <button
                                                        class="od-btn"
                                                        onClick={() =>
                                                            deleteSceneById(
                                                                entry.id,
                                                            )}
                                                        style="padding:8px 14px;font-size:14px;border:1px solid #441122;border-radius:6px;background:rgba(50,10,20,0.7);color:#cc6677;cursor:pointer;flex-shrink:0;"
                                                    >
                                                        Delete
                                                    </button>
                                                </div>
                                            ))}
                                    </div>
                                </>
                            )}
                    </div>
                </div>
            )}
        </div>
    );
}
