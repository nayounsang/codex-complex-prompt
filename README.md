# Codex Complex Prompt

Codex CLI에서 여러 맥락과 절차가 필요한 복잡한 작업을 지시할 때 또는 문서 작업을 할 때 사용합니다. Send Feedback으로 AI와 수정 할 수 있고, Submit으로 명령을 실행합니다.

- Codex CLI에서 `$complex-prompt`를 호출하면 브라우저에 Markdown 편집기가 열리고, 입력한 명령이 Codex의 현재 대화 차례에 전달됩니다.
- AI 피드백을 제출하면 Codex CLI가 피드백을 수용한 문서가 있는 브라우저 편집기를 다시 열어 작업을 이어갑니다.
- Send Feedback으로 피드백을 반복하거나 Submit으로 검토를 끝내 최종 문서의 명령을 실행할 수 있습니다.

## 시작하기

### 설치

```bash
# npm에서 CLI를 내려받아 Codex 훅과 complex-prompt 스킬을 한 번 설치합니다.
npx @codex-complex-prompt/cli-bridge hook install

# Codex를 재시작해 새 스킬과 훅을 불러옵니다.
codex

# Codex 입력창에서 새 명령 훅을 검토하고 승인합니다.
/hooks

# Codex 입력창에서 브라우저 명령 편집기를 호출합니다.
$complex-prompt [입력(선택)]
```

### 스킬 인자

- **일반 텍스트**: 해당 내용으로 채워진 에디터가 열립니다.
- **md, text파일**: 해당 파일의 내용으로 채워진 에디터가 열립니다.

### (선택 사항) 환경 격리가 필요한 경우

`CODEX_HOME`은 Codex 설정을 저장하는 디렉터리를 가리키는 환경 변수입니다. 보통은 지정할 필요 없이 `~/.codex`를 사용합니다. 프로젝트별 설정을 사용하려면 Codex를 실행할 때까지 같은 셸에서 다음처럼 지정합니다.

```bash
# 현재 프로젝트 아래에 Codex 설정을 격리합니다.
export CODEX_HOME="$PWD/.codex"

# 격리된 hooks.json과 스킬을 설치합니다.
npx @codex-complex-prompt/cli-bridge hook install

# 같은 프로젝트 설정을 읽는 Codex를 실행합니다.
CODEX_HOME="$PWD/.codex" codex
```

### 훅 명령

```bash
# 실제 파일을 바꾸지 않고 hooks.json과 설치 파일의 변경 내용을 확인합니다.
npx @codex-complex-prompt/cli-bridge hook install --dry-run

# UserPromptSubmit/Stop 훅, 스킬, 호환용 프롬프트를 설치합니다.
npx @codex-complex-prompt/cli-bridge hook install

# 패키지가 표식으로 소유권을 기록한 항목만 제거합니다.
npx @codex-complex-prompt/cli-bridge hook remove
```

- `hook install`: `CODEX_HOME/hooks.json`에 `UserPromptSubmit`과 AI 피드백용 `Stop` 명령을 등록하고 `CODEX_HOME/skills/complex-prompt/SKILL.md`, `CODEX_HOME/prompts/complex-prompt.md`를 설치합니다. 기존 훅(Plannotator 포함)과 사용자 파일은 보존합니다.
- `hook install --dry-run`: 파일을 쓰지 않고 변경될 JSON과 파일 내용을 출력합니다. 비대화형 환경에서 먼저 확인할 때 사용합니다.
- `hook remove`: 이 패키지의 표식이 있는 명령·스킬·프롬프트만 제거합니다. 다른 훅과 설정은 제거하지 않습니다.

## 개발

### 로컬 개발

```bash
# 준비
pnpm install
pnpm build

# 이후 명령에서 사용할 로컬 CLI 경로를 지정합니다.
CLI_BRIDGE="$(pwd)/apps/cli-bridge/dist/index.js"

# 실제 hooks.json을 바꾸기 전에 변경될 JSON을 확인합니다.
node "$CLI_BRIDGE" hook install --dry-run

# 로컬 Codex 설정에 UserPromptSubmit 훅과 스킬을 설치합니다.
node "$CLI_BRIDGE" hook install

# Codex의 UserPromptSubmit 입력을 재현하고 브라우저 편집기를 엽니다.
printf '%s\n' '{"hook_event_name":"UserPromptSubmit","prompt":"$complex-prompt 로컬 명령"}' | node "$CLI_BRIDGE" hook prompt

# 로컬 설정에서 패키지가 설치한 항목만 제거합니다.
node "$CLI_BRIDGE" hook remove
```

### 명령어

```bash
# 전체 품질 검사를 실행합니다.
pnpm lint

# TypeScript 타입 검사를 실행합니다.
pnpm typecheck

# 모든 테스트를 실행합니다.
pnpm test

# 커버리지 기준을 포함해 테스트합니다.
pnpm test:coverage

# 배포용 CLI와 정적 웹 UI를 빌드합니다.
pnpm build

# 코드 형식 검사와 실제 npm 패키지 설치 스모크 테스트를 실행합니다.
pnpm format:check
pnpm package:smoke

# UI를 확인합니다.
pnpm dev
```

### CLI와 브라우저 종단 간 테스트

CI는 웹 UI와 CLI 브리지를 빌드한 다음, Playwright와 모의 Codex 프로세스를 통해 CLI 훅 프로세스의
브라우저 흐름 두 가지를 실행합니다. 모의 프로세스는 Codex 형식의 훅 JSON을 전달하고 훅 응답을
읽습니다. 실제 모델은 실행하지 않습니다.

Chromium을 한 번 설치한 뒤 다음 명령으로 로컬에서 테스트할 수 있습니다.

```bash
pnpm build
pnpm --filter @codex-complex-prompt/e2e exec playwright install chromium
pnpm test:e2e
```

### 저장소 구성

- `apps/cli-bridge`: npm 실행 파일, 루프백 브리지, Codex UserPromptSubmit/Stop 훅과 설정 관리
- `apps/web`: Markdown 편집기와 AI 피드백 검토 UI
- `packages/protocol`: CLI↔브라우저 통신 및 Codex 훅 JSON의 Zod 스키마
- `packages/server`: 루프백 HTTP/WebSocket 서버와 세션 정책
- `packages/core`: 전송 방식과 무관한 초안, 제출 이력, 실행 상태 모델

### 배포

1. 기능을 변경하면 `pnpm changeset`으로 변경 기록을 추가하세요. 이 프로젝트는 [semver](https://semver.org/lang/ko/)를 따릅니다.
2. 작업 PR이 병합되면 변경 기록을 반영한 버전 PR이 생성됩니다.
3. 버전 PR을 병합하면 릴리스합니다.
