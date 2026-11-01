# The container image behind the SANDBOX Durable Object (Phase 8).
#
# The tag must match the @cloudflare/sandbox version in package.json. This is
# NOT referenced by wrangler.jsonc until the Phase 14 cutover (see DEPLOY.md), so
# building or testing the app never needs Docker.
FROM docker.io/cloudflare/sandbox:0.12.9

# The system prompt tells the model Python 3 and Node.js are installed. The base
# image is expected to ship them; this only installs what is missing.
RUN command -v python3 >/dev/null 2>&1 && command -v node >/dev/null 2>&1 \
  || (apt-get update \
      && apt-get install -y --no-install-recommends python3 python3-pip nodejs npm \
      && rm -rf /var/lib/apt/lists/*)
