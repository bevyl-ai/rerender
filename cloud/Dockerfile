# remover cloud worker — an AWS Lambda container image that renders one frame-range
# segment to S3. Built per project (the project is baked in); deployed by `sam deploy`
# (see cloud/template.yaml). Container Lambda so we can ship chrome-headless-shell + the
# full remover runtime (vite/esbuild/puppeteer/mediabunny), which a zip layer can't hold.
#
#   build context is the repo root:  sam build  (uses cloud/Dockerfile)
#   override the project dir:         --build-arg PROJECT=./my-video
FROM public.ecr.aws/lambda/nodejs:20

# chrome-headless-shell's shared libraries (Amazon Linux 2023).
RUN dnf install -y \
      nss nspr atk at-spi2-atk at-spi2-core cups-libs libdrm libgbm mesa-libgbm \
      libxkbcommon libXcomposite libXdamage libXfixes libXrandr libXScrnSaver \
      alsa-lib pango cairo gtk3 \
    && dnf clean all

WORKDIR ${LAMBDA_TASK_ROOT}

# Runtime deps (puppeteer-core, vite, esbuild, mediabunny, @aws-sdk/*, tsx, …).
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# remover runtime: the renderer + the browser worker .ts files esbuild bundles at run
# time + the bin. tsx loads the TS directly (same as everywhere else in remover).
COPY tsconfig.json ./
COPY src ./src
COPY render ./render
COPY cloud ./cloud

# The user's project, baked in. REMOVER_ENTRY points the worker at its registerRoot.
ARG PROJECT=./project
COPY ${PROJECT} ./project
ENV REMOVER_ENTRY=${LAMBDA_TASK_ROOT}/project/src/index.ts

# chrome-headless-shell, pinned to the version remover renders with.
ENV REMOVER_CHROME=${LAMBDA_TASK_ROOT}/.chrome
RUN npx --yes @puppeteer/browsers install chrome-headless-shell@149.0.7790.0 --path ${REMOVER_CHROME}

# The AWS runtime interface client loads cloud/handler.mjs, which tsx-loads the TS handler.
CMD ["cloud/handler.handler"]
