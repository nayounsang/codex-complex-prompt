# Codex Complex Prompt

Codex CLI에서 `$complex-prompt`를 호출하면 브라우저에 Markdown 편집기를 열고, 입력한 명령을 Codex의 현재 turn에 전달합니다. AI Feedback을 제출하면 편집한 전체 Markdown을 바탕으로 Codex가 수정하고, Stop hook이 최신 응답을 새 브라우저 편집기에 다시 엽니다. Send Feedback으로 피드백을 반복하거나 Submit으로 검토를 끝내 최종 문서의 명령을 실행할 수 있습니다.

Codex에서 여러 맥락과 절차가 필요한 작업을 지시할 때 사용합니다. 피드백 검토 중에는 Send Feedback으로 수정을 반복하고, Submit으로 검토를 끝내 최종 문서의 명령을 실행합니다.

## Getting Started

### Install

```bash
# npm에서 CLI를 내려받아 Codex hook과 complex-prompt skill을 한 번 설치합니다.
npx @codex-complex-prompt/cli-bridge hook install

# Codex를 재시작해 새 skill과 hook을 로드합니다.
codex

# Codex 입력창에서 새 command hook을 검토하고 trust합니다.
/hooks

# Codex 입력창에서 브라우저 명령 편집기를 호출합니다.
$complex-prompt [입력(Optional)]
```

### (Optional) 환경 격리 필요시

`CODEX_HOME`은 Codex 설정을 저장하는 디렉터리를 가리키는 환경 변수입니다. 보통은 지정할 필요 없이 `~/.codex`를 사용합니다. 프로젝트별 설정을 사용하려면 Codex를 실행할 때까지 같은 셸에서 다음처럼 지정합니다.

```bash
# 현재 프로젝트 아래에 Codex 설정을 격리합니다.
export CODEX_HOME="$PWD/.codex"

# 격리된 hooks.json과 skill을 설치합니다.
npx @codex-complex-prompt/cli-bridge hook install

# 같은 프로젝트 설정을 읽는 Codex를 실행합니다.
CODEX_HOME="$PWD/.codex" codex
```

### Hook 명령

```bash
# 실제 파일을 바꾸지 않고 hooks.json과 설치 파일의 변경 내용을 확인합니다.
npx @codex-complex-prompt/cli-bridge hook install --dry-run

# UserPromptSubmit/Stop hook, skill, 호환용 prompt를 설치합니다.
npx @codex-complex-prompt/cli-bridge hook install

# package가 marker로 소유권을 기록한 항목만 제거합니다.
npx @codex-complex-prompt/cli-bridge hook remove
```

- `hook install`: `CODEX_HOME/hooks.json`에 `UserPromptSubmit`과 AI Feedback용 `Stop` command를 등록하고 `CODEX_HOME/skills/complex-prompt/SKILL.md`, `CODEX_HOME/prompts/complex-prompt.md`를 설치합니다. 기존 hooks(Plannotator 포함)와 사용자 파일은 보존합니다.
- `hook install --dry-run`: 파일을 쓰지 않고 변경될 JSON과 파일 내용을 출력합니다. 비대화형 환경에서 먼저 확인할 때 사용합니다.
- `hook remove`: 이 package의 marker가 있는 command, skill, prompt만 제거합니다. 다른 hook과 설정은 제거하지 않습니다.

## Development

### Local Development

```bash
# 준비
pnpm install
pnpm build

# 이후 명령에서 사용할 로컬 CLI 경로를 지정합니다.
CLI_BRIDGE="$(pwd)/apps/cli-bridge/dist/index.js"

# 실제 hooks.json을 바꾸기 전에 변경될 JSON을 확인합니다.
node "$CLI_BRIDGE" hook install --dry-run

# 로컬 Codex 설정에 UserPromptSubmit hook과 skill을 설치합니다.
node "$CLI_BRIDGE" hook install

# 공식 UserPromptSubmit 입력을 재현하고 브라우저 편집기를 엽니다.
printf '%s\n' '{"hook_event_name":"UserPromptSubmit","prompt":"$complex-prompt 로컬 명령"}' | node "$CLI_BRIDGE" hook prompt

# 로컬 설정에서 package가 설치한 항목만 제거합니다.
node "$CLI_BRIDGE" hook remove
```

### Scripts

```bash
# 전체 품질 검사를 실행합니다.
pnpm lint

# TypeScript 타입 검사를 실행합니다.
pnpm typecheck

# 모든 테스트를 실행합니다.
pnpm test

# coverage 기준을 포함해 테스트합니다.
pnpm test:coverage

# 배포용 CLI와 정적 web UI를 빌드합니다.
pnpm build

# 포맷 검사와 실제 npm tarball 설치 smoke test를 실행합니다.
pnpm format:check
pnpm package:smoke

# UI 확인
pnpm dev
```

### Workspace

- `apps/cli-bridge`: npm executable, loopback bridge, Codex UserPromptSubmit/Stop hook과 설정 관리
- `apps/web`: Markdown 편집기와 AI Feedback 검토 UI
- `packages/protocol`: CLI↔브라우저와 Codex hook JSON의 Zod schema
- `packages/server`: loopback HTTP/WebSocket 서버와 세션 정책
- `packages/core`: transport와 무관한 draft, 제출 이력, 실행 상태 모델

### Release

1. 기능 변경이 있을 시 `pnpm changeset`으로 changeset을 추가해주세요. 이 프로젝트는 [semver](https://semver.org/lang/ko/)를 따릅니다.
2. 작업 PR이 merge되면 changeset을 반영한 version PR이 생성됩니다.
3. version PR을 merge하면 릴리즈합니다.
