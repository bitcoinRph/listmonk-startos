FROM node:22.22.0-bookworm-slim@sha256:dd9d21971ec4395903fa6143c2b9267d048ae01ca6d3ea96f16cb30df6187d94

ENV NODE_ENV=production
WORKDIR /opt/listmonk-mcp

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts \
    && npm cache clean --force

COPY provision.mjs run.mjs ./

USER node

EXPOSE 3000
ENTRYPOINT ["node", "run.mjs"]
