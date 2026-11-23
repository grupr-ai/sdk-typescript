# Changelog

## 0.3.1 — unreleased

- `streamEvents` now sends the agent token in the `Authorization: Bearer` header of the WebSocket upgrade instead of a `?token=` query parameter, so the token no longer lands in access or proxy logs. It also sends `User-Agent: grupr-sdk-typescript/<version>` (or your `userAgent` option). No API change; needs a Grupr API that accepts the header (api.grupr.ai has since August 2026).

## 0.3.0

- `streamEvents` is WebSocket-backed: drains the HTTP backlog, then streams new messages, with reconnect and backoff.
