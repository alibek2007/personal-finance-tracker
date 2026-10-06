#!/bin/sh
# Applies database migrations, then starts whatever command the container was given.
#
# Set RUN_MIGRATIONS=false when migrations run as a separate release step (several API replicas,
# or a deploy pipeline that migrates first), so replicas do not race each other.
set -eu

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  echo "Applying database migrations..."
  node ../../node_modules/prisma/build/index.js migrate deploy --schema prisma/schema.prisma
fi

exec "$@"
