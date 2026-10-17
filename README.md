# Bina Cloud marketing site

Astro (static output) + Tailwind v4. Planned: three.js, GSAP ScrollTrigger and Lenis for the 3D scroll hero.

```bash
nvm use          # Node 26 (.nvmrc); Node 22 also works
npm ci
npm run dev      # http://localhost:4321
npm run build    # writes dist/
npx astro check
```

Pages are emitted as `about-us.html` etc. (`build.format: 'file'`), so the clean-URL rules in
`public/.htaccess` (which ships in `dist/`) keep working.

Before launch: replace the placeholder GA4 ID in `src/config.ts`.

## Deploy

CI: the `Jenkinsfile` builds on every branch and, on `master`, rsyncs `dist/` to the Apache web root over
SSH. Set the `DEPLOY_HOST`, `DEPLOY_USER` and `DEPLOY_PATH` job parameters and create an SSH key credential
with id `bina-landing-deploy`. The `master` gate needs a multibranch pipeline job.
`rsync --delete` removes anything on the server that is not in `dist/` (except `.well-known`).

Manual fallback: run `npm ci && npm run build` locally, then upload the contents of `dist/` to the web root
(include the hidden `.htaccess`).

## Hero 3D model

`src/assets/models/hero.glb` is the scroll story's model (Autodesk's Revit sample project), built in three steps with the local `bim-converter` Docker image:

```sh
# 1. RVT -> .vsfx (stage the model as in/input.rvt; the engine skips names with spaces or underscores)
docker run --rm -v "$PWD/in:/in:ro" -v "$PWD/out:/out" -e BCV_RVT_DETAIL=3 bim-converter:sheets-glb \
  /opt/converter/bin/BimConvert -id /in -od /out -RVT
# 2. .vsfx -> plain GLB, and the element metadata (for each element's family name)
docker run --rm -v "$PWD/out:/out" -w /opt/glb-export bim-converter:sheets-glb \
  node glb-export.mjs --revit --no-draco --no-edges --encoding= /out/input.rvt.vsfx /out/model.glb
docker run --rm -v "$PWD/in:/in:ro" -v "$PWD/out:/out" -e LD_LIBRARY_PATH=/opt/converter/sdk/bin/lnxX64_14dll \
  bim-converter:sheets-glb /opt/converter/sdk/bin/lnxX64_14dll/BmJsonExportEx /in/input.rvt /out/meta.json
# 3. group by discipline, drop decor, simplify, compress (needs @gltf-transform/{core,extensions,functions} and meshoptimizer)
node scripts/build-hero-model.mjs out/model.glb out/cat.json src/assets/models/hero.glb <clash-a handle> <clash-b handle>
```

`cat.json` maps each element handle to its path in `meta.json` (category, family):
`python3 scripts/hero-categories.py out/meta.json out/cat.json`, run between steps 2 and 3.
Run step 3 without the two handles to list candidate clash pairs (the current pair is `778420 493790`).
The scene (`src/scene/heroScene.ts`) expects the groups `site`, `structure`, `architecture`, `mep`, `interior`
and the clash pair named `clash-a` / `clash-b`.
