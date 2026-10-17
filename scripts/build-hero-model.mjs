// Turns the converter's model.glb into the landing page's hero model:
// elements grouped by discipline, decor dropped, heavy meshes simplified,
// a named clash pair kept separate, siblings joined, meshopt-compressed.
// usage: node build-hero.mjs <model.glb> <cat.json> <out.glb> [clashA clashB]
import { readFileSync } from 'node:fs';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { dedup, flatten, getBounds, join, prune, quantize, simplify, weld } from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';

const [src, catPath, out, clashA, clashB] = process.argv.slice(2);
const cat = JSON.parse(readFileSync(catPath, 'utf8'));

function group(cls, fam = '') {
  // The toposurface and the RPC trees (flat billboards) swamp the frame; the pad stands in for site works.
  if (cls === 'OdBmBuildingPad') return 'site';
  if (cls === 'OdBmSiteSurface' || fam.startsWith('RPC ') || fam.startsWith('M_RPC') || /Water Glass|Plate|Wine|Vase|vase|TV|Bar Chair/.test(fam)) return null;
  if (cls === 'OdBmCurveElem') return null;
  if (cls === 'OdBmFloor' || cls === 'OdBmStairsElement' || /Pile Cap|Column/.test(fam)) return 'structure';
  if (/Lighting|Trck_|Photovoltaic|Wind Power|Tankworks|Lavatory|Double-Flush|Bathtub|Faucet|Sink|Shower|Walvit|Miele|hood enclosure/.test(fam)) return 'mep';
  if (/Chair|Sofa|Table|Seat|wardrobe|Cabinet|Kitchen Island|fire place/.test(fam)) return 'interior';
  return 'architecture';
}
const GROUPS = ['site', 'structure', 'architecture', 'mep', 'interior'];

await MeshoptEncoder.ready;
await MeshoptSimplifier.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.encoder': MeshoptEncoder });
const doc = await io.read(src);
await doc.transform(flatten());

const scene = doc.getRoot().getDefaultScene();
const parents = Object.fromEntries(GROUPS.map((g) => {
  const n = doc.createNode(g).setExtras({ group: g });
  scene.addChild(n);
  return [g, n];
}));

const members = Object.fromEntries(GROUPS.map((g) => [g, []]));
for (const node of doc.getRoot().listNodes()) {
  const e = node.getExtras();
  if (!e.revitClass) continue;
  const path = cat[e.handle];
  const g = group(e.revitClass, path && path.length > 2 ? path[2] : '');
  if (!g) { node.dispose(); continue; }
  scene.removeChild(node);
  parents[g].addChild(node);
  members[g].push({ node, handle: e.handle, fam: path?.[2] ?? e.revitClass });
}

if (!clashA) {
  // Candidate clash pairs: MEP elements whose box overlaps a structure/architecture element.
  const box = (n) => getBounds(n);
  const vol = (a, b) => [0, 1, 2].reduce((v, i) => v * Math.max(0, Math.min(a.max[i], b.max[i]) - Math.max(a.min[i], b.min[i])), 1);
  const hard = [...members.structure, ...members.architecture].map((m) => ({ ...m, b: box(m.node) }));
  const found = [];
  for (const m of members.mep) {
    const b = box(m.node);
    for (const h of hard) {
      const v = vol(b, h.b);
      if (v > 0.001) found.push({ v: +v.toFixed(3), mep: `${m.handle} ${m.fam}`, hit: `${h.handle} ${h.fam}` });
    }
  }
  found.sort((a, b) => b.v - a.v);
  console.log(JSON.stringify(found.slice(0, 25), null, 1));
}

for (const [g, list] of Object.entries(members)) {
  for (const { node, handle } of list) {
    if (handle === clashA || handle === clashB) node.setName(handle === clashA ? 'clash-a' : 'clash-b');
  }
}
// Fewer nodes means less per-node work for join; extras other than names are not needed at runtime.
for (const n of doc.getRoot().listNodes()) if (n.getExtras().revitClass) n.setExtras({});

await doc.transform(
  dedup(),
  weld(),
  simplify({ simplifier: MeshoptSimplifier, ratio: 0.35, error: 0.0008, lockBorder: true }),
  join({ keepNamed: true }),
  prune(),
  quantize(),
);
doc.createExtension(EXTMeshoptCompression).setRequired(true).setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
await io.write(out, doc);

const stats = Object.fromEntries(GROUPS.map((g) => [g, parents[g].listChildren().length]));
const b = getBounds(scene);
console.error(JSON.stringify({ out, nodes: stats, bounds: b }));
