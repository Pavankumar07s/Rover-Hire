# Rover IDs (public only, no keys)

Everything on this page was made new at the start of ETHGlobal Mumbai, on 5 and 6 November 2026 (IST). We made fresh accounts, topics, agents and a fresh mission log, so the demo starts clean. The ids we used before the event, and what they were for, are listed in [PRIOR_WORK.md](../../PRIOR_WORK.md).

The new accounts were funded only from public faucets: the Hedera portal faucet (80 HBAR), Circle's USDC faucet (20 USDC) and Google Cloud's 0G Galileo faucet (0.1 0G). Every other account was created and funded by the new buyer.

## Accounts (checked live 6 Nov 2026)

| Role | ID | EVM address | Balance at check |
|---|---|---|---|
| Hedera buyer (x402 payer, HCS, ERC-8004 feedback) | `0.0.11326806` | `0xc6611156044f0be6ac67c6953cacf986d6c4173c` | 40.69 HBAR, 15 USDC |
| Hedera Rover-A (payTo, agent owner, money topic) | `0.0.11327287` | `0x9a1d29964baa8557bc7dd78f3267eee2c6557335` | 12.57 HBAR, USDC associated |
| Hedera Rover-B (simulated seller) | `0.0.11327291` | `0x6657c53a579ed7021cf1fee3e65b1db8c04d5ba8` | 2.93 HBAR |
| Galileo wallet (0G Storage + EpisodeLog) | — | `0x68F1c6cd175Ae8373947c2Aca6a8520929a82aEa` | 0.0986 test 0G |

## 0G

| Item | Value |
|---|---|
| EpisodeLog (Galileo 16602) | `0x44152879e809A63F70d4c529826660a65fd3B3E7`, deployed 5 Nov 22:34 IST, tx `0xf6ac5614…a037`, block 64023569 ([explorer](https://chainscan-galileo.0g.ai/address/0x44152879e809A63F70d4c529826660a65fd3B3E7)) |
| Compute provider (pinned) | `0xf4FB8d2bD856e672b5f9848b0eD235A20079B250`, 0G's provider for `0gm-1.0-35b-a3b`, TeeML, signer `0x6C94321bB38e764ed266Db6e3eEe7503f754A23a` (acknowledged on 0G mainnet), served from `compute-network-20.integratenetwork.work`. 0G moved the model to this provider on 6 Nov at 00:18 IST, after taking the one before it down (listed in [PRIOR_WORK.md](../../PRIOR_WORK.md)). Tested on the rover the same night: the answer came from this provider and its TEE signature verified against this signer. |

## Hedera

| Item | Value |
|---|---|
| HCS rover money topic | `0.0.11327288`, submit key Rover-A, created 5 Nov by `services/hedera-shop/scripts/setup.ts` |
| HCS buyer spending topic | `0.0.11327289`, submit key buyer, created by the same script |
| Agent Kit audit topic | `0.0.11327290`, submit key buyer, created with Agent Kit's `create_topic_tool` (`hedera-buyer audit-setup`) |
| ERC-8004 Rover-A agentId | **#137**: registered 5 Nov by Rover-A's own key, tx `0xb7013d86…dfdff`; `setAgentURI` tx `0xd8325b5c…2f98` |
| ERC-8004 Rover-B agentId | **#138**: registered 5 Nov by Rover-B's own key, tx `0x374db1d4…d3ad`; `setAgentURI` tx `0x527e6c54…6e4` |
| ERC-8004 registration timestamp (`ERC8004_FROM`) | `1793898176` (Rover-A's registration block time minus 60 s; in the buyer's `.env`) |
| Public replay page | **https://rover-replay.vercel.app**: Vercel project `rover-replay`, a static export of `apps/replay/out`; no env vars, no server. It reads the new EpisodeLog and topics from `apps/replay/lib/config.ts` |

## Remote MCP (Phase 13)

| What | Id | Note |
|---|---|---|
| Remote buyer account | `0.0.11328337` (EVM `0x261fab5c8fd7f93581e7cb12a7d6c84a2b4f48d1`) | created and funded by the buyer `0.0.11326806`: 10 HBAR, 5 USDC; key only in `scripts/p13/.env.buyer` (0600) and Render's settings |
| Remote buyer spending topic | `0.0.11328340` | submit key: the remote buyer's own key |
| Remote buyer on Base Sepolia / Solana devnet (Phase 14) | `0xdBBe01AA5b82745dEd88eE1bD10AaeC38eb6A2a6` / `5GvKsCVADiqsxu7G1xFoujU2BT7Ahf371ZefwchAkpno` | keys only in `scripts/p13/.env.buyer` (0600) and Render's settings; funded from Circle's faucet, 20 USDC each |
| Render service | `https://rover-for-hire.onrender.com` | free plan, kept awake by UptimeRobot |
| Render service id | `srv-dbjj0avb9u1s73e66nig` | region Singapore, branch `rover`; deployed by hand through Render's API after each push |
| State copy | Neon free Postgres, AWS ap-southeast-1, schema `p13` | tables `files` (mission files) and `kv` (tunnel address, day's cap total); emptied on 5 Nov; address only in `P13_DATABASE_URL` |

## Station-A, the sensor station (Phase 12)

| What | Id | Note |
|---|---|---|
| Station-A account (payTo, agent owner) | `0.0.11328271` (EVM `0x8E66477d5C43a524de6E86d2cbE8bEF133a834B7`) | created by the buyer `0.0.11326806` with 5 HBAR and an ECDSA alias, USDC associated (`services/hedera-shop/scripts/setup-p12.ts`); key only in `services/hedera-shop/.env.s` (0600) |
| Station-A sales topic | `0.0.11328274` | submit key: Station-A's own key |
| ERC-8004 Station-A agentId | **#139** | registered 6 Nov by Station-A's own key, tx `0x51cc10af…1888` (1.44 HBAR); `setAgentURI` tx `0x579c3e59…2628` (0.33 HBAR). Card skills: climate-reading, light-level, motion-events |
| Reading signer (on the board) | `0x9Aeb19a151E001799926BBA7C9CCAa3E7D4fb702` | a new key made on the board on 6 Nov; key only in `/home/arduino/0xbs-station/station.env` (0600) on the second UNO Q; every reading is signed with it |
| Station board | second UNO Q, hostname `stationa` (`stationa.local` on the hotspot) | API `:8710` behind `X-Station-Token`; the shop sells it on `:8404` |
| Station-A on Base Sepolia (Phase 14) | `0x93Af7Fd05A961132DAbdEd59657652c97333b54f` | receives USDC on Base; key only in `services/hedera-shop/.env.s` (0600) |
| Station-A on Solana devnet (Phase 14) | `Afr4bRMcWpTPemgKGbVqUjBXyQaxuK6u5L32sGWsPVLM` | receives USDC on Solana (its USDC token account exists); key only in `.env.s` |
| Station-A card update (Phase 14) | `setAgentURI` tx `0x3d8b7064…9e01` (0.76 HBAR), 6 Nov | the card's `x402.accepts` lists the two addresses above |
| Buyer on Base Sepolia / Solana devnet (Phase 14) | `0xBdD46BABFc54E08DB34Ad057414701AfD5ab3dDf` / `DrYqLHb5btinWAvZyuHQMf5picrR5AVN9SxmyFxDwPou` | the local MCP server's wallet, `~/.0xbs/wallet.json` (0600); funded from Circle's faucet, 20 USDC each |

## Rover-A on Base and Solana (Phase 14)

| What | Id | Note |
|---|---|---|
| Rover-A on Base Sepolia | `0x79C515a8fC8A6E6cf65636dd163772f4C5204ce1` | receives USDC on Base; key only in `services/hedera-shop/.env.a` (0600) |
| Rover-A on Solana devnet | `GaHBtss84gr2xvmY9gVy4XydioVh5nFwU2Rv8cDAih58` | receives USDC on Solana; its USDC token account exists (funded from Circle's faucet); key only in `.env.a` |
| Rover-A card update | `setAgentURI` tx `0xce5e28ca…7568` (0.72 HBAR), 6 Nov | the card's `x402.accepts` lists the two addresses above |
