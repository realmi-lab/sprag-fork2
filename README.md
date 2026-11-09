# long-reader

**Claude Code에서 긴 읽기를 Haiku에 맡기는 서브에이전트 하나.**

*A single read-only Claude Code subagent that hands long reads to Haiku and brings back only the summary. Install it and Opus delegates on its own.*

여러 파일을 통째로 읽기, 저장소 전체에서 찾기, 긴 로그 훑기는 Opus가 직접 하면 읽은 내용이 대화에 그대로 쌓입니다. 이후 대화할 때마다 그 내용을 다시 읽느라 비용이 듭니다. 이 에이전트를 깔아 두면 Opus가 그런 일을 싼 Haiku에 넘기고, 돌아온 요약만 대화에 남깁니다.

설치하는 것은 에이전트 정의 파일 하나(`agents/long-reader.md`)뿐입니다. 훅, 상태줄, 상시 실행되는 프로그램은 없습니다.

## 실측

같은 요청("lib/commands에서 a~e로 시작하는 파일 20개를 읽고 한 줄씩 정리해줘")을 새 세션에서 Opus 5.5로 실행했습니다. 대상은 npm `lib` 사본입니다.

| 설정 | 비용 | 걸린 시간 | 20개 모두 정리 |
|---|---|---|---|
| 에이전트 없음 | $0.516 | 44초 | ✓ |
| **에이전트만 설치** | **$0.150 (−71%)** | 73초 | ✓ |
| 에이전트 + CLAUDE.md 지침 한 줄 | $0.139 (−73%) | 57초 | ✓ |

- **요청에 에이전트 이름을 적지 않아도 됩니다.** 두 경우 모두 Opus가 알아서 넘겼습니다.
- **긴 세션일수록 더 아낍니다.** 컨텍스트가 약 27만 토큰인 세션에서 잰 결과입니다.
  - 파일 20개 읽기: 62~77%
  - 작은 grep 조회: 32~35%. Opus가 호출을 한 번 더 써서 생긴 차이이고, 보통은 본전에 가깝습니다.
- **대신 조금 느려집니다.** 하위 에이전트가 따로 시작하기 때문입니다.
- **수치의 한계:** 조건마다 한 번씩만 잰 값이고, Claude Code가 계산한 정가 환산입니다. 구독 요금제에서는 돈이 아니라 사용 한도가 덜 줄어듭니다.

## 설치

```bash
git clone https://github.com/realmi-lab/sprag-fork2
```

```bash
cd sprag-fork2 && ./install.sh
```

새로 여는 Claude Code 세션부터 적용됩니다.

| 명령 | 하는 일 |
|---|---|
| `./install.sh` | 모든 프로젝트에 설치 (`~/.claude/agents/long-reader.md`) |
| `./install.sh --project DIR` | 그 프로젝트에만 설치 (`DIR/.claude/agents/`) |
| `./install.sh --model sonnet` | Haiku 대신 Sonnet 사용 (아래 표 참고) |
| `./install.sh --with-claude-md` | CLAUDE.md에 "긴 읽기는 long-reader에게" 지침도 추가 (선택) |
| `./uninstall.sh [--project DIR]` | 설치한 에이전트와 지침을 지움 |

같은 이름의 파일이 이미 있으면 `.bak`으로 남기고 바꿉니다.

**스크립트 없이 설치하려면** `agents/long-reader.md`를 `~/.claude/agents/`(모든 프로젝트) 또는 프로젝트의 `.claude/agents/`에 복사하면 됩니다. Windows도 같습니다.

## Haiku냐 Sonnet이냐

기본은 Haiku입니다. 긴 세션에서 잰 같은 작업을 모델 가격만 바꿔 다시 계산했습니다(이후 대화 효과 제외).

| 하위 모델 | 파일 20개 읽기 | 작은 조회 |
|---|---|---|
| Haiku 5.5 | 62% 절감 | 32% 절감 |
| Haiku 4.5 | 47% 절감 | 12% 절감 |
| Sonnet 5.5 | 25% 절감 | 9% 손해 |

Sonnet 5.5는 캐시를 다시 읽는 요금이 Opus 5.5와 같아서 덜 아낍니다. Haiku가 자주 빠뜨리는 일이 있을 때만 `--model sonnet`을 쓰십시오.

## 잘 맞는 일과 안 맞는 일

| 맡기면 좋은 일 | 직접 하는 게 나은 일 |
|---|---|
| 파일 여러 개를 읽고 요약 | 명령 한두 번으로 끝나는 조회 (버전 확인 등) |
| 저장소 전체에서 호출 위치·문자열 찾기 | 설계, 원인 진단, 코드 리뷰처럼 판단이 결론인 일 |
| 긴 로그·테스트 출력에서 실패만 추리기 | 파일 수정 |

에이전트 설명에 이 기준이 들어 있어서, Opus가 대부분 알아서 고릅니다. 실측에서도 짧은 일은 넘기지 않았습니다.

## 에이전트가 하는 일

[`agents/long-reader.md`](agents/long-reader.md) 한 장에 다음 원칙이 적혀 있습니다.
- **읽기만 합니다.** 쓰기 도구가 없습니다. Bash는 읽기 명령과, 결과를 확인하라고 받은 테스트·빌드 명령에만 씁니다.
- **빠뜨리지 않습니다.** 대상 목록을 명령으로 먼저 확정합니다. 개수는 머리로 세지 않고 `wc`·`grep -c`로 셉니다. 실측에서 Haiku가 파일 이름을 추측하다 2개를 빠뜨리고, 합계를 틀리게 적은 일이 있어서 넣은 규칙입니다.
- **보고 형식이 정해져 있습니다.** 범위(N개 중 N개), 결과(`파일:줄`), 못 본 것 순서로 보고합니다.
- **비밀값을 다루지 않습니다.** `.env`와 자격 증명 파일은 열지 않습니다.

한계도 있습니다. 쓰기 도구는 없지만 Bash가 있으므로, "읽기 명령만 쓴다"는 에이전트 지침으로만 지켜집니다. 사용자 설정이 Bash를 전부 허용한다면 이 점을 알고 쓰십시오.

## sprag와의 관계

이 저장소는 [rootstudioyaml/sprag](https://github.com/rootstudioyaml/sprag) 포크로 시작했습니다. 검토하고 실측해 보니, sprag가 비용을 아끼는 핵심은 "긴 읽기를 싼 하위 에이전트에 넘기기" 하나였습니다. 그리고 그 효과는 에이전트 파일 하나로 거의 그대로 얻을 수 있었습니다. 실측에서 sprag는 같은 대화에서 19%를 아꼈습니다.

sprag에는 이 저장소에 없는 기능도 있습니다.
- 캐시·컨텍스트·한도를 보여 주는 상태줄
- 문서(pptx·xlsx·pdf·docx) 변환
- 반복 실수를 룰로 남기는 기능
- 팀 대시보드
- Codex 지원

이런 기능이 필요하면 sprag를 쓰십시오. 다만 리뷰에서 확인한 문제가 있습니다. 절감 장부를 실제보다 크게 기록하고, 자동 등록한 룰을 "사용자가 승인했다"고 모델에 알리며, 팀 룰에 서명이 없습니다.

이 문제들을 고친 sprag 수정본은 [`review-fixes-2026-11` 브랜치](https://github.com/realmi-lab/sprag-fork2/tree/review-fixes-2026-11)와 [PR #1](https://github.com/realmi-lab/sprag-fork2/pull/1)에 있습니다.

이 프로젝트는 [sprag](https://github.com/rootstudioyaml/sprag)에서 착안했습니다. "긴 읽기를 싼 하위 에이전트에 넘긴다"는 아이디어를 sprag에서 얻어, 에이전트 파일 하나로 다시 만든 것입니다.

## 라이선스

Apache License 2.0. [LICENSE](LICENSE)와 [NOTICE](NOTICE)를 보십시오.
