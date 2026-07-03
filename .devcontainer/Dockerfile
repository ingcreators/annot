# Node.js 24 (active LTS) matches the root .nvmrc.
FROM mcr.microsoft.com/devcontainers/javascript-node:4-24-bookworm

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

USER root

RUN apt-get update \
    && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    jq \
    ripgrep \
    unzip \
    zip \
    && rm -rf /var/lib/apt/lists/*

# pnpm major must match the root package.json "packageManager" pin.
RUN npm install -g pnpm@11

USER node

WORKDIR /workspace/annot
