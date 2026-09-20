# Architecture

## Connection flow

1. CLI bridge가 암호학적으로 충분한 random session token을 만들고 loopback HTTP/WebSocket 서버를 연다.
2. bridge가 `http://127.0.0.1:<port>/?token=<token>`을 브라우저에 전달한다. 개발 중에는 `COMPLEX_PROMPT_WEB_URL`의 origin을 사용할 수 있다.
3. 브라우저는 bridge origin의 WebSocket `/ws`에 연결한 뒤 첫 메시지로 `session.handshake`를 보낸다. 별도 Vite 서버를 사용하는 경우 bridge origin은 일회성 `bridge` query parameter로 전달된다.
4. 서버는 Zod로 메시지를 검증하고 token의 만료·사용 여부·연결 여부를 확인한다.
5. 성공하면 `session.ready`를 보내고, textarea 제출은 `prompt.submit`으로 adapter callback에 전달한다.
6. adapter가 성공하면 `prompt.result(status=accepted)`, 실패하면 `prompt.result(status=failed)`를 반환한다.
7. 만료, 명시적인 종료, socket close 뒤 token은 다시 사용할 수 없다.

## Security boundary

- 서버는 `127.0.0.1`에만 바인딩하며 임의의 외부 네트워크 인터페이스를 기본값으로 사용하지 않는다.
- token은 URL에 존재하므로 서버 로그, 분석 도구, 화면 로그에 기록하지 않는다. 브라우저가 연결을 완료하면 history에서 query token을 제거한다.
- `COMPLEX_PROMPT_WEB_URL`은 loopback HTTP(S) origin만 허용하며, token은 짧은 TTL과 단일 연결 정책을 가진다.
- WebSocket payload와 동시 연결 수를 제한하고 prompt adapter 호출을 직렬화하며 timeout을 적용한다.
- prompt 내용도 서버 로그에 기록하지 않는다.
- 메시지의 오류는 사용자가 해결할 수 있는 최소한의 code/message만 포함한다.

## Codex CLI constraint

Codex CLI 세션의 입력 버퍼를 외부 Node 프로세스에서 공식적으로 갱신하는 안정적인 API가 보장되지 않을 수 있다. 이 저장소는 `CodexSessionInputAdapter`를 경계로 두고, 기본 구현은 안전하게 실패한다. 이 경계 안에 실제 공식 API가 연결되면 server/protocol/web의 transport는 변경하지 않아도 된다. 테스트와 E2E는 `MockCodexSessionInputAdapter`로 adapter 수신까지 검증한다.
