# Pre-judging checklist

Run through this before submitting (target 1 Dec) and again on the morning judging starts. Judges
spend ~3 minutes in judge mode; every run is real testnet transactions paid by the relayer.

## Funds and the EVM window

- [ ] **Top up the relayer.** It pays every EVM transaction. Address:
      `qor12hsns22892r494chkmltpqkn3v7uve3nkej5k0` (`0x55E13829472A8752d717B6feB082d38B3DC66633`).
      Faucet: https://dashboard.qorechain.io/faucet.
      - Measured 24 Nov: 2.62 QOR, then **topped up to 32.6 QOR**; about 31.6 QOR after funding two `/try` test keys (0.5 QOR each). A full judge run costs **about 0.4 QOR**; `/health` warns
        below **2 QOR**. Aim for **at least 10 QOR** before judging (~20 runs plus window reopens).
      - Check: `curl -s https://paper-trail-api.vercel.app/health | jq .relayerBalanceQor`
- [ ] **EVM window open shortly before judging.** A window lasts at most 17,280 blocks (~6.9 h) and
      50 transactions, so it can't be opened once for the whole judging period. The relayer reopens it
      by itself when it runs low (0.1 QOR each time), but the first action after it lapses then waits
      up to ~60 s. Open it by hand right before judging starts (and before recording the demo video):
      ```bash
      pnpm relayer:window status
      pnpm relayer:window open
      ```
      Never run `open` while transactions are in flight (it advances the relayer's nonce). Measured
      24 Nov: the window had lapsed (`remainingBlocks: 0`). Check that a window's 5 QOR cap is
      compatible with the relayer's balance when you open it.

## Live checks

- [ ] `GET /health` shows `ok: true`, no `warnings`, DB and RPC ok, indexer lag a few blocks.
- [ ] One full judge-mode run on https://paper-trail-web-nu.vercel.app: start → refusal → two keys →
      Authentic → remove A2 → scripts → leak traced → audit trail. (~3 min, ~0.4 QOR.)
- [ ] "Try encryption" (`/try`), the juror path (no setup needed for steps 1 and 3's refusal):
      1. Step 1 is prefilled with Marker 1's registered address: press **Check the addresses and
         lock**. Expect a green row "its recipient card matches its ML-DSA-87 key on QoreChain"
         ("card checked") and a `message.ptseal` to download or copy.
      2. Replace the address with a fresh, unregistered `qor1…`: expect "has no ML-KEM-1024 key
         registered on QoreChain".
      3. Step 2: make a key with a passphrase. Its balance and the faucet link appear. With ~0.25
         testnet QOR in it, **Register my keys on QoreChain** sends two transactions (0.2 QOR fees);
         both keys then show "registered on QoreChain".
      4. In a second browser, lock a message for that address (step 1), and open the file back in the
         first browser (step 3): "Opened with your key". The second browser's own key gets
         `NOT_A_RECIPIENT`.
      Steps 3–4 were run live on 24 Nov with two browser-made test keys funded from the relayer
      (0.5 QOR each).
- [ ] The API's chain relay answers: `curl -s -X POST -H 'Content-Type: application/json' https://paper-trail-api.vercel.app/chain/rpc -d '{"jsonrpc":"2.0","id":1,"method":"status"}'`
- [ ] Verify a paper: from judge mode, beat 4 → "Check it yourself" → "Matches the on-chain commitment".
- [ ] The keepalive GitHub Action (`.github/workflows/keepalive.yml`, every 5 min through 16 Dec) is
      enabled and green.
- [ ] `CORS_ORIGIN` on the API includes the web app's origin
      (`http://localhost:5173,https://paper-trail-web-nu.vercel.app`).

## Limits to keep in mind

- `/demo/start` is limited to **5 per hour per IP**. Judges behind one office network share that
  budget; the error message offers "Open the last demo".
- Vercel Hobby keeps runtime logs for only about an hour: if something goes wrong, check the logs
  straight away.
- Testnet only. Nothing here should ever use mainnet funds.

## Submission

- [ ] README "Encrypted Apps requirements" section is current; `AI_USAGE.md` at the repo root.
- [ ] Project page: "How it's made" (draft in `docs/drafts/how-its-made.md`), the 5 addresses from
      the README, the live URL, the repo.
- [ ] Demo video (shot list in `docs/drafts/demo-video.md`).
