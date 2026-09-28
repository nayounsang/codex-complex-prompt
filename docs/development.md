# 개발 및 기여

## 저장소 구성

- `apps/cli-bridge`: npm CLI, Codex CLI 훅, 로컬 브리지 서버, 설정 설치·제거
- `apps/web`: Markdown 편집기와 AI 피드백 검토 UI
- `packages/protocol`: CLI와 브라우저 간 메시지 및 Codex 훅 입력 스키마
- `packages/server`: loopback HTTP/WebSocket 서버와 세션 정책
- `packages/core`: 전송 방식과 무관한 초안·제출 이력·실행 상태 모델
- `e2e`: CLI 훅과 브라우저 간 종단 간 흐름

## Codex 플러그인 패키지

저장소 루트의 `.codex-plugin/plugin.json`은 `skills/` 아래의 설치 안내 스킬을 별도 Codex 플러그인으로 제공합니다. 외부 marketplace는 이 Git 저장소를 URL source로 참조합니다. 설치 skill은 명령만 안내하고 실행하지 않습니다. npm CLI 업데이트 시 `skills/install-complex-prompt/SKILL.md`의 고정 package version도 함께 갱신합니다.

## 로컬 개발

### 최초 설정

저장소 루트에서 의존성을 설치하고 CLI와 웹 UI를 빌드합니다. 로컬 Codex 설정에 훅과 스킬을 한 번 등록하고, Codex CLI를 재시작해 새 설정을 불러옵니다.

```bash
pnpm install
pnpm build
CLI_BRIDGE="$(pwd)/apps/cli-bridge/dist/index.js"

# 설치 전에 설정 파일에 적용될 내용을 확인합니다. 파일은 변경하지 않습니다.
node "$CLI_BRIDGE" hook install --dry-run

# 로컬 Codex 설정에 훅과 스킬을 설치합니다. 이 단계는 최초 한 번만 필요합니다.
node "$CLI_BRIDGE" hook install
```

Codex CLI에서 훅을 처음 실행할 때 검토 안내가 나오면 `/hooks`를 열어 확인하고 승인합니다.

### 코드 변경 시

```bash
pnpm build
```

Codex CLI에서 스킬을 직접 호출해 실제 사용자 흐름을 확인합니다.

```text
$complex-prompt ## test test test
```

### 훅 입력을 직접 재현하기

스킬 호출 대신 Codex가 전달하는 `UserPromptSubmit` 입력만 따로 재현할 수도 있습니다. 이 명령은 브라우저 편집기를 열며, 편집기에서 제출할 때까지 대기합니다.

```bash
CLI_BRIDGE="$(pwd)/apps/cli-bridge/dist/index.js"

# Codex UserPromptSubmit 입력을 재현해 브라우저 편집기를 엽니다.
printf '%s\n' '{"hook_event_name":"UserPromptSubmit","prompt":"$complex-prompt 로컬 명령"}' | node "$CLI_BRIDGE" hook prompt
```

### 로컬 훅 제거

개발용 훅과 스킬이 더 이상 필요하지 않으면, 설치할 때와 같은 저장소 루트에서 제거합니다.

```bash
CLI_BRIDGE="$(pwd)/apps/cli-bridge/dist/index.js"

# 이 패키지가 설치한 항목을 제거합니다.
node "$CLI_BRIDGE" hook remove
```

## 품질 확인

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm format:check
pnpm package:smoke
```

종단 간 테스트는 빌드한 웹 UI와 모의 Codex 프로세스를 사용하며 실제 모델은 호출하지 않습니다. Chromium을 설치한 뒤 실행합니다.

```bash
pnpm --filter @codex-complex-prompt/e2e exec playwright install chromium
pnpm test:e2e
```

## 릴리스

1. 배포 패키지에 영향을 주는 변경에는 `pnpm changeset`으로 changeset을 추가합니다.
2. 작업 PR이 병합되면 변경 기록을 반영하는 버전 PR이 생성됩니다.
3. 버전 PR을 병합하면 릴리스합니다.

이 프로젝트는 [Semantic Versioning](https://semver.org/lang/ko/)을 따릅니다.
