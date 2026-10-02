# Event Processing Platform: Design Proposal

**Status:** Review draft  
**Owners:** Platform Engineering  
**Last updated:** 2026-10-02

## 1. Summary

The platform accepts tenant events, validates them, and delivers them to configured destinations. It must absorb short traffic spikes without allowing one tenant to consume another tenant's reserved capacity. The design separates admission, durable storage, delivery, and operator replay so each stage can enforce its own limits.

The first release supports JSON events up to 256 KiB, at least once delivery, a 24 hour default retention period, and per-tenant ordering within a partition key. It does not promise global ordering across tenants or destinations.

## 2. Goals and non-goals

### 2.1 Goals

- Accept bursts while applying explicit per-tenant and global capacity limits.
- Persist accepted events before acknowledging them to clients.
- Retry transient destination failures without blocking unrelated partitions.
- Expose enough state for operators to diagnose, replay, and safely pause delivery.
- Support rolling upgrades while old and new workers consume the same stored event format.

### 2.2 Non-goals

- Exactly once delivery to third-party destinations.
- Cross-region synchronous replication in the first release.
- Transforming payload schemas during ingestion.
- Providing a general purpose workflow engine.

## 3. Architecture

### 3.1 Request path

The Edge Gateway authenticates a tenant, validates the envelope, and assigns a stable event identifier. It sends an admission request to the Quota Coordinator, then writes accepted batches to the regional event log. The gateway acknowledges a batch only after the log confirms durable storage.

The Quota Coordinator maintains short lived reservations in a regional cache. A reservation is scoped by tenant, API key, and time window. The durable event log remains the source of truth for accepted data; the cache is only an admission aid and may be rebuilt after a regional restart.

### 3.2 Ingestion buffer pressure

When a tenant's pending ingestion buffer reaches 8,000 batches, the gateway rejects that tenant's new batch with HTTP 429 and a `Retry-After: 30` header. The limit is evaluated per tenant, so a full buffer for one tenant does not reduce the quota of another tenant. The gateway does not retain a rejected batch and clients may retry with the same idempotency key.

The global safety limit is 120,000 pending batches per region. When that limit is reached, the gateway rejects new batches for all tenants with HTTP 503 and a `Retry-After: 60` header. The global limit protects storage when tenant-level accounting is delayed; it is not a replacement for the per-tenant limit.

### 3.3 Durable event format

Each log record contains the tenant identifier, event identifier, partition key, schema version, received timestamp, payload bytes, and a checksum. The gateway stores the original payload bytes without normalizing JSON field order. A separate index contains destination state and retry metadata so delivery attempts do not rewrite immutable event data.

The record schema is versioned independently from the public request envelope. Readers must ignore unknown optional fields. Writers must not reuse a field number or change the meaning of a field within a schema version.

### 3.4 Delivery and retry behavior

Delivery workers lease partitions from the coordinator and process events in partition order. A worker acknowledges an event after the destination returns a success response or a configured permanent-failure response. A worker releases its lease if it shuts down before completing the current event.

For a transient destination failure, the worker retries with exponential backoff starting at 2 seconds and capped at 5 minutes. The delay includes deterministic jitter derived from the event identifier so repeated attempts for one event are reproducible. After 20 failed attempts, the event moves to the tenant's dead-letter view and stops consuming delivery capacity.

Destination timeouts and HTTP 429 responses are transient failures. The worker honors a valid destination `Retry-After` header up to the 5 minute cap. Invalid or larger values use the capped exponential delay. These delivery rules apply after an event has been accepted and persisted; they do not change gateway admission behavior.

## 4. Data lifecycle

### 4.1 Retention

Accepted events remain in the regional log for 24 hours by default. Tenants may configure retention between 1 hour and 7 days. Dead-letter events use the same retention setting unless a tenant exports them earlier.

### 4.2 Deletion requests

Deleting a tenant removes its API keys immediately and schedules its event partitions for compaction. Compaction removes payload bytes and indexes within 24 hours. Audit records retain the tenant identifier, deletion timestamp, and event count, but never payload content.

### 4.3 Replay

Operators may replay a bounded range of dead-letter events after confirming the destination configuration. A replay creates a new delivery generation and retains the original event identifier. It does not bypass the destination's concurrency limit or create a second copy of the stored payload.

## 5. Public API and compatibility

### 5.1 Batch ingestion

`POST /v1/events:batch` accepts between 1 and 500 events. Each event must include an idempotency key that is unique within its tenant. A repeated key with an identical payload returns the original acceptance result. A repeated key with a different payload returns HTTP 409.

Clients should reuse the same idempotency key when retrying an ambiguous network failure. The server retains idempotency records for 24 hours, matching the minimum event retention period.

### 5.2 Response behavior

- HTTP 202 means every event in the batch is durably accepted.
- HTTP 400 means the request envelope is invalid and will not succeed without a client change.
- HTTP 409 means an idempotency key was reused with different content.
- HTTP 429 means a tenant or API key limit is active.
- HTTP 503 means a regional safety limit is active or the durable log is unavailable.

Error responses include a stable error code and a request identifier. Clients may log the request identifier but should not log authorization headers or event payloads.

### 5.3 Schema evolution

The public envelope uses additive evolution. New optional fields may be introduced without changing the endpoint version. A field becomes required only in a new endpoint version after clients have had at least two release cycles to migrate.

Stored event records use reader-first rollout: deploy readers that accept both old and new schema versions, then deploy writers that emit the new version. Rollback must remain possible until all retained events are readable by the previous worker release.

## 6. Security and privacy

Tenant identity comes from a signed API key and is checked again when a worker reads a partition. The regional event log is encrypted at rest with a tenant-independent regional key. Access to replay and deletion operations requires an audited operator role and a reason code.

Payloads may contain personal data. The gateway excludes payload values from metrics, traces, and application logs. Event identifiers are safe for internal correlation but must not be used as metric labels because their cardinality is unbounded.

## 7. Failure handling

If the Quota Coordinator is unavailable, the gateway fails closed for new writes. If the durable log is unavailable, the gateway does not acknowledge a batch. If a delivery worker loses its lease, it stops before starting another event and allows the lease to expire.

Coordinator cache loss may temporarily reduce admission throughput while reservations are rebuilt. It must not cause acknowledged events to be dropped. Rebuilding reservations uses log offsets and tenant identifiers, not payload scans.

## 8. Operations

### 8.1 Capacity signals

Dashboards show accepted and rejected batches, pending batches by tenant, global pending batches, log write latency, delivery lag, and dead-letter counts. Tenant identifiers are available in access-controlled diagnostic views but are not metric dimensions.

### 8.2 Operator controls

Operators can pause delivery for one destination, lower its concurrency, or disable a tenant API key. Pausing delivery does not stop ingestion while capacity remains available. Disabling a key rejects new requests but does not delete previously accepted events.

## 9. Alternatives considered

### 9.1 Synchronous destination delivery

Calling destinations inline would remove the need for a delivery log but would couple ingestion latency and availability to every destination. It also makes per-tenant isolation harder when one destination is slow. This option was rejected.

### 9.2 One shared regional queue

A single FIFO queue is simpler to operate, but a slow destination can block unrelated tenants and destination types. Partitioned storage with bounded leases adds coordination cost but keeps delivery progress isolated.

### 9.3 Client-side buffering only

Client buffering reduces server state, but it cannot guarantee accepted events survive a client restart and produces inconsistent retry behavior across SDKs. The server remains responsible for durable acceptance and delivery retries.

## 10. Rollout plan

1. Deploy the event log and coordinator in shadow mode; do not reject requests based on the new limits.
2. Enable durable writes for internal tenants and compare acceptance counts with the existing path.
3. Enable per-tenant limits for 5% of external tenants, then 25%, then all tenants.
4. Enable the global safety limit after one week of regional capacity observations.
5. Remove the legacy synchronous delivery path after all destinations report stable lag and replay behavior.

Rollback disables new admission checks and routes traffic through the legacy path. Events already accepted by the new log continue to be delivered by the new workers; rollback must not delete or rewrite them.

## 11. Validation plan

- Verify idempotency for identical and conflicting payloads.
- Verify one tenant reaching its pending-batch limit does not change another tenant's available quota.
- Verify delivery retries honor destination `Retry-After` without changing ingestion responses.
- Verify global-limit responses use HTTP 503 while tenant-limit responses use HTTP 429.
- Verify worker rollback can read every schema version still inside the retention window.
- Load test regional recovery while coordinator reservations are rebuilt.

## 12. Open questions

- Should the default tenant buffer be adjusted by subscription tier?
- Should operators be allowed to extend dead-letter retention for regulated tenants?
- What maximum regional recovery time is acceptable after a coordinator cache loss?
