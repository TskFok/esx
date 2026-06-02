#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "仅支持在 macOS 上生成 DMG。"
  exit 1
fi

read_tauri_value() {
  local key="$1"
  node --input-type=module -e "import config from './src-tauri/tauri.conf.json' with { type: 'json' }; process.stdout.write(String(config['${key}'] ?? ''));"
}

PRODUCT_NAME="${PRODUCT_NAME:-$(read_tauri_value productName)}"
VERSION="${VERSION:-$(read_tauri_value version)}"
APP_PATH="${APP_PATH:-$ROOT_DIR/src-tauri/target/release/bundle/macos/${PRODUCT_NAME}.app}"
OUT_DIR="${OUT_DIR:-$ROOT_DIR/build}"
DMG_PATH="${DMG_PATH:-$OUT_DIR/${PRODUCT_NAME}-${VERSION}.dmg}"
OPEN_DMG_AFTER_BUILD="${OPEN_DMG_AFTER_BUILD:-1}"

if [[ ! -d "$APP_PATH" ]]; then
  echo "未找到应用包：$APP_PATH"
  echo "请先运行 pnpm tauri build 生成 macOS .app。"
  exit 1
fi

mkdir -p "$OUT_DIR"
STAGE_DIR="$(mktemp -d "$OUT_DIR/dmg-stage.XXXXXX")"
trap 'rm -rf "$STAGE_DIR"' EXIT

ditto "$APP_PATH" "$STAGE_DIR/${PRODUCT_NAME}.app"
ln -s /Applications "$STAGE_DIR/Applications"
rm -f "$DMG_PATH"

hdiutil create \
  -volname "$PRODUCT_NAME" \
  -srcfolder "$STAGE_DIR" \
  -ov \
  -format UDZO \
  "$DMG_PATH"

echo "DMG 已生成：$DMG_PATH"

if [[ "$OPEN_DMG_AFTER_BUILD" == "1" ]]; then
  open "$DMG_PATH"
  echo "已打开安装界面。"
fi
