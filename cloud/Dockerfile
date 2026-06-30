# rerender cloud worker — an AWS Lambda container image that renders one frame-range
# segment to S3. Built per project (the project is baked in); built + deployed by
# `rerender cloud deploy` (docker build + `aws cloudformation deploy` against
# cloud/template.yaml, no SAM). Container Lambda so we can ship chrome-headless-shell + the
# full rerender runtime (vite/esbuild/puppeteer/mediabunny), which a zip layer can't hold.
#
#   build context is the repo root (deploy.ts runs `docker build -f cloud/Dockerfile .`)
#   the project dir is passed via   --build-arg PROJECT=<dir relative to repo root>
FROM public.ecr.aws/lambda/nodejs:20

# unzip/tar/findutils for the chrome-headless-shell download + chrome's shared
# libraries (Amazon Linux 2023). The base image is minimal — no unzip, no find. Fonts
# too: the base ships none, so any text (incl. `system-ui`) renders in a poor fallback.
RUN dnf install -y \
      unzip tar findutils \
      nss nspr atk at-spi2-atk at-spi2-core cups-libs libdrm libgbm mesa-libgbm \
      libxkbcommon libXcomposite libXdamage libXfixes libXrandr libXScrnSaver \
      alsa-lib pango cairo gtk3 \
      dejavu-sans-fonts dejavu-serif-fonts liberation-fonts google-noto-sans-fonts google-noto-emoji-fonts \
    && dnf clean all

WORKDIR ${LAMBDA_TASK_ROOT}

# rerender's renderer runtime (puppeteer-core, vite, @vitejs/plugin-react, esbuild,
# mediabunny, tsx) and the non-aliased packages compositions import (@remotion/google-
# fonts, @remotion/zod-types, zod, react) are all in dependencies, so a plain prod install.
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# rerender runtime: the renderer + the browser worker .ts files esbuild bundles at run
# time + the bin. tsx loads the TS directly (same as everywhere else in rerender).
COPY tsconfig.json ./
COPY src ./src
COPY render ./render
COPY cloud ./cloud

# chrome writes its config/cache/NSS under $HOME; the Lambda task root is read-only, so
# point HOME at the writable /tmp.
ENV HOME=/tmp

# The user's project, baked in. RERENDER_ENTRY points the worker at its registerRoot.
ARG PROJECT=./project
COPY ${PROJECT} ./project
ENV RERENDER_ENTRY=${LAMBDA_TASK_ROOT}/project/src/index.ts

# chrome-headless-shell, pinned to the version rerender renders with. Use rerender's own
# chromeExecutable() so build and runtime agree on the cache dir (node_modules/.rerender-
# chrome) and the binary is already present at invocation — no download in the Lambda.
# Chrome-for-Testing ships linux64 only — this image MUST be built for linux/amd64
# (--platform) and run as an x86_64 Lambda; arm64/Graviton can't execute the binary.
RUN node --import tsx -e "import('./render/browser.ts').then(m => m.chromeExecutable()).then(p => console.log('chrome installed:', p))"

# Pre-bake Vite's dep-optimizer cache for the baked project (optimizeDeps.entries scans
# the entry at server start), so a cold worker doesn't pay the ~4s optimize. handler.ts
# copies this into /tmp on cold start.
RUN RERENDER_VITE_CACHE=/var/task/.vite-cache-baked node --import tsx -e \
  "import('./src/renderer/bundle.ts').then(async m => { const b = await m.bundle(process.env.RERENDER_ENTRY); await new Promise(r => setTimeout(r, 5000)); await b.close(); process.exit(0); }).catch(e => { console.error(e); process.exit(1); })" \
  && echo "baked vite cache:" && ls /var/task/.vite-cache-baked 2>/dev/null || true

# The AWS runtime interface client loads cloud/handler.mjs, which tsx-loads the TS handler.
CMD ["cloud/handler.handler"]
