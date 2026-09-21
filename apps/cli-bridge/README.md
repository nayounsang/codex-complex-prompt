# @codex-complex-prompt/cli-bridge

Codex의 `UserPromptSubmit` hook과 loopback 서버를 연결하는 npm CLI입니다. `$complex-prompt`를 호출하면 브라우저에 명령 입력창 하나를 열고, 전송된 명령을 Codex에 전달합니다. AI 응답은 브라우저에 표시하지 않습니다.

### Install

```bash
# npm에서 package를 내려받아 Codex 설정을 한 번 설치합니다.
npx @codex-complex-prompt/cli-bridge hook install

# Codex를 재시작합니다.
codex

# 새 command hook을 검토하고 trust하라는 안내가 있으면 Codex 입력창에 입력합니다.
# 입력: /hooks

# Codex 입력창에서 skill을 호출합니다.
# 입력: $complex-prompt 복잡한 작업을 진행해줘
```

설치 대상은 `CODEX_HOME/hooks.json`, `CODEX_HOME/prompts/complex-prompt.md`, `CODEX_HOME/skills/complex-prompt/SKILL.md`입니다. `CODEX_HOME`을 지정하지 않으면 각각 `~/.codex/hooks.json`, `~/.codex/prompts/complex-prompt.md`, `~/.codex/skills/complex-prompt/SKILL.md`를 사용합니다. `CODEX_HOME`은 Codex 설정 디렉터리를 지정하는 환경 변수이며, 프로젝트별 설치가 필요할 때만 `export CODEX_HOME="$PWD/.codex"`처럼 지정하면 됩니다.

첫 `npx`가 package 다운로드와 설치를 모두 수행합니다. 설치 결과가 설정 파일에 남으므로 이후 `$complex-prompt`를 사용할 때마다 설치 명령을 다시 실행하지 않습니다. 이 package는 `/complex-prompt` slash command를 별도로 등록하지 않고 Codex skill을 설치하며, Codex CLI의 skill 호출은 `$complex-prompt`를 사용합니다.

### Hook 명령의 의미

```bash
# 파일을 변경하지 않고 설치될 JSON과 관리 파일 내용을 확인합니다.
npx @codex-complex-prompt/cli-bridge hook install --dry-run

# UserPromptSubmit hook과 skill/prompt 파일을 설치합니다.
npx @codex-complex-prompt/cli-bridge hook install

# package가 marker로 관리하는 항목만 제거합니다.
npx @codex-complex-prompt/cli-bridge hook remove
```

`hook install`은 기존 `hooks.json`과 다른 사용자의 hook을 보존하고, package가 추가한 `UserPromptSubmit` command만 marker로 추적합니다. `hook remove`는 그 marker가 있는 command와 package 소유 skill/prompt만 제거합니다. `--dry-run`은 비대화형 환경에서 실제 변경 전에 확인하는 옵션입니다. `/hooks`는 매번 설치하는 명령이 아니라, Codex가 처음 실행하는 hook을 검토하고 trust하는 승인 화면입니다.

### 로컬에서 실행

```bash
# workspace 의존성을 설치합니다.
pnpm install

# CLI와 정적 web UI를 빌드합니다.
pnpm build

# 로컬 CLI 실행 파일의 절대 경로를 지정합니다.
CLI_BRIDGE="$(pwd)/apps/cli-bridge/dist/index.js"

# 설치 전 hooks.json과 관리 파일의 변경 내용을 확인합니다.
node "$CLI_BRIDGE" hook install --dry-run

# 로컬 Codex 설정에 hook과 skill/prompt를 설치합니다.
node "$CLI_BRIDGE" hook install

# UserPromptSubmit hook 입력을 직접 보내 브라우저 편집기를 엽니다.
printf '%s\n' '{"hook_event_name":"UserPromptSubmit","prompt":"$complex-prompt 로컬 실행"}' | node "$CLI_BRIDGE" hook prompt

# 브라우저에서 Command를 입력하고 Send command를 누른 뒤 package 항목을 제거합니다.
node "$CLI_BRIDGE" hook remove
```

브라우저에서 명령을 전송하면 JSON의 `hookSpecificOutput.additionalContext`로 명령이 반환되고 창이 닫힙니다. 브라우저는 AI 응답을 렌더링하지 않습니다.

### Codex UserPromptSubmit 계약

hook은 stdin JSON의 `prompt`가 `$complex-prompt` 또는 `/complex-prompt` 호출인지 확인합니다. 호출이 아니면 `{ "continue": true }`만 반환합니다. 호출이면 브라우저에서 입력받은 명령을 다음 형태로 반환합니다.

```json
{
  "continue": true,
  "hookSpecificOutput": {
    "hookEventName": "UserPromptSubmit",
    "additionalContext": "Execute the following command ..."
  }
}
```

빈 입력, malformed JSON, 브라우저 실패, timeout, 취소는 turn을 차단하지 않고 `systemMessage`가 포함된 JSON으로 보고합니다. Approve와 feedback은 현재 범위가 아니며 추후 기능입니다.
