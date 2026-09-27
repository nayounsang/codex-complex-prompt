# @codex-complex-prompt/cli-bridge

**Codex CLI 전용** 브라우저 문서 에디터입니다. 복잡한 작업·리서치·문서 작성 요청을 Notion과 비슷한 편집 환경에서 직접 검토하고, Codex의 피드백을 반영한 뒤 실행할 수 있습니다. Codex App에서는 동작을 보장하지 않습니다.

## 설치

```bash
npx @codex-complex-prompt/cli-bridge hook install
```

Codex CLI를 재시작하고 처음 등록한 훅을 검토하라는 안내가 나오면 `/hooks`에서 확인하고 승인하세요. 설치기는 기존 훅을 제거하지 않고 함께 등록합니다.

## 사용

Codex CLI에서 스킬을 호출해 편집기를 엽니다.

```text
$complex-prompt 복잡한 요청을 정리해줘
```

일반 텍스트를 입력하면 편집기의 초안으로 사용하고, `.md` 또는 `.txt` 파일 경로를 입력하면 파일 내용을 불러옵니다. 에디터에서 직접 수정하거나 `Send Feedback`으로 Codex의 피드백을 반영한 뒤, `Submit`으로 검토한 요청을 실행할 수 있습니다.

## 설정 관리

```bash
# 설정에 반영될 내용을 먼저 확인합니다.
npx @codex-complex-prompt/cli-bridge hook install --dry-run

# 설치한 항목을 제거합니다. 다른 훅과 설정은 보존합니다.
npx @codex-complex-prompt/cli-bridge hook remove
```

자세한 사용 안내는 [프로젝트 README](https://github.com/nayounsang/codex-complex-prompt#readme)를, 개발 안내는 [개발 문서](https://github.com/nayounsang/codex-complex-prompt/blob/main/docs/development.md)를 참고하세요.
