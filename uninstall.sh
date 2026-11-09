#!/bin/sh
# install.sh 가 넣은 long-reader 에이전트와 CLAUDE.md 지침을 지웁니다.
#   ./uninstall.sh                  모든 프로젝트용 설치를 지움
#   ./uninstall.sh --project DIR    그 프로젝트에 한 설치를 지움
set -eu

target="$HOME/.claude"
md="$HOME/.claude/CLAUDE.md"

while [ $# -gt 0 ]; do
  case "$1" in
    --project)
      [ $# -ge 2 ] || { echo "--project 뒤에 프로젝트 폴더를 적으십시오." >&2; exit 2; }
      target="$2/.claude"; md="$2/CLAUDE.md"; shift 2 ;;
    -h|--help) sed -n '2,4p' "$0"; exit 0 ;;
    *) echo "알 수 없는 옵션입니다: $1" >&2; exit 2 ;;
  esac
done

dest="$target/agents/long-reader.md"
if [ -f "$dest" ]; then
  rm -f "$dest"
  echo "에이전트 삭제: $dest"
else
  echo "설치된 에이전트가 없습니다: $dest"
fi

if [ -f "$md" ] && grep -q '<!-- long-reader:begin -->' "$md"; then
  awk '/<!-- long-reader:begin -->/{skip=1} !skip{print} /<!-- long-reader:end -->/{skip=0}' "$md" > "$md.tmp"
  mv "$md.tmp" "$md"
  echo "CLAUDE.md 지침 삭제: $md"
fi
