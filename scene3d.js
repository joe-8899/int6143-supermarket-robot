// 3D 画面：绘制超市、货架、顾客、机器人和路线。
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { STORE, shelves, layoutFixtures, products, peopleForScenario, shelfCrowd } from "./storeData.js";

const X_SCALE = .17;
const floorPoint = ([x, y], height = .025) => new THREE.Vector3((x - STORE.width / 2) * X_SCALE, height, (STORE.height / 2 - y) * X_SCALE);
const mat = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .76, metalness: .04, ...options });
const colors = {
  floor: 0xe9f0e8, aisle: 0xf5f7f1, frame: 0x547969, frameDark: 0x315746,
  produce: 0xb7d28a, dairy: 0x91c7d4, snack: 0xe8b575, drink: 0xe49e8a,
  frozen: 0x9fc9d3, grain: 0xd2b06e, household: 0xb5a9ce, bakery: 0xdeb386,
};

function addBox(parent, width, height, depth, material, x, y, z, cast = false) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = cast;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}
function addCylinder(parent, top, bottom, height, material, x, y, z, segments = 12) {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(top, bottom, height, segments), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
function addSphere(parent, radius, material, x, y, z, width = 14, height = 10) {
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(radius, width, height), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  parent.add(mesh);
  return mesh;
}
function makeLabel(text, background = "#ffffff", foreground = "#254a37", scale = 1) {
  const canvas = document.createElement("canvas");
  canvas.width = 420; canvas.height = 142;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = background;
  ctx.beginPath(); ctx.roundRect(8, 8, 404, 126, 28); ctx.fill();
  ctx.strokeStyle = "rgba(39,77,56,.16)"; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = foreground; ctx.font = '700 68px "Noto Sans SC", sans-serif'; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, 210, 71);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false }));
  sprite.scale.set(1.9 * scale, .64 * scale, 1);
  return sprite;
}
function ribbon(points, width, color, y, opacity = 1, dashed = false) {
  const vertices = [];
  for (let i = 1; i < points.length; i++) {
    const a = floorPoint(points[i - 1], y), b = floorPoint(points[i], y);
    const dx = b.x - a.x, dz = b.z - a.z, length = Math.hypot(dx, dz);
    if (length < .001) continue;
    const nx = -dz / length * width / 2, nz = dx / length * width / 2;
    const count = dashed ? Math.ceil(length / .55) : 1;
    for (let j = 0; j < count; j++) {
      if (dashed && j % 2) continue;
      const t0 = j / count, t1 = Math.min(1, (j + (dashed ? .68 : 1)) / count);
      const x0 = a.x + dx * t0, z0 = a.z + dz * t0;
      const x1 = a.x + dx * t1, z1 = a.z + dz * t1;
      vertices.push(x0 + nx, y, z0 + nz, x0 - nx, y, z0 - nz, x1 + nx, y, z1 + nz);
      vertices.push(x0 - nx, y, z0 - nz, x1 - nx, y, z1 - nz, x1 + nx, y, z1 + nz);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.computeVertexNormals();
  return new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, side: THREE.DoubleSide, depthWrite: false }));
}
function disposeGroup(group) {
  for (const child of [...group.children]) {
    group.remove(child);
    child.geometry?.dispose();
    child.material?.dispose();
  }
}

export function createStoreScene(container, fallback) {
  try { return buildScene(container); }
  catch (error) {
    console.error("3D 场景无法启动", error);
    container.parentElement.classList.add("is-fallback");
    fallback.removeAttribute("aria-hidden");
    return { setRobot() {}, setScenario() {}, setRoutes() {}, setHistory() {}, setBought() {}, setPickups() {}, resetCamera() {} };
  }
}

function buildScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xeaf1e9);
  scene.fog = new THREE.Fog(0xeaf1e9, 30, 58);
  const camera = new THREE.PerspectiveCamera(42, 1, .1, 100);
  const startCamera = new THREE.Vector3(12.5, 15, 17);
  camera.position.copy(startCamera); camera.lookAt(0, .3, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.7));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.5;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, .45, 0);
  controls.enableDamping = true; controls.dampingFactor = .08;
  controls.minDistance = 13; controls.maxDistance = 48;
  controls.minPolarAngle = .25; controls.maxPolarAngle = 1.42;
  controls.enablePan = false; controls.update();

  scene.add(new THREE.HemisphereLight(0xffffff, 0xb9cbb8, 2.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.3);
  sun.position.set(-7, 18, 12); sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -15; sun.shadow.camera.right = 15; sun.shadow.camera.top = 12; sun.shadow.camera.bottom = -12;
  sun.shadow.normalBias = .025;
  scene.add(sun);

  const floorWidth = STORE.width * X_SCALE + .5, floorDepth = STORE.height * X_SCALE + .5;
  const floor = addBox(scene, floorWidth, .16, floorDepth, mat(colors.floor), 0, -.1, 0);
  floor.receiveShadow = true;
  for (const x of STORE.aisleXs) {
    const c = floorPoint([x, 45]);
    addBox(scene, .9, .012, 12.6, mat(colors.aisle), c.x, .003, c.z);
  }
  for (const y of STORE.crossYs) {
    const c = floorPoint([70, y]);
    addBox(scene, 22.5, .012, .9, mat(colors.aisle), c.x, .008, c.z);
  }
  const borderMat = mat(0xaec4b1);
  addBox(scene, floorWidth, .12, .12, borderMat, 0, .05, -floorDepth / 2);
  addBox(scene, floorWidth, .12, .12, borderMat, 0, .05, floorDepth / 2);
  addBox(scene, .12, .12, floorDepth, borderMat, -floorWidth / 2, .05, 0);
  addBox(scene, .12, .12, floorDepth, borderMat, floorWidth / 2, .05, 0);

  // 参照所给平面图绘制外围展示架、后方促销区与入口旁冲动购买区。
  for(const f of layoutFixtures){
    const p=floorPoint([f.x,f.y],0),color=f.kind==='promo'?0xd98b86:f.kind==='impulse'?0xe9c46d:0x6995ae;
    const height=f.kind==='wall'?1.1:.18;
    addBox(scene,f.w*X_SCALE,height,f.h*X_SCALE,mat(color),p.x,height/2,p.z,true);
    const label=makeLabel(f.label,'#ffffff','#274638',f.label.length>5?.6:.75);
    label.position.set(p.x,height+.3,p.z);scene.add(label);
  }
  for(const [text,y] of [['日化与生活用品',29],['饮料与包装食品',51],['食品杂货与生鲜',73]]){
    const p=floorPoint([70,y]);const sign=makeLabel(text,'#f8fff6','#286a4b',.85);
    sign.position.set(p.x,2.85,p.z);scene.add(sign);
  }

  const heatTiles = [];
  const categoryColors = [colors.produce, colors.snack, colors.frozen, colors.drink, colors.dairy, colors.bakery, colors.grain, colors.household];
  const shelfFrame = mat(colors.frame), darkFrame = mat(colors.frameDark);
  shelves.forEach((shelf, shelfIndex) => {
    const center = floorPoint([(shelf.xMin + shelf.xMax) / 2, (shelf.yMin + shelf.yMax) / 2], 0);
    const rack = new THREE.Group(); rack.position.set(center.x, 0, center.z); scene.add(rack);
    const heat = new THREE.Mesh(new THREE.PlaneGeometry(2.45, 2.05), new THREE.MeshBasicMaterial({color:0x75b888,transparent:true,opacity:.16,depthWrite:false,side:THREE.DoubleSide}));
    heat.rotation.x=-Math.PI/2; heat.position.set(center.x,.019,center.z); scene.add(heat); heatTiles.push(heat);
    const width = (shelf.xMax - shelf.xMin) * X_SCALE - .1;
    const depth = (shelf.yMax - shelf.yMin) * X_SCALE - .1;
    addBox(rack, width, .12, depth, darkFrame, 0, .12, 0, true);
    for (const edgeX of [-width / 2 + .06, width / 2 - .06]) addBox(rack, .12, 1.63, depth, shelfFrame, edgeX, .89, 0, true);
    for (const height of [.53, 1.02, 1.5]) addBox(rack, width - .08, .075, depth - .04, shelfFrame, 0, height, 0, true);
    const productMat = mat(categoryColors[shelfIndex % categoryColors.length]);
    const accent = mat(new THREE.Color(categoryColors[shelfIndex % categoryColors.length]).offsetHSL(.015, .02, -.13));
    for (let level = 0; level < 3; level++) {
      for (let row = 0; row < 2; row++) {
        for (let n = 0; n < 6; n++) {
          const productX = -width / 2 + .22 + n * ((width - .44) / 5);
          const productZ = (row ? .49 : -.49) * (depth / 2);
          const productHeight = .27 + ((n + level + shelfIndex) % 3) * .045;
          const product = addBox(rack, .24, productHeight, .23, (n + row) % 4 ? productMat : accent, productX, [.53, 1.02, 1.5][level] + .038 + productHeight / 2, productZ, false);
          product.castShadow = false;
        }
      }
    }
    const label = makeLabel(shelf.category, "#ffffff", "#234a36", shelf.category.length > 3 ? .84 : 1);
    label.position.set(0, 2.12, 0); rack.add(label);
    const names=products.filter(p=>p.shelfId===shelf.id).slice(0,2).map(p=>p.name).join(" · ");
    const productLabel=makeLabel(names,"#f4f7ef","#416b50",.61);
    productLabel.position.set(0,2.52,0);rack.add(productLabel);
  });

  function signAt(point, text, color = "#275c42", offsetX = 0) {
    const p = floorPoint(point);
    const poleMat = mat(0x476b55);
    addCylinder(scene, .035, .035, 1.55, poleMat, p.x + offsetX, .775, p.z);
    const sign = makeLabel(text, color, "#ffffff", .78);
    sign.position.set(p.x + offsetX, 1.75, p.z); scene.add(sign);
  }
  signAt(STORE.entrance, "入口", "#23684d", -.15);
  signAt(STORE.exit, "出口", "#23684d", .13);
  signAt(STORE.checkout, "结账", "#ce8a4a", -.1);
  const counterPoint = floorPoint([129.5, 5]);
  addBox(scene, 1.08, .56, .44, mat(0x7f9b86), counterPoint.x, .28, counterPoint.z, true);
  addBox(scene, 1.15, .08, .5, mat(0xd9e5d7), counterPoint.x, .59, counterPoint.z);

  const pointGroup = new THREE.Group(); scene.add(pointGroup);
  const markerMats = { pending: mat(0xffffff), bought: mat(0x4f9a6a) };
  let markerObjects = [];
  function setPickups(pickups, boughtCount=0) {
    for (const child of [...pointGroup.children]) { pointGroup.remove(child); }
    markerObjects = pickups.map((point,index)=>{
      const p=floorPoint(point), group=new THREE.Group(); group.position.set(p.x,0,p.z); pointGroup.add(group);
      addCylinder(group,.25,.25,.065,index<boughtCount?markerMats.bought:markerMats.pending,0,.07,0,24);
      const label=makeLabel(index<boughtCount?"✓":String(index+1),"#ffffff","#276047",.42);
      label.position.y=.62; group.add(label); return {group,label};
    });
  }

  const robot = new THREE.Group(); scene.add(robot);
  const robotDark = mat(0x1c5842, { metalness: .18, roughness: .48 });
  const robotLight = mat(0xf5faf4, { metalness: .1, roughness: .45 });
  const robotScreen = mat(0x90d0a3, { emissive: 0x2c7146, emissiveIntensity: .35 });
  addCylinder(robot, .27, .29, .36, robotDark, 0, .25, 0, 20);
  addCylinder(robot, .22, .25, .1, robotLight, 0, .49, 0, 20);
  addSphere(robot, .205, robotLight, 0, .71, 0, 20, 14);
  addBox(robot, .19, .11, .035, robotScreen, 0, .71, -.19);
  addSphere(robot, .045, robotDark, 0, .98, 0);
  addBox(robot, .36, .14, .3, robotDark, 0, .48, .26);
  const ring = new THREE.Mesh(new THREE.RingGeometry(.32, .38, 32), new THREE.MeshBasicMaterial({ color: 0xe5ac47, side: THREE.DoubleSide }));
  ring.rotation.x = -Math.PI / 2; ring.position.y = .014; robot.add(ring);
  const robotLabel = makeLabel("购物机器人", "#1c5b42", "#ffffff", .65);
  robotLabel.position.y = 1.28; robot.add(robotLabel);
  robot.scale.setScalar(1.18);
  robot.position.copy(floorPoint(STORE.entrance, 0));

  function makePerson(color) {
    const group = new THREE.Group();
    const shirt = mat(color), skin = mat(0xe8b793), trousers = mat(0x607267);
    addCylinder(group, .12, .17, .42, shirt, 0, .62, 0);
    addSphere(group, .13, skin, 0, .96, 0);
    addCylinder(group, .055, .05, .4, trousers, -.085, .21, 0);
    addCylinder(group, .055, .05, .4, trousers, .085, .21, 0);
    return group;
  }
  const people = Array.from({ length: 30 }, (_, i) => {
    const group = makePerson([0xc87857, 0xe0a26d, 0xa87c70, 0xb36a59][i % 4]);
    scene.add(group); return group;
  });
  const crowdZone = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 1.36), new THREE.MeshBasicMaterial({ color: 0xe9a279, transparent: true, opacity: .29, depthWrite: false, side: THREE.DoubleSide }));
  crowdZone.rotation.x = -Math.PI / 2;
  crowdZone.position.copy(floorPoint([70, 56], .017));
  scene.add(crowdZone);
  const cart = new THREE.Group(); scene.add(cart);
  addBox(cart, .47, .23, .34, mat(0xb67c5d), 0, .38, 0);
  for (const x of [-.18, .18]) for (const z of [-.13, .13]) addCylinder(cart, .045, .045, .05, darkFrame, x, .23, z, 10);

  const originalRoute = new THREE.Group(), plannedRoute = new THREE.Group(), traveledRoute = new THREE.Group();
  scene.add(originalRoute, plannedRoute, traveledRoute);
  let lastHistoryLength = 0, lastHistoryPoint = "";
  const clock = new THREE.Clock();
  const resize = () => {
    const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight);
    camera.aspect = width / height; camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  const observer = new ResizeObserver(resize); observer.observe(container); resize();
  function frame() {
    const time = clock.getElapsedTime();
    people.forEach((person, i) => { if (person.visible) person.position.y = Math.sin(time * 2 + i) * .015; });
    robot.position.y = Math.sin(time * 4) * .012;
    controls.update(); renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setRobot(point) {
      const next = floorPoint(point, 0), dx = next.x - robot.position.x, dz = next.z - robot.position.z;
      if (Math.hypot(dx, dz) > .003) robot.rotation.y = Math.atan2(-dx, -dz);
      robot.position.x = next.x; robot.position.z = next.z;
    },
    setScenario(scenario,slot="09") {
      const peak = scenario === "peak", positions = peopleForScenario(scenario,slot);
      heatTiles.forEach((tile,i)=>{const count=shelfCrowd(slot,shelves[i].id);tile.material.color.set(count>=5?0xe25d3b:count>=3?0xf2b34d:0x71b887);tile.material.opacity=count>=5?.48:count>=3?.34:.16;});
      people.forEach((person, i) => {
        person.visible = i < positions.length;
        if (person.visible) {
          const p = floorPoint(positions[i].point, 0); person.position.set(p.x, 0, p.z);
        }
      });
      crowdZone.visible = peak;
      const cp = floorPoint(peak ? [74, 58.5] : [106, 81], 0);
      cart.position.set(cp.x, 0, cp.z);
    },
    setRoutes(current, original) {
      disposeGroup(originalRoute); disposeGroup(plannedRoute);
      if (original?.length) originalRoute.add(ribbon(original, .14, 0xd28c63, .028, .8, true));
      if (current?.length) plannedRoute.add(ribbon(current, .15, 0x237d5a, .032));
    },
    setHistory(points) {
      const last = points.at(-1);
      const signature = last ? `${last[0].toFixed(2)},${last[1].toFixed(2)}` : "";
      if (lastHistoryLength === points.length && lastHistoryPoint === signature) return;
      if (points.length - lastHistoryLength < 5 && points.length > 1 && points.length !== 2) return;
      lastHistoryLength = points.length; lastHistoryPoint = signature;
      disposeGroup(traveledRoute);
      const sampled = points.filter((_, i) => i % 4 === 0 || i === points.length - 1);
      if (sampled.length > 1) traveledRoute.add(ribbon(sampled, .18, 0xe6a23d, .041));
    },
    setPickups,
    setBought(count) {
      markerObjects.forEach(({group,label},i)=>{
        group.children[0].material=i<count?markerMats.bought:markerMats.pending;
        group.remove(label); const replacement=makeLabel(i<count?"✓":String(i+1),"#ffffff","#276047",.42);
        replacement.position.y=.62; group.add(replacement); markerObjects[i].label=replacement;
      });
    },
    resetCamera() {
      camera.position.copy(startCamera); controls.target.set(0, .45, 0); controls.update();
    },
  };
}
