# Webhook Delivery Proposal

## Delivery guarantees

- HTTP 429 responses from destinations are transient failures and follow the same retry policy as timeouts.
- Transient failures use exponential backoff, capped at five minutes.
- Failed deliveries remain available for operator replay for seven days.
- A slow destination must not block delivery to unrelated tenants.

## Open decisions

- Should destination HTTP 429 responses be retried or treated as permanent failures?
- How long should failed deliveries remain available for replay?

### Operational constraint

The delivery worker already records each attempt and its next scheduled retry time.

## Rollout checklist

- Enable the new delivery worker for five percent of tenants, then expand after one week of stable metrics.
- Keep the current worker available for rollback during the pilot.
