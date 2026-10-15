# API walkthrough

Start the app in one terminal: `npm run dev`. Keep that terminal visible if you need to inspect a server error. The default API URL is `http://localhost:3000`.

This walkthrough creates records. Every reconciliation call processes all orders in the connected database. Use your development instance. New references prevent collisions between rehearsals, but report totals include previous records too; describe the three orders with your current demo prefix rather than promising global totals of exactly three.

## Postman

Import `finance-reconciliation.postman_collection.json` using Postman's Import button. The collection variable `baseUrl` points to the local API. Open the main-demo folder and send requests in numbered order.

Request 01 creates a fresh `runId` using Postman's random GUID variable. The order and settlement references include that ID. Request 09 reads the missing-settlement exception from the response and saves its database ID as `missingExceptionId`; request 16 uses it. Every request has a small check for its expected HTTP status. These scripts automate bookkeeping only; the actual work still happens in the API.

## Curl backup

```bash
bash demo/walkthrough.sh
```

The script pauses before each stage when run in a terminal. It prints the response JSON and checks the HTTP status. To run without pauses:

```bash
DEMO_AUTO=1 bash demo/walkthrough.sh
```

Set `BASE_URL` when using another port. The script uses Bash, curl, and Node, and requires no additional npm package. Its `request_api` helper sends a request, separates curl's status code from the response body, and pretty-prints the JSON. `step` pauses so you have time to explain. The `missing_id` lookup finds the exception for this rehearsal; it never assumes database IDs start at one.

## Demonstrated behavior

| Time | Action | Explanation |
| --- | --- | --- |
| 0:00–0:30 | Introduce the project and health check | “This API compares expected order amounts with settlement receipts.” |
| 0:30–1:30 | Create three orders and two settlements | “One will match, one is short by 500 paisa, and one has no receipt.” |
| 1:30–2:30 | Reconcile and inspect exceptions | “A left join keeps missing settlements visible. Partial payments are summed per order.” |
| 2:30–3:00 | Run again | “The upsert keeps one exception per order when the same data is processed again.” |
| 3:00–4:00 | Add the missing 500 paisa and rerun | “New evidence changes the outcome; the order matches and its open exception closes.” |
| 4:00–4:30 | Show manual resolution, if useful | “This records a review decision. It does not change the cash received or make an unmatched amount match.” |
| 4:30–5:00 | Show tests or one error response | “Tests cover the HTTP/database path, including a failure that rolls back an earlier write.” |

The optional Postman folder demonstrates receipts arriving before orders, duplicate protection, and invalid input. The unmatched list means the order reference is unknown; an amount mismatch for a known order appears in the exception list instead.

## Before running

- Run `npm test` to check the application.
- Start the server and send the health request.
- Run request 01 first each time to generate fresh references.
- If a request fails, inspect its status, response body, and server logs.
