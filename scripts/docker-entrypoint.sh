#!/bin/sh
set -eu
# Only initialize the mounted data directory as root, then drop privileges.
# Never recursively chown arbitrary application paths from an environment value.
if [ "$(id -u)" = '0' ]; then
  mkdir -p /var/data
  chown node:node /var/data
  chmod 700 /var/data
  exec setpriv --reuid=1000 --regid=1000 --init-groups "$@"
fi
exec "$@"
