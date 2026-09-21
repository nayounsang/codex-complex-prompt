# @codex-complex-prompt/cli-bridge

복잡한 prompt를 브라우저에서 작성하거나 Codex의 마지막 응답을 Stop hook으로 review하는 loopback CLI입니다.

### Install

```bash
# npx가 CLI package를 내려받아 hook과 /complex-prompt prompt를 등록합니다.
npx @codex-complex-prompt/cli-bridge hook install --dry-run

# 실제로 CODEX_HOME/hooks.json과 prompt 파일을 변경합니다.
npx @codex-complex-prompt/cli-bridge hook install

# 설치된 prompt를 Codex가 다시 읽도록 재시작합니다.
codex
```

첫 번째 `npx` 실행에서 package를 내려받고 hook과 prompt 설치까지 진행합니다. 설치 결과는 `CODEX_HOME`에 남으므로 이후에는 별도의 설치 명령 없이 Codex를 실행하면 됩니다. 설치 대상은 `CODEX_HOME/hooks.json`과 `CODEX_HOME/prompts/complex-prompt.md`이며, `CODEX_HOME`을 지정하지 않으면 각각 `~/.codex/hooks.json`과 `~/.codex/prompts/complex-prompt.md`를 사용합니다. Codex 입력창에서 `/hooks`를 실행하고 `Codex Complex Prompt browser review` hook을 검토·trust한 뒤, `/complex-prompt [요청]`을 입력하면 됩니다. 요청 처리가 끝나면 Stop hook이 브라우저 review를 자동으로 엽니다.

### Hook 명령의 의미

```bash
# 설치 전에 변경될 설정과 prompt 내용을 확인합니다.
npx @codex-complex-prompt/cli-bridge hook install --dry-run

# Codex 설정에 package 소유 Stop hook을 등록합니다.
npx @codex-complex-prompt/cli-bridge hook install

# package 소유 Stop hook만 제거합니다.
npx @codex-complex-prompt/cli-bridge hook remove
```

`hook install`은 `CODEX_HOME/hooks.json`에 package 소유 Stop command를 추가하고 `CODEX_HOME/prompts/complex-prompt.md`에 `/complex-prompt` prompt를 설치합니다. `CODEX_HOME`이 없으면 `~/.codex`를 사용하며, 기존 hook과 사용자 소유 prompt는 보존합니다. `hook install --dry-run`은 파일을 변경하지 않고 변경될 hook JSON과 prompt 내용을 stdout에 출력합니다. `hook remove`는 package marker가 있는 Stop command와 prompt만 제거합니다.

### 로컬에서 실행

저장소에서 실제 Stop hook 입력을 재현하려면 다음을 실행합니다.

```bash
# 로컬 workspace 의존성을 설치합니다.
pnpm install

# CLI와 브라우저 UI를 빌드합니다.
pnpm build

# 이후 명령에서 사용할 로컬 CLI 실행 파일의 절대 경로를 지정합니다.
CLI_BRIDGE="$(pwd)/apps/cli-bridge/dist/index.js"

# 로컬 hooks.json과 /complex-prompt prompt를 설치합니다.
node "$CLI_BRIDGE" hook install

# 실제 Stop event를 stdin으로 보내 브라우저 review를 시작합니다.
printf '%s\n' '{"hook_event_name":"Stop","last_assistant_message":"로컬에서 검토할 계획입니다."}' \
  | node "$CLI_BRIDGE" hook stop

# 로컬 테스트가 끝나면 package 소유 Stop hook과 prompt만 제거합니다.
node "$CLI_BRIDGE" hook remove
```

실제 Codex slash command까지 확인하려면 설치 단계에서 `hook remove`를 실행하기 전에 별도 터미널에서 다음을 실행합니다.

```bash
# Codex를 실행합니다.
codex

# Codex 입력창에서 다음 prompt를 입력합니다.
# /complex-prompt 브라우저에서 검토할 계획을 작성해줘
```

`hook stop`은 브라우저에서 review를 기다립니다. Approve는 `{ "continue": true }`, Reject 또는 feedback은 `decision: "block"`과 continuation reason을 반환합니다.

### Stop hook 입력과 review 결과

공식 Codex command-hook JSON의 `last_assistant_message`를 review content로 사용합니다. `plan`, `response`, `output`이 있으면 plan을 우선합니다.

### Stop hook 오류 처리

빈 입력, malformed JSON, browser 실패, timeout, 취소는 Codex turn을 막지 않고 JSON `systemMessage`로 보고합니다. Codex가 이미 계속 진행한 hook은 다시 review하지 않습니다.
