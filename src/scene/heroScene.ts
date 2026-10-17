// The scroll-driven BIM model behind the story sections (#story).
//
// One GSAP timeline holds every beat; ScrollTrigger scrubs it across #story.
// Beats, in order: hero (slow turn), federation (disciplines separate),
// clash (everything ghosts but the clash pair), review (a version wipe sweeps
// across), to-site (camera goes top-down and the canvas fades out to the 2D
// drawing section). Each beat spends its first part moving and the rest
// holding still, so the copy beside it can be read.
//
// The model is public/models/hero.glb, built by scripts/build-hero-model.mjs:
// top-level nodes named site, structure, architecture, mep, interior, and the
// clash pair as nodes named clash-a / clash-b.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { gsap } from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';

gsap.registerPlugin(ScrollTrigger);

export const BEATS = ['hero', 'federation', 'clash', 'review', 'to-site'] as const;
type Beat = (typeof BEATS)[number];

const GROUPS = ['site', 'structure', 'mep', 'interior', 'architecture'] as const;
type Group = (typeof GROUPS)[number];

// Stack order when the model separates, in building widths (the building is
// scaled to SIZE units across). Architecture lifts highest so the MEP and
// interior inside it come into view.
const SIZE = 10;
const LIFT: Record<Group, number> = { site: -2.2, structure: 0, mep: 2.6, interior: 5.2, architecture: 8 };
export const DISCIPLINE_COLOURS: Record<Group, string> = {
  site: '#7c8f63',
  structure: '#f2a93b',
  mep: '#5bba5f',
  interior: '#90b5cb',
  architecture: '#058dd8',
};
const CLASH_SPIN = 0.2; // turns of the model through the clash beat (see the timeline)
const CLASH_A = new THREE.Color('#ff2020');
const CLASH_B = new THREE.Color('#ffb020');
const GHOST = new THREE.Color('#29aae6');

interface CameraKey { x: number; y: number; z: number; tx: number; ty: number; tz: number; fov: number }
// What the timeline tweens: the camera on an orbit around its target (azimuth,
// elevation, radius), so a move between two shots swings around the model
// instead of cutting through it.
interface OrbitKey { az: number; el: number; r: number; tx: number; ty: number; tz: number; fov: number }

function toOrbit(k: CameraKey): OrbitKey {
  const dx = k.x - k.tx, dy = k.y - k.ty, dz = k.z - k.tz;
  const r = Math.hypot(dx, dy, dz);
  return { az: Math.atan2(dx, dz), el: Math.asin(dy / r), r, tx: k.tx, ty: k.ty, tz: k.tz, fov: k.fov };
}

// Positions relative to the model's centre, in scene units.
const SHOTS: Record<Beat | 'clashClose' | 'plan', CameraKey> = {
  hero: { x: 11, y: 6.5, z: 13, tx: 0, ty: 0.6, tz: 0, fov: 35 },
  federation: { x: 17, y: 10, z: 19, tx: 0, ty: 3.8, tz: 0, fov: 38 },
  clash: { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: 30 }, // filled from the clash pair's position
  clashClose: { x: 0, y: 0, z: 0, tx: 0, ty: 0, tz: 0, fov: 30 },
  review: { x: -12, y: 5.5, z: 12, tx: 0, ty: 0.8, tz: 0, fov: 35 },
  'to-site': { x: 0.01, y: 22, z: 0.01, tx: 0, ty: 0, tz: 0, fov: 34 },
  // Nearly straight down, on the review shot's bearing so the camera only tilts.
  plan: { x: -0.4, y: 22, z: 0.4, tx: 0, ty: 0, tz: 0, fov: 34 },
};

export interface HeroSceneOptions {
  canvas: HTMLCanvasElement;
  story: HTMLElement; // wraps the beat sections; each has data-beat="<beat>"
  modelUrl: string;
  labels?: HTMLElement; // container for discipline labels, positioned over the canvas
  onReady?: () => void;
}

export function webglAvailable(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch {
    return false;
  }
}

function lowPower(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (
    window.matchMedia('(max-width: 767px)').matches ||
    (nav.hardwareConcurrency ?? 8) <= 4 ||
    (nav.deviceMemory ?? 8) <= 4
  );
}

export async function initHeroScene(opts: HeroSceneOptions): Promise<() => void> {
  const { canvas, story, modelUrl, labels } = opts;
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const light = lowPower();

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !light, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, light ? 1.25 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.localClippingEnabled = true;

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  pmrem.dispose();
  const sun = new THREE.DirectionalLight('#ffffff', 1.6);
  sun.position.set(8, 14, 6);
  scene.add(sun, new THREE.HemisphereLight('#dbeeff', '#0b1a2a', 0.6));

  const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 400);

  // ---- model ------------------------------------------------------------
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const gltf = await loader.loadAsync(modelUrl);
  const model = gltf.scene;

  const groups = {} as Record<Group, THREE.Object3D>;
  for (const g of GROUPS) {
    const node = model.getObjectByName(g);
    if (!node) throw new Error(`hero model has no "${g}" group`);
    groups[g] = node;
  }

  // Centre and scale on the building itself; the site runs far wider.
  const buildingBox = new THREE.Box3().setFromObject(groups.architecture);
  const centre = buildingBox.getCenter(new THREE.Vector3());
  const scale = SIZE / Math.max(...buildingBox.getSize(new THREE.Vector3()).toArray());
  const root = new THREE.Group();
  model.position.copy(centre).multiplyScalar(-scale);
  model.position.y = -buildingBox.min.y * scale; // ground floor at y=0
  model.scale.setScalar(scale);
  root.add(model);
  scene.add(root);
  // A quiet ground disc a tone step above the page, so the building sits on something.
  const ground = new THREE.Mesh(
    new THREE.CircleGeometry(SIZE * 0.85, 96),
    new THREE.MeshBasicMaterial({ color: '#0a2e4e', transparent: true, depthWrite: false }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.02;
  ground.renderOrder = -1;
  scene.add(ground);

  const baseY = Object.fromEntries(GROUPS.map((g) => [g, groups[g].position.y])) as Record<Group, number>;

  // Every group gets its own material copies so it can be tinted and ghosted
  // alone. Each entry remembers the material's own look to blend back to.
  interface Mat { m: THREE.MeshStandardMaterial; colour: THREE.Color; opacity: number; transparent: boolean; group: Group; clash?: 'a' | 'b' }
  const mats: Mat[] = [];
  const clashMeshes: THREE.Mesh[] = [];
  for (const g of GROUPS) {
    const cache = new Map<THREE.Material, THREE.MeshStandardMaterial>();
    groups[g].traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      const clash = o.name === 'clash-a' ? 'a' : o.name === 'clash-b' ? 'b' : undefined;
      if (clash) clashMeshes.push(mesh);
      const src = mesh.material as THREE.MeshStandardMaterial;
      let m = clash ? undefined : cache.get(src);
      if (!m) {
        m = src.clone();
        m.side = THREE.DoubleSide; // Revit shells are not always closed
        mats.push({ m, colour: m.color.clone(), opacity: m.opacity, transparent: m.transparent, group: g, clash });
        if (!clash) cache.set(src, m);
      }
      mesh.material = m;
    });
  }

  // The "previous version" for the review wipe: the same geometry drawn flat
  // in brand blue, clipped to the other side of the same plane. It doubles the
  // triangles only while the wipe runs, which phones handle, so every device gets it.
  const wipePlane = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 0);
  const ghostPlane = new THREE.Plane(new THREE.Vector3(1, 0, 0), 0);
  let ghost: THREE.Object3D | undefined;
  const ghostMat = new THREE.MeshBasicMaterial({ color: GHOST, transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, clippingPlanes: [ghostPlane] });
  {
    ghost = model.clone(true);
    ghost.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).material = ghostMat; });
    ghost.visible = false;
    root.add(ghost);
  }
  const wipeBox = new THREE.Box3();
  const wipeSize = new THREE.Vector3();
  const wipeLine = new THREE.Mesh(
    new THREE.PlaneGeometry(1, 1),
    new THREE.MeshBasicMaterial({ color: '#29aae6', transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false }),
  );
  scene.add(wipeLine);
  const wipeRight = new THREE.Vector3();
  const corner = new THREE.Vector3();
  const UP = new THREE.Vector3(0, 1, 0);
  const Z = new THREE.Vector3(0, 0, 1);

  // Camera shots on the clash pair, now that the model is placed.
  // World matrices are stale until the first render; the boxes below need the placed model.
  scene.updateMatrixWorld(true);
  const clashBox = new THREE.Box3();
  for (const m of clashMeshes) clashBox.expandByObject(m);
  if (!clashBox.isEmpty()) {
    // Only clash-a (the MEP element) decides the framing; the wall is long.
    const a = clashMeshes.find((m) => m.name === 'clash-a');
    // The model has turned by CLASH_SPIN by the time the clash beat plays, so frame where the tank will be then.
    const focus = new THREE.Box3().setFromObject(a ?? clashMeshes[0]).getCenter(new THREE.Vector3())
      .applyAxisAngle(new THREE.Vector3(0, 1, 0), CLASH_SPIN * Math.PI * 2);
    // Look in at the tank from outside the building, a little off its own
    // bearing; the beat then closes in with the lens, not by moving the camera.
    const bearing = Math.atan2(focus.x, focus.z) + 0.35;
    const el = 0.42, r = 12;
    const from = (fov: number): CameraKey => ({
      x: focus.x + Math.sin(bearing) * Math.cos(el) * r,
      y: focus.y + Math.sin(el) * r,
      z: focus.z + Math.cos(bearing) * Math.cos(el) * r,
      tx: focus.x, ty: focus.y, tz: focus.z, fov,
    });
    SHOTS.clash = from(30);
    SHOTS.clashClose = from(21);
  }

  // ---- discipline labels -----------------------------------------------------
  const labelEls = {} as Partial<Record<Group, HTMLElement>>;
  if (labels) {
    for (const el of labels.querySelectorAll<HTMLElement>('[data-group]')) {
      labelEls[el.dataset.group as Group] = el;
    }
  }
  const anchor = new THREE.Vector3();
  const anchorBoxes = Object.fromEntries(GROUPS.map((g) => [g, new THREE.Box3().setFromObject(groups[g])])) as Record<Group, THREE.Box3>;

  // ---- animated state ----------------------------------------------------------
  // Each shot as an orbit key, its azimuth unwrapped against the shot before
  // so every swing takes the short way round.
  const order = ['hero', 'federation', 'clash', 'clashClose', 'review', 'plan'] as const;
  const ORBITS = {} as Record<(typeof order)[number], OrbitKey>;
  order.forEach((name, i) => {
    const k = toOrbit(SHOTS[name]);
    if (i > 0) {
      const prev = ORBITS[order[i - 1]].az;
      k.az = prev + Math.atan2(Math.sin(k.az - prev), Math.cos(k.az - prev));
    }
    ORBITS[name] = k;
  });

  const state = {
    ...ORBITS.hero,
    spin: 0, // turns of the model about its own axis
    lift: 0, // 0 assembled, 1 fully separated
    tint: 0, // discipline colour on each group
    ghost: 0, // 0 solid, 1 everything but the clash pair see-through
    clash: 0, // red/amber on the pair
    wipe: -1, // -1 before the review, 0..1 sweep across, 2 done
    labels: 0,
    fade: 1, // canvas opacity
  };

  const tl = gsap.timeline({ paused: true, defaults: { ease: 'power2.inOut' } });
  const move = 0.6; // share of each beat spent moving; the rest holds
  const shot = (k: OrbitKey) => ({ ...k });

  tl.addLabel('hero', 0)
    .to(state, { spin: 0.12, duration: 1, ease: 'none' }, 0)
    .addLabel('federation', 1)
    .to(state, { ...shot(ORBITS.federation), lift: 1, tint: 1, duration: move }, 1)
    .to(state, { labels: 1, duration: 0.2 }, 1 + move * 0.7)
    .to(state, { spin: CLASH_SPIN, duration: 1, ease: 'none' }, 1)
    .addLabel('clash', 2)
    .to(state, { lift: 0, tint: 0, labels: 0, duration: move * 0.6 }, 2)
    .to(state, { ...shot(ORBITS.clash), ghost: 1, clash: 1, duration: move }, 2)
    .to(state, { ...shot(ORBITS.clashClose), duration: 1 - move, ease: 'none' }, 2 + move)
    .addLabel('review', 3)
    .to(state, { ...shot(ORBITS.review), ghost: 0, clash: 0, spin: 0.25, duration: move * 0.7 }, 3)
    .fromTo(state, { wipe: 0 }, { wipe: 1, duration: 1 - move * 0.5, ease: 'power1.inOut', immediateRender: false }, 3 + move * 0.5)
    .addLabel('to-site', 4)
    .to(state, { wipe: 2, duration: 0.01 }, 4)
    .to(state, { ...shot(ORBITS.plan), spin: 0.25, duration: move }, 4)
    .to(state, { fade: 0, duration: 1 - move, ease: 'power1.in' }, 4 + move)
    .addLabel('end', 5);

  // ---- apply + render --------------------------------------------------------------
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const tmp = new THREE.Color();
  let needsRender = true;
  // Hero only: a slow idle turn. Past the hero it eases to the nearest whole
  // turn, so the later beats (and the clash shot) see the timeline's spin alone.
  let idle = 0;
  let last = 0;

  function apply(time: number) {
    const dt = Math.min(0.1, (time - (last || time)) / 1000);
    last = time;
    if (tl.time() < 1 && !reduced) idle += dt * 0.025;
    else idle += (Math.round(idle) - idle) * Math.min(1, dt * 4);
    root.rotation.y = (state.spin + idle) * Math.PI * 2;

    for (const g of GROUPS) groups[g].position.y = baseY[g] + (LIFT[g] / scale) * state.lift;
    ground.material.opacity = 1 - Math.max(state.lift, state.ghost);
    ground.visible = ground.material.opacity > 0.01;

    for (const e of mats) {
      if (e.clash) {
        // The tank glows red; the wall it runs into only warms to amber.
        const strength = e.clash === 'a' ? 1 : 0.55;
        e.m.color.copy(e.colour).lerp(e.clash === 'a' ? CLASH_A : CLASH_B, state.clash * strength);
        e.m.emissive.copy(e.clash === 'a' ? CLASH_A : CLASH_B).multiplyScalar(state.clash * (e.clash === 'a' ? 0.35 : 0.1));
        if (e.clash === 'b') {
          // See the tank through the wall it runs into.
          e.m.opacity = 1 - state.clash * 0.5;
          e.m.transparent = e.m.opacity < 0.999;
          e.m.depthWrite = !e.m.transparent;
        }
        continue;
      }
      e.m.color.copy(e.colour).lerp(tmp.set(DISCIPLINE_COLOURS[e.group]), state.tint * 0.45);
      const op = e.opacity * (1 - state.ghost * 0.93);
      e.m.opacity = op;
      e.m.transparent = e.transparent || op < 0.999;
      e.m.depthWrite = op >= 0.999;
      e.m.clippingPlanes = state.wipe >= 0 && state.wipe <= 1 ? [wipePlane] : null;
    }

    // Version wipe: a vertical plane sweeps left to right across the screen.
    // Left of it is the new version, right of it the previous one in blue.
    const sweeping = state.wipe >= 0 && state.wipe <= 1;
    if (sweeping) {
      // The screen's horizontal, from the camera's current shot.
      wipeRight.set(-Math.sin(state.az), 0, -Math.cos(state.az)).cross(UP).normalize();
      // Measured as the model stands now (it turns through the review); boxes only, so it is cheap.
      // The building itself, not the panels and turbines out on the site.
      wipeBox.setFromObject(groups.architecture).getSize(wipeSize);
      let lo = Infinity, hi = -Infinity;
      for (let i = 0; i < 8; i++) {
        corner.set(i & 1 ? wipeBox.max.x : wipeBox.min.x, 0, i & 2 ? wipeBox.max.z : wipeBox.min.z);
        const d = corner.dot(wipeRight);
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
      const c = THREE.MathUtils.lerp(lo, hi, state.wipe);
      wipePlane.normal.copy(wipeRight).negate();
      wipePlane.constant = c; // keeps right·p <= c
      ghostPlane.normal.copy(wipeRight);
      ghostPlane.constant = -c; // keeps right·p >= c
      wipeBox.getCenter(corner);
      wipeLine.position.copy(corner).addScaledVector(wipeRight, c - corner.dot(wipeRight));
      wipeLine.quaternion.setFromUnitVectors(Z, wipeRight);
      const across = Math.hypot(wipeSize.x, wipeSize.z);
      wipeLine.scale.set(across, wipeSize.y * 1.05, 1);
    }
    wipeLine.material.opacity = sweeping ? 0.14 * Math.sin(Math.PI * state.wipe) + 0.04 : 0;
    wipeLine.visible = sweeping;
    if (ghost) {
      ghost.visible = sweeping;
      ghost.rotation.copy(model.rotation);
      ghostMat.opacity = sweeping ? 0.28 : 0;
      // the ghost hangs off root beside model, so copy model's placement
      ghost.position.copy(model.position);
      ghost.scale.copy(model.scale);
    }

    pointer.x += (pointer.tx - pointer.x) * 0.06;
    pointer.y += (pointer.ty - pointer.y) * 0.06;
    const flat = Math.cos(state.el) * state.r;
    camera.position.set(
      state.tx + Math.sin(state.az) * flat + pointer.x * 0.6,
      state.ty + Math.sin(state.el) * state.r + pointer.y * 0.4,
      state.tz + Math.cos(state.az) * flat,
    );
    camera.lookAt(state.tx, state.ty, state.tz);
    if (camera.fov !== state.fov) {
      camera.fov = state.fov;
      camera.updateProjectionMatrix();
    }
    canvas.style.opacity = String(state.fade);

    if (labels) {
      labels.style.opacity = String(state.labels);
      if (state.labels > 0) {
        for (const g of GROUPS) {
          const el = labelEls[g];
          if (!el) continue;
          anchorBoxes[g].setFromObject(groups[g]).getCenter(anchor);
          anchor.x = anchorBoxes[g].max.x;
          anchor.project(camera);
          el.style.transform = `translate(${((anchor.x + 1) / 2) * canvas.clientWidth}px, ${((1 - anchor.y) / 2) * canvas.clientHeight}px)`;
        }
      }
    }
  }

  function resize() {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Narrow screens: pull back so the building still fits across.
    camera.zoom = Math.min(1, camera.aspect / 1.1);
    // Wide screens: the copy runs down the left third (Story.astro), so shift
    // the view to put the model in the right two thirds. Phones keep it centred
    // above the copy panel.
    // Phones and tablets: the copy panel takes the bottom of the screen, so lift the model into the top part.
    if (w >= 1024) camera.setViewOffset(w, h, -w * 0.2, 0, w, h);
    else camera.setViewOffset(w, h, 0, h * 0.2, w, h);
    camera.updateProjectionMatrix();
    needsRender = true;
  }

  // ---- scroll wiring ----------------------------------------------------------------
  let trigger: ScrollTrigger | undefined;
  let offRefresh = () => {};
  const beatTriggers: ScrollTrigger[] = [];
  if (reduced) {
    // No scrubbed motion: each section jumps the model to its beat's resting state.
    for (const section of story.querySelectorAll<HTMLElement>('[data-beat]')) {
      const beat = section.dataset.beat as Beat;
      const i = BEATS.indexOf(beat);
      const at = i + 0.99;
      beatTriggers.push(ScrollTrigger.create({
        trigger: section,
        start: 'top center',
        end: 'bottom center',
        onToggle: (self) => { if (self.isActive) { tl.seek(at); needsRender = true; } },
      }));
    }
    tl.seek(0.99);
  } else {
    // Beat i plays against its own section, not an even share of #story: it
    // moves while the section rises from the bottom of the screen to a quarter
    // down (when its copy panel arrives), then holds until the next section
    // starts to enter. Sections differ in height, so the map is piecewise.
    const sections = BEATS.map((b) => story.querySelector<HTMLElement>(`[data-beat="${b}"]`)!);
    let stops: { s: number; t: number }[] = [];
    const measure = () => {
      const vh = window.innerHeight;
      stops = [];
      sections.forEach((el, i) => {
        const top = el.getBoundingClientRect().top + window.scrollY;
        stops.push({ s: top - vh, t: i }, { s: top - vh * 0.25, t: i + move }, { s: top + el.offsetHeight - vh, t: i + 1 });
      });
    };
    const timeAt = (s: number) => {
      if (s <= stops[0].s) return 0;
      for (let k = 1; k < stops.length; k++) {
        const a = stops[k - 1], b = stops[k];
        if (s <= b.s) return b.s === a.s ? b.t : a.t + ((s - a.s) / (b.s - a.s)) * (b.t - a.t);
      }
      return BEATS.length;
    };
    measure();
    ScrollTrigger.addEventListener('refresh', measure);
    offRefresh = () => ScrollTrigger.removeEventListener('refresh', measure);
    const playhead = { t: 0 };
    trigger = ScrollTrigger.create({
      trigger: story,
      start: 'top bottom',
      end: 'bottom top',
      onRefresh: () => { tl.time(timeAt(window.scrollY)); needsRender = true; },
      onUpdate: () => {
        // A short catch-up keeps fast flicks smooth; Lenis already smooths the scroll itself.
        gsap.to(playhead, {
          t: timeAt(window.scrollY), duration: 0.5, ease: 'power3.out', overwrite: true,
          onUpdate: () => { tl.time(playhead.t); needsRender = true; },
        });
      },
    });
    tl.time(timeAt(window.scrollY));
  }

  // Render only while the canvas is on screen and something is moving.
  let visible = true;
  const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; if (visible) needsRender = true; });
  io.observe(canvas);
  const onPointer = (e: PointerEvent) => {
    if (reduced || e.pointerType !== 'mouse') return;
    pointer.tx = (e.clientX / window.innerWidth) * 2 - 1;
    pointer.ty = -((e.clientY / window.innerHeight) * 2 - 1);
  };
  window.addEventListener('pointermove', onPointer, { passive: true });
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  // Fonts and images settle after the first paint and change where each beat's
  // section sits; re-measure (the refresh listener above) whenever #story resizes.
  let refreshQueued = 0;
  const storyRo = new ResizeObserver(() => {
    cancelAnimationFrame(refreshQueued);
    refreshQueued = requestAnimationFrame(() => ScrollTrigger.refresh());
  });
  storyRo.observe(story);
  resize();

  let raf = 0;
  const loop = (time: number) => {
    raf = requestAnimationFrame(loop);
    if (!visible) return;
    const settling = Math.abs(pointer.tx - pointer.x) + Math.abs(pointer.ty - pointer.y) > 0.001;
    const idling = (tl.time() < 1 && !reduced) || Math.abs(Math.round(idle) - idle) > 0.0005;
    if (!needsRender && !settling && !idling) return;
    needsRender = false;
    apply(time);
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(loop);
  opts.onReady?.();
  if (import.meta.env.DEV) Object.assign(window, { __hero: { state, camera, tl, root, SHOTS, ORBITS, renderer, scene } });

  return () => {
    cancelAnimationFrame(raf);
    trigger?.kill();
    offRefresh();
    for (const t of beatTriggers) t.kill();
    tl.kill();
    io.disconnect();
    ro.disconnect();
    storyRo.disconnect();
    cancelAnimationFrame(refreshQueued);
    window.removeEventListener('pointermove', onPointer);
    envTex.dispose();
    renderer.dispose();
  };
}
