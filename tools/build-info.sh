#!/bin/sh
# Vercel, сборка: ветка и короткий хеш коммита деплоя → host/build.js (подпись в левом верхнем углу на ветках, кроме main)
printf "export const BUILD = { ref: '%s', sha: '%s' };\n" "$VERCEL_GIT_COMMIT_REF" "$(printf %s "$VERCEL_GIT_COMMIT_SHA" | cut -c1-7)" > host/build.js
