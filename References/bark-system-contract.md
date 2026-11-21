# Bark System Contract

## Repository ownership

- Media owns the notification display template and schema/interface reference only.
- V12 owns Bitget data collection, Vegas signal calculation, full-pool scanning and publication of the completed schema v1 snapshot.
- Bark is the sole owner of notification delivery, per-slot idempotency, durable outbox, retry state and the public snapshot consumed by V8.
- V8 reads only the public snapshot in Bark and renders the bottom ticker. It does not call the Bark notification API.

## Data path

V12 complete scan -> V12 public-signals.json -> publish to MraJJqq/Bark -> Bark notification workflow -> Bark raw public JSON -> V8 ticker.

## Delivery identity

- Scheduled slots are Beijing time 08:00, 10:00, 16:00, 20:00 and 22:00.
- Every scheduled slot is independent, even when signal content is identical.
- Manual scans use their unique GitHub run ID.
- Duplicate processing of the same slot is suppressed.

## State handling

Bark persists the send intent before contacting the Bark API. HTTP 429 uses bounded Retry-After/backoff retries. Permanent rejection is archived; ambiguous network/5xx outcomes are marked uncertain and are not blindly resent. Pending notifications are not discarded at midnight.

## Secrets

BARK_DEVICE_KEY exists only in Bark repository Actions secrets. SIGNAL_RELAY_TOKEN exists only in V12 repository Actions secrets and is used to publish the public snapshot into Bark. Neither secret belongs in Media or V8.
