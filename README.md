# Codex Complex Prompt

Codex CLI 사용중 브라우저 에디터에서 복잡한 prompt를 작성하는 loopback CLI입니다.
지원 환경은 Node.js 24 LTS 이상, macOS/Linux/WSL입니다.

## Getting Started

### Install

```bash
# CODEX_HOME/hooks.json과 prompt 파일을 변경해 적용
npx @codex-complex-prompt/cli-bridge hook install

# 설치된 prompt를 Codex가 다시 읽도록 재시작해 Codex CLI 세션 시작
codex

# (최초 실행시) 새 Stop hook을 실행하기 전에 검토
/hooks

# 슬래시 커맨드 사용
/complex-prompt [요청]
```

### Hook 명령의 의미

```bash
# 설치 전에 변경될 설정과 prompt 내용을 확인합니다.
npx @codex-complex-prompt/cli-bridge hook install --dry-run

# Codex 설정에 package 소유 Stop hook과 /complex-prompt prompt를 등록합니다.
npx @codex-complex-prompt/cli-bridge hook install

# package가 추가한 Stop hook과 /complex-prompt prompt만 제거합니다.
npx @codex-complex-prompt/cli-bridge hook remove
```

- `hook install`: `CODEX_HOME/hooks.json`에 package 소유 Stop command를 추가하고, `CODEX_HOME/prompts/complex-prompt.md`에 `/complex-prompt` prompt를 설치합니다. `CODEX_HOME`이 없으면 `~/.codex`를 사용하며, 기존 `hooks`와 사용자 소유 prompt는 보존하고 package가 추가한 항목은 marker로 추적합니다.
- `hook install --dry-run`: 파일을 변경하지 않고 설치 후의 JSON을 stdout에 출력합니다. 비대화형 환경이나 CI에서 실제 변경 전에 검토할 때 사용합니다.
- `hook remove`: marker 또는 package command로 식별되는 package 소유 Stop command와 package marker가 있는 `/complex-prompt` prompt만 제거합니다. 사용자가 추가한 다른 hook·prompt와 나머지 설정은 보존합니다.

### Stop hook 입력과 review 결과

- Stop hook은 공식 Codex command-hook JSON 계약의 `last_assistant_message`를 review content로 사용합니다. `plan`, `response`, `output`이 함께 있으면 plan을 우선하고, 나머지는 fallback으로 사용합니다.
- 브라우저에서 Approve를 누르면 `{ "continue": true }`를 반환하고, Reject 또는 feedback은 `decision: "block"`과 continuation reason으로 반환합니다.

### Stop hook 오류 처리

- 빈 입력, malformed JSON, browser 실패, timeout, 취소는 Codex turn을 막지 않고 JSON `systemMessage`로 보고합니다.
- Codex가 이미 hook을 계속 진행한 상태(`stop_hook_active`)라면 브라우저 review를 다시 열지 않습니다.

## Development

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm format:check
```

`pnpm build`는 web 정적 결과를 CLI package 안에 복사하고, CLI와 local server/protocol을 하나의 실행 bundle로 컴파일합니다. 따라서 npm 설치본은 workspace package에 의존하지 않고 자체 web UI를 제공합니다.

tarball을 실제 외부 설치 경로에서 검증하려면 다음을 실행합니다.

```bash
pnpm package:smoke
pnpm --dir apps/cli-bridge exec npm pack --dry-run --ignore-scripts
```

### Workspace

- `apps/cli-bridge`: npm executable, loopback bridge, Codex Stop hook adapter와 hooks.json 관리
- `apps/web`: prompt editor와 response review UI
- `packages/protocol`: CLI↔브라우저 메시지의 Zod schema
- `packages/server`: loopback HTTP/WebSocket 서버와 세션 정책
- `packages/core`: transport와 무관한 draft, 제출 이력, 실행 상태 모델

### 로컬에서 실행

저장소에서 실제 동작을 확인하려면 다음처럼 실행합니다.

```bash
# 준비
pnpm install
pnpm build

# 이후 명령에서 사용할 로컬 CLI 실행 파일의 절대 경로를 지정
CLI_BRIDGE="$(pwd)/apps/cli-bridge/dist/index.js"

# 설치될 hooks.json과 /complex-prompt prompt를 확인
node "$CLI_BRIDGE" hook install --dry-run

# 로컬 Codex hooks.json과 /complex-prompt prompt를 설치
node "$CLI_BRIDGE" hook install

# 실제 Codex Stop event를 stdin으로 보내 브라우저 review를 시작
printf '%s\n' '{"hook_event_name":"Stop","last_assistant_message":"로컬에서 검토할 계획입니다."}' \
  | node "$CLI_BRIDGE" hook stop

# 로컬 테스트가 끝나면 package 소유 Stop hook과 prompt만 제거
node "$CLI_BRIDGE" hook remove
```

실제 Codex slash command까지 확인하려면 설치 단계에서 `hook remove`를 실행하기 전에 별도 터미널에서 다음을 실행합니다.

```bash
# Codex를 실행합니다.
codex

# Codex 입력창에서 다음 prompt를 입력합니다.
# /complex-prompt 브라우저에서 검토할 계획을 작성해줘
```

### Release

공개 배포 대상은 `@codex-complex-prompt/cli-bridge` 하나입니다. Changesets 파일을 추가하고 상태를 확인하면 GitHub Actions가 version PR을 만듭니다.

```bash
pnpm changeset
pnpm changeset:status
```
