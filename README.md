# Codex Complex Prompt

## 프로젝트 개요

이 프로젝트는 브라우저와 상호작용하며 Codex CLI에서 복잡한 프롬프트를 입력하기 위한 도구입니다. 브라우저에서 텍스트 편집 기능을 제공하고, 작성한 프롬프트를 실행 중인 Codex CLI 세션으로 전달합니다.

Codex CLI가 실행 중인 세션의 입력을 외부 프로세스가 공식적으로 주입하는 API는 현재 보장되지 않습니다. 따라서 실제 adapter는 주입 지점을 격리하고 명시적으로 실패를 반환하며, 통합 테스트는 결정론적인 `MockCodexSessionInputAdapter`를 사용합니다. 실제 연동 API가 제공되면 `apps/cli-bridge/src/adapters`만 교체하면 됩니다.

## 시작하기

필요 버전은 Node.js 24 LTS와 pnpm 9입니다. 저장소의 `.nvmrc`를 사용하면 됩니다.

```bash
nvm install
nvm use
pnpm install
pnpm build
pnpm dev
```

`pnpm dev`는 각 workspace의 개발 명령을 Turborepo로 실행합니다. 실제 bridge를 실행하려면 다음을 사용합니다.

```bash
pnpm --filter @codex-complex-prompt/cli-bridge start
```

`start`는 먼저 `pnpm build`를 실행한 뒤 사용합니다. bridge는 기본적으로 loopback에만 바인딩하며, `COMPLEX_PROMPT_WEB_URL`도 `localhost`, `127.0.0.1`, `::1`의 HTTP(S) 주소만 허용합니다.

브라우저 자동 실행이 실패하면 bridge가 URL을 출력합니다. 웹 앱을 별도로 실행하는 경우 `COMPLEX_PROMPT_WEB_URL`에 Vite 주소를 지정할 수 있습니다.

```bash
COMPLEX_PROMPT_WEB_URL=http://127.0.0.1:5173 pnpm --filter @codex-complex-prompt/cli-bridge start
```

## 품질 명령

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm test:coverage
pnpm build
pnpm format:check
```

작업은 기능별 workspace에서 진행하고 루트 Turborepo 명령으로 전체 검증합니다. protocol을 바꾸면 cli-bridge, server, web의 관련 테스트도 함께 수정합니다. 새 의존성은 실제로 사용하는 workspace에만 추가합니다. Codex CLI 연동 변경은 mock 통합 테스트와 opt-in smoke test를 모두 갱신합니다.

실제 CLI smoke test는 인증된 Codex CLI 실행 환경이 필요하므로 CI에서는 실행하지 않습니다.

각 workspace의 `test:coverage`는 V8 provider와 lines, functions, branches, statements 90% threshold를 적용합니다. CI에서는 `format:check`, `lint`, `typecheck`, 테스트, coverage, build를 모두 통과해야 합니다.

## Workspace

- `apps/cli-bridge`: `/complex-prompt` 진입점, 토큰 생성, bridge 실행, 브라우저 열기, Codex 입력 adapter
- `apps/web`: textarea 편집기와 연결/제출 상태 UI
- `packages/protocol`: CLI↔브라우저 메시지 타입과 Zod schema
- `packages/server`: loopback HTTP/WebSocket 서버와 세션 정책
- `packages/core`: transport와 무관한 draft, 제출 이력, 실행 상태 모델

Turborepo는 workspace task 순서와 캐시만 담당하며, 공통 tooling package는 두지 않습니다. 다른 CLI나 여러 입력 backend가 필요해질 때만 adapter를 별도 package로 분리합니다.
