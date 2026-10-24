# BODH events: integration guide for the BODH backend

BODH Growth OS measures marketing by **cost per activated user**. It needs three events
from the BODH backend, sent server to server as they happen:

| Event | Send when | Why it matters |
|---|---|---|
| `registration` | A user finishes creating a free account | Counts the signup and records where it came from |
| `activation` | The same user generates their **first** chart | The North Star metric |
| `paid` | The user's first successful payment for a plan | Conversion to Chaatra, Jyotish or Guru |

Send each event once per user. Later charts and renewals are not needed.

## Endpoint

```
POST https://<growth-os-host>/api/events/bodh
Content-Type: application/json
X-Bodh-Timestamp: <unix seconds>
X-Bodh-Signature: v1=<hex HMAC-SHA256>
```

The host is the Growth OS web app URL. The signing secret is the `app-bodh-events-secret`
secret in the Growth OS GCP project. The marketing admin grants your service account read
access to it, so it is never sent by email or chat.

## Signing

1. Take the exact request body bytes you will send.
2. Build the string `<timestamp>.<body>`, where timestamp is the current Unix time in seconds.
3. Compute HMAC-SHA256 of that string with the secret, as lowercase hex.
4. Send `X-Bodh-Timestamp: <timestamp>` and `X-Bodh-Signature: v1=<hex>`.

Requests more than 5 minutes off the server clock are rejected, so keep server time in sync.
During a secret rotation you may send two signatures separated by a comma:
`v1=<with old secret>,v1=<with new secret>`.

### Node

```js
import { createHmac } from "node:crypto";

export async function sendBodhEvents(events) {
  const body = JSON.stringify({ events });
  const ts = Math.floor(Date.now() / 1000);
  const sig = createHmac("sha256", process.env.GROWTH_OS_SECRET).update(`${ts}.${body}`).digest("hex");
  const res = await fetch(`${process.env.GROWTH_OS_URL}/api/events/bodh`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Bodh-Timestamp": String(ts), "X-Bodh-Signature": `v1=${sig}` },
    body,
  });
  if (res.status >= 500) throw new Error(`Growth OS ${res.status}, retry later`);
  return res.json(); // { accepted, duplicates } or { error, issues }
}
```

### Python

```python
import hashlib, hmac, json, os, time, requests

def send_bodh_events(events):
    body = json.dumps({"events": events}, separators=(",", ":"))
    ts = str(int(time.time()))
    sig = hmac.new(os.environ["GROWTH_OS_SECRET"].encode(), f"{ts}.{body}".encode(), hashlib.sha256).hexdigest()
    res = requests.post(
        f"{os.environ['GROWTH_OS_URL']}/api/events/bodh",
        data=body.encode(),
        headers={"Content-Type": "application/json", "X-Bodh-Timestamp": ts, "X-Bodh-Signature": f"v1={sig}"},
        timeout=10,
    )
    if res.status_code >= 500:
        raise RuntimeError(f"Growth OS {res.status_code}, retry later")
    return res.json()
```

Sign the same string you send. Re-serialising the JSON after signing breaks the signature.

## Payload

Send one event as the body, or up to 100 as `{ "events": [ ... ] }`.

| Field | Type | Required | Notes |
|---|---|---|---|
| `event_id` | string, 8 to 100 chars | yes | Stable unique ID for this event. Resending the same ID is safe: it is stored once. Use it as the browser pixel's `eventID` too, so Meta deduplicates. |
| `type` | `registration`, `activation`, `paid` | yes | |
| `occurred_at` | ISO 8601 with offset | yes | When it happened, e.g. `2026-10-24T10:00:00+05:30` |
| `user_id` | string | yes | BODH's user ID. Links the three events of one user. |
| `email` or `email_sha256` | string | recommended | Raw email is hashed on arrival and never stored. Or send SHA-256 of the trimmed, lowercased email. |
| `phone` or `phone_sha256` | string | recommended | Raw phone is normalised to digits with country code (10 digits means +91) and hashed. Or send SHA-256 of that digit string. |
| `platform` | `web`, `android`, `ios` | no | Defaults to `web` |
| `plan` | `chaatra`, `jyotish`, `guru` | on `paid` | |
| `value` | number | on `paid` | Amount paid, in `currency` |
| `currency` | 3-letter code | no | Defaults to `INR` |
| `attribution` | object | on `registration` | Where the user came from. See below. Ignored on other events. |
| `client.ip`, `client.user_agent` | string | recommended | The user's IP and user agent at registration. Improves Meta's match rate. |

### Attribution

Capture these **when the user first lands**, keep them until registration, and send them
with the `registration` event. Only the first touch counts.

| Field | Where it comes from |
|---|---|
| `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term` | Landing page query string |
| `gclid`, `gbraid`, `wbraid` | Landing page query string, from Google Ads auto-tagging |
| `fbclid` | Landing page query string |
| `fbp`, `fbc` | The `_fbp` and `_fbc` cookies set by the Meta pixel |
| `referral_code` | The teacher or creator code the user entered or arrived with |
| `referrer` | `document.referrer` at landing |
| `landing_page` | The full landing URL |

**Web:** on first page view, if there are no stored params yet, save the query parameters and
`document.referrer` in a first-party cookie for 30 days. Read it when the account is created.

**Android:** read the Play Install Referrer on first launch. It carries the `utm_*` and `gclid`
of the install. Send it with the registration.

**iOS:** send whatever the app knows (deep link parameters, referral code). Unattributed iOS
installs show as Direct.

### Example

```json
{
  "events": [
    {
      "event_id": "reg_8f1c2e7a-2b0d",
      "type": "registration",
      "occurred_at": "2026-10-24T10:00:00+05:30",
      "user_id": "u_120394",
      "email": "priya@example.com",
      "phone": "+91 98765 43210",
      "platform": "web",
      "attribution": {
        "utm_source": "meta",
        "utm_medium": "paid_social",
        "utm_campaign": "120210000000000",
        "utm_content": "120210000000111",
        "fbclid": "IwAR1...",
        "fbp": "fb.1.1729740000000.123456789",
        "landing_page": "https://asttrolok.com/free-kundli?utm_source=meta&..."
      },
      "client": { "ip": "203.0.113.7", "user_agent": "Mozilla/5.0 ..." }
    },
    {
      "event_id": "act_8f1c2e7a-2b0d",
      "type": "activation",
      "occurred_at": "2026-10-24T10:04:12+05:30",
      "user_id": "u_120394",
      "platform": "web"
    }
  ]
}
```

## Responses and retries

| Status | Meaning | What to do |
|---|---|---|
| `200 {"accepted": n, "duplicates": m}` | Stored. Duplicates were already stored. | Nothing |
| `400 {"error", "issues": [{path, message}]}` | The payload is invalid. `path` names the field, e.g. `events.0.type`. | Fix the payload. Don't retry as is. |
| `401` | Signature missing, wrong, or timestamp more than 5 minutes off | Check the secret and server clock |
| `413` | Body over 1 MB | Send at most 100 events per request |
| `5xx` or network error | Temporary | Retry with backoff: 1 min, 5 min, 30 min, then hourly for a day. Same `event_id`. |

An `activation` that arrives before its `registration` is fine: it is re-attributed when the
registration arrives.

## Testing

Send events to the staging Growth OS with a staging secret. They appear within seconds on the
**Tracking** page under Recent events, with the channel each registration was attributed to.
