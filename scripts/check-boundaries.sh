#!/usr/bin/env bash

set -euo pipefail

check_disallowed_import() {
  local pattern="$1"
  local search_path="$2"
  local message="$3"

  if grep -R -n \
    --include='*.ts' \
    --include='*.tsx' \
    --include='*.mts' \
    --include='*.cts' \
    "$pattern" \
    "$search_path"
  then
    printf '%s\n' "$message" >&2
    exit 1
  fi
}

if grep -R -n \
  --include='*.ts' \
  --include='*.tsx' \
  --include='*.mts' \
  --include='*.cts' \
  "@the-hive/" \
  "packages/cli/src" | grep -E -v "@the-hive/protocol/wire['\"]"
then
  printf '%s\n' "ERROR: cli must only import from @the-hive/protocol/wire" >&2
  exit 1
fi

for package_dir in packages/*; do
  package_name="$(basename "$package_dir")"
  source_dir="$package_dir/src"

  if [ ! -d "$source_dir" ]; then
    continue
  fi

  if [ "$package_name" != "server" ]; then
    check_disallowed_import \
      "@the-hive/server" \
      "$source_dir" \
      "ERROR: packages/$package_name imports @the-hive/server"
  fi

  if [ "$package_name" != "providers" ]; then
    check_disallowed_import \
      "@mariozechner/pi-ai" \
      "$source_dir" \
      "ERROR: only packages/providers may import @mariozechner/pi-ai"
  fi

  if [ "$package_name" != "storage" ]; then
    check_disallowed_import \
      "bun:sqlite" \
      "$source_dir" \
      "ERROR: only packages/storage may import bun:sqlite"
  fi
done

printf 'Boundary checks passed.\n'
