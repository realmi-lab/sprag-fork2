#!/bin/sh
# Claude Code에 읽기 전용 서브에이전트 long-reader 를 설치합니다.
#   ./install.sh                    모든 프로젝트에 (~/.claude/agents/long-reader.md)
#   ./install.sh --project DIR      그 프로젝트에만 (DIR/.claude/agents/long-reader.md)
#   ./install.sh --model sonnet     Haiku 대신 Sonnet 으로 (절감 폭은 줄어듭니다)
#   ./install.sh --with-claude-md   CLAUDE.md 에 "긴 읽기는 long-reader에게" 지침도 넣기
# 같은 이름의 에이전트 파일이 있으면 .bak 으로 남기고 바꿉니다. 지울 때는 ./uninstall.sh 를 같은 --project 로 실행합니다.
set -eu

here=$(cd "$(dirname "$0")" && pwd)
target="$HOME/.claude"
md="$HOME/.claude/CLAUDE.md"
model=haiku
with_md=0

while [ $# -gt 0 ]; do
  case "$1" in
    --project)
      [ $# -ge 2 ] || { echo "--project 뒤에 프로젝트 폴더를 적으십시오." >&2; exit 2; }
      [ -d "$2" ] || { echo "폴더가 없습니다: $2" >&2; exit 2; }
      target="$2/.claude"; md="$2/CLAUDE.md"; shift 2 ;;
    --model)
      [ $# -ge 2 ] || { echo "--model 뒤에 haiku 나 sonnet 을 적으십시오." >&2; exit 2; }
      model="$2"; shift 2 ;;
    --with-claude-md) with_md=1; shift ;;
    -h|--help) sed -n '2,7p' "$0"; exit 0 ;;
    *) echo "알 수 없는 옵션입니다: $1 (도움말: ./install.sh --help)" >&2; exit 2 ;;
  esac
done

case "$model" in
  haiku|sonnet) ;;
  *) echo "--model 은 haiku 나 sonnet 만 됩니다." >&2; exit 2 ;;
esac

mkdir -p "$target/agents"
dest="$target/agents/long-reader.md"
[ -f "$dest" ] && cp "$dest" "$dest.bak"
sed "s/^model: haiku\$/model: $model/" "$here/agents/long-reader.md" > "$dest.tmp"
mv "$dest.tmp" "$dest"
echo "에이전트 설치: $dest (model: $model)"

if [ "$with_md" = 1 ]; then
  if [ -f "$md" ] && grep -q '<!-- long-reader:begin -->' "$md"; then
    echo "CLAUDE.md 지침은 이미 있습니다: $md"
  else
    if [ -s "$md" ]; then printf '\n' >> "$md"; fi
    cat "$here/claude-md-snippet.md" >> "$md"
    echo "CLAUDE.md 지침 추가: $md"
  fi
fi

echo "새로 여는 Claude Code 세션부터 적용됩니다."
