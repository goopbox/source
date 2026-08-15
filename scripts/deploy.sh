#!/usr/bin/env bash
set -euo pipefail

npm run build

git -C dist init
git -C dist add --all
git -C dist commit -m "Deploy goopbox"
git -C dist push --force https://github.com/goopbox/goopbox.github.io HEAD:main
