#!/usr/bin/env bash
set -euo pipefail

main() {
  local target='' install_dir="${TOKENPET_INSTALL_DIR:-$HOME/.local/share/tokenpet}" bin_dir="${TOKENPET_BIN_DIR:-$HOME/.local/bin}"
  case "${1:-}" in
    '') ;;
    --local) target=local; shift ;;
    --endpoint) [ "$#" -ge 2 ] || { echo '--endpoint 뒤에 도메인 또는 IP를 입력하세요.' >&2; return 1; }; target=$2; shift 2 ;;
    --help|-h) echo 'TokenPet 설치: install.sh [--local | --endpoint <도메인/IP[:포트]>]'; return ;;
    *) echo '사용법: install.sh [--local | --endpoint <도메인/IP[:포트]>]' >&2; return 1 ;;
  esac
  [ "$#" -eq 0 ] || { echo '알 수 없는 설치 인자입니다.' >&2; return 1; }
  local platform arch
  case "$(uname -s)" in Darwin) platform=darwin ;; Linux) platform=linux ;; *) echo 'macOS, Linux 또는 WSL에서 실행해 주세요.' >&2; return 1 ;; esac
  case "$(uname -m)" in arm64|aarch64) arch=arm64 ;; x86_64) arch=x64 ;; *) echo 'arm64 또는 x64 환경이 필요합니다.' >&2; return 1 ;; esac
  for command in curl tar; do command -v "$command" >/dev/null || { echo "$command 설치가 필요합니다." >&2; return 1; }; done
  mkdir -p "$install_dir/releases" "$bin_dir"
  install_dir=$(cd "$install_dir" && pwd); bin_dir=$(cd "$bin_dir" && pwd)
  local temporary
  temporary=$(mktemp -d "$install_dir/releases/install.XXXXXX")
  trap "$(printf 'rm -rf -- %q' "$temporary")" EXIT

  if ! command -v node >/dev/null || ! node -e 'process.exit(Number(process.versions.node.split(".")[0]) >= 24 ? 0 : 1)' 2>/dev/null; then
    echo 'Node.js 24를 TokenPet 전용 폴더에 설치합니다.'
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 https://nodejs.org/dist/latest-v24.x/SHASUMS256.txt -o "$temporary/SHASUMS256.txt"
    local archive version
    archive=$(awk -v suffix="-$platform-$arch.tar.gz" 'length($2) > length(suffix) && substr($2, length($2)-length(suffix)+1) == suffix { print $2 }' "$temporary/SHASUMS256.txt")
    [[ "$archive" =~ ^node-v24\.[0-9]+\.[0-9]+-(darwin|linux)-(arm64|x64)\.tar\.gz$ ]] || { echo 'Node.js 다운로드 정보를 확인하지 못했어요.' >&2; return 1; }
    version=${archive#node-}; version=${version%%-*}
    curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 "https://nodejs.org/dist/$version/$archive" -o "$temporary/$archive"
    (cd "$temporary"
      awk -v file="$archive" '$2 == file' SHASUMS256.txt > checksum.txt
      if command -v sha256sum >/dev/null; then sha256sum -c checksum.txt; else shasum -a 256 -c checksum.txt; fi
    )
    mkdir "$temporary/runtime"
    tar -xzf "$temporary/$archive" --strip-components=1 -C "$temporary/runtime"
    # Versioned runtimes keep earlier installs usable if a later update fails.
    if [ ! -d "$install_dir/$version" ]; then mv "$temporary/runtime" "$install_dir/$version"; fi
    export PATH="$install_dir/$version/bin:$PATH"
  fi
  command -v npm >/dev/null || { echo 'Node.js에 npm이 없어요. Node.js 24 이상을 다시 설치해 주세요.' >&2; return 1; }
  echo 'TokenPet을 다운로드합니다. Git이나 repository clone은 필요하지 않습니다.'
  curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 https://codeload.github.com/shariest/tokenpet/tar.gz/refs/tags/v1.0.1 -o "$temporary/source.tar.gz"
  mkdir "$temporary/app"
  tar -xzf "$temporary/source.tar.gz" --strip-components=1 -C "$temporary/app"
  (cd "$temporary/app" && npm ci --include=dev --ignore-scripts --no-audit --no-fund \
    && npm run build --if-present \
    && npm prune --omit=dev --ignore-scripts --no-audit --no-fund)

  node --input-type=module - "$install_dir" "$bin_dir" "$temporary/app" <<'NODE'
import { existsSync, readFileSync, writeFileSync, symlinkSync, renameSync, rmSync, lstatSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, bin, app] = process.argv.slice(2);
const shellModule = existsSync(join(app, 'dist/src/shell-install.js')) ? 'dist/src/shell-install.js' : 'src/shell-install.js';
const { shellQuote } = await import(pathToFileURL(join(app, shellModule)));
const command = join(bin, 'tokenpet'), marker = '# TokenPet launcher';
if (existsSync(command) && !readFileSync(command, 'utf8').includes(marker)) throw new Error(`기존 명령을 덮어쓸 수 없어요: ${command}`);
const current = join(root, 'current');
if (existsSync(current) && !lstatSync(current).isSymbolicLink()) throw new Error(`기존 폴더를 덮어쓸 수 없어요: ${current}`);
const release = app.replace(/\/app$/, '/installed');
renameSync(app, release);
const pending = join(root, `.current-${process.pid}`);
const variables = ['TOKENPET_DATA_DIR', 'NODE_EXTRA_CA_CERTS'].filter(key => process.env[key]).map(key => `${key}=${shellQuote(process.env[key])} `).join('');
const pendingCommand = `${command}.${process.pid}.tmp`;
try {
  symlinkSync(release, pending);
  writeFileSync(pendingCommand, `#!/bin/sh\n${marker}\n${variables}exec ${shellQuote(process.execPath)} ${shellQuote(join(current, 'bin/tokenpet.mjs'))} "$@"\n`, { mode: 0o755, flag: 'wx' });
  renameSync(pendingCommand, command);
  renameSync(pending, current);
} finally { rmSync(pending, { force: true }); rmSync(pendingCommand, { force: true }); }
NODE
  # The active release now lives here; never delete it if setup needs a retry.
  trap - EXIT
  rm -f "$temporary"/*.tar.gz "$temporary/SHASUMS256.txt" "$temporary/checksum.txt"
  rm -rf "$temporary/runtime"
  local profile profiles=()
  case ":$PATH:" in
    *":$bin_dir:"*) ;;
    *)
      if [ "$bin_dir" = "$HOME/.local/bin" ]; then
        case "${SHELL:-}" in
          */zsh) profiles=("${ZDOTDIR:-$HOME}/.zshrc") ;;
          */bash)
            profile="$HOME/.profile"
            if [ -f "$HOME/.bash_profile" ]; then profile="$HOME/.bash_profile"; elif [ -f "$HOME/.bash_login" ]; then profile="$HOME/.bash_login"; fi
            profiles=("$HOME/.bashrc" "$profile") ;;
          *) profiles=("$HOME/.profile") ;;
        esac
        for profile in "${profiles[@]}"; do
          if ! grep -Fq 'export PATH="$HOME/.local/bin:$PATH" # TokenPet' "$profile" 2>/dev/null; then
            printf '\n%s\n' 'export PATH="$HOME/.local/bin:$PATH" # TokenPet' >> "$profile"
          fi
        done
      fi
      ;;
  esac
  echo '설치 파일 준비 완료. CLI 연결을 설정합니다.'
  if [ -z "$target" ]; then
    # Setup asks before replacing existing files, so give it the terminal even when piped from curl.
    if (exec </dev/tty) 2>/dev/null; then "$bin_dir/tokenpet" setup </dev/tty; else "$bin_dir/tokenpet" setup; fi
  elif (exec </dev/tty) 2>/dev/null; then
    "$bin_dir/tokenpet" connect "$target" </dev/tty
  else
    "$bin_dir/tokenpet" connect "$target"
  fi
  echo "완료! 평소처럼 codex 또는 claude를 실행하세요. 관리 명령: $bin_dir/tokenpet help"
  echo '업데이트할 때도 같은 설치 명령을 실행하면 됩니다. 게임 데이터는 유지됩니다.'
}

main "$@"
