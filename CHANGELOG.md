# Mabel change history

This log records every Mabel-specific commit from the first browser companion implementation onward. Commit links open the exact code change on GitHub.

## 19 July 2026

### [`943157b`](https://github.com/Alyx-ML/Mabel/commit/943157be92f303dbcf58b219bff5f6237fc44366) — Name Pages deployments by commit

- Added a custom GitHub Pages deployment workflow.
- Made future Actions runs include their triggering commit message.
- Configured the workflow to select GitHub Actions as the Pages publishing source.

### [`7ca54e8`](https://github.com/Alyx-ML/Mabel/commit/7ca54e87bca7fdc096f02e4e18fe8741290a947d) — Restore direct GLM voice streaming

- Removed the Gemma-specific timeout, retry, and stream-filtering wrapper.
- Restored direct Workers AI streaming without Groq triage.
- Selected GLM-4.7 Flash and disabled thinking.
- Required complete model output within five seconds and voice preparation within seven seconds.
- Limited responses to short conversational sentences for voice latency.

### [`c5aba58`](https://github.com/Alyx-ML/Mabel/commit/c5aba584b1ec07b4433979844e81488307e25e54) — Switch Mabel to GLM 4.7 Flash

- Replaced Gemma 4 with Cloudflare GLM-4.7 Flash.
- Removed Gemma-specific internal naming.
- Disabled model thinking and used the current completion-token parameter.

### [`2899231`](https://github.com/Alyx-ML/Mabel/commit/2899231a415981f1b103310019c4c96b9beb7837) — Prevent Gemma voice turns from restarting

- Removed automatic same-model retries that could double a stalled request.
- Allowed slow streams more time to begin and continue.
- Extended the browser request window for an active voice turn.

### [`600aed3`](https://github.com/Alyx-ML/Mabel/commit/600aed34cb9082e29f464c82ecd227774f66294b) — Preserve transcripts and prevent thinking-loop barge-in

- Displayed the recognised user transcript while awaiting Mabel's response.
- Prevented ambient sound from cancelling a turn during transcription or model generation.
- Restricted barge-in detection to Mabel's spoken playback.
- Removed the top horizontal divider and refreshed cached assets.

### [`ba0ca14`](https://github.com/Alyx-ML/Mabel/commit/ba0ca14a9f823a964680977edd65bf902753edda) — Show streamed voice state and reduce speech delay

- Displayed streamed answer text as it arrived.
- Began voice synthesis from shorter sentence and clause chunks.
- Improved preparation and interruption status messages.

### [`df70e2d`](https://github.com/Alyx-ML/Mabel/commit/df70e2deefcc72581f3c50927887224014c97350) — Recover stalled Gemma voice turns

- Added bounded inference and stream-idle timeouts.
- Added same-model retry handling for requests producing no visible text.
- Returned explicit streamed errors instead of leaving the UI waiting indefinitely.
- Added browser request cancellation and error handling.

### [`d67ef49`](https://github.com/Alyx-ML/Mabel/commit/d67ef4911fd230664facd426a5e492817356cfb8) — Disable Gemma thinking for voice latency

- Disabled Gemma's thinking mode in the Cloudflare request configuration.

### [`81c5adf`](https://github.com/Alyx-ML/Mabel/commit/81c5adf30a150da331a7deb2e084db572a3cb954) — Stream Gemma voice turns with adaptive VAD

- Replaced GPT-OSS-120B with Gemma 4.
- Removed blocking Groq intent triage.
- Streamed Workers AI output to the browser and synthesised speech in chunks.
- Added an AudioWorklet voice-activity detector with ambient-noise calibration and audio pre-roll.
- Improved hands-free capture, interruption, cancellation, and queued speech playback.

### [`61e9bb7`](https://github.com/Alyx-ML/Mabel/commit/61e9bb7d33336b0770f51044430980e1f9bdab05) — Animate Mabel portrait while speaking

- Added mid-mouth and open-mouth portrait frames.
- Drove frame selection from spoken-audio amplitude.
- Returned the portrait to its idle frame when speech stopped or was interrupted.

### [`4376c71`](https://github.com/Alyx-ML/Mabel/commit/4376c714604e15fad9b8fd76fef5816e08873c8c) — Replace Mabel avatar artwork

- Updated the displayed portrait asset references and cache versions.

### [`f841540`](https://github.com/Alyx-ML/Mabel/commit/f8415401f56fdb50b1ac695c0498dc8fff60b71e) — Replace avatar image

- Replaced the Mabel portrait image file with new artwork.

### [`5cc80e3`](https://github.com/Alyx-ML/Mabel/commit/5cc80e31ccf625913202def0eeb21018c5b7fb0b) — Bundle local Alba Scottish browser voice

- Selected the Alba Scottish Piper voice.
- Moved voice synthesis to the browser using Piper TTS.
- Removed reliance on an operating-system voice being installed.

### [`bc7819b`](https://github.com/Alyx-ML/Mabel/commit/bc7819bc2e4208392aa863f0d11df0efb57d1c9e) — Use local Fiona Scottish voice with zero TTS cost

- Replaced remote TTS with browser speech synthesis.
- Preferred the Fiona Scottish system voice when available.
- Removed the cloud TTS route from the Worker.

### [`749c013`](https://github.com/Alyx-ML/Mabel/commit/749c013b4be47aa62653a0be417ab9cd5a675446) — Fix active screen and accelerate voice responses

- Corrected hidden-screen styling so only the active screen appears.
- Removed slower provider routing from the response path.
- Reduced response and speech preparation delays.

### [`6503671`](https://github.com/Alyx-ML/Mabel/commit/65036718da6ec8d921490d4574de6dfa615bf487) — Make microphone permission launch observable and retryable

- Added visible permission progress and timeout guidance.
- Detected browsers without the required voice APIs.
- Added blocked-permission messaging and a retryable microphone button.

### [`37c1611`](https://github.com/Alyx-ML/Mabel/commit/37c16119a7e72f16d26c9de1e8da367e5336920d) — Replace browser recognition with Cloudflare speech transcription

- Replaced browser speech recognition with recorded microphone audio.
- Added Cloudflare Whisper Large V3 Turbo transcription.
- Preserved automatic voice capture and conversational turn handling.

### [`16dd8d5`](https://github.com/Alyx-ML/Mabel/commit/16dd8d545ea7ac149e3fefcf828a105ab16668f3) — Version Pages assets to bypass stale cache

- Added cache-version query strings to frontend scripts, styles, icons, and images.

### [`7c58b35`](https://github.com/Alyx-ML/Mabel/commit/7c58b35266fc4ab4a7e302d47c2bca3fedab3b5b) — Add Mabel portrait and natural cloud voice

- Added Mabel's portrait to the permission and conversation screens.
- Added a cloud-generated voice route and browser audio playback.
- Updated avatar styling and speaking feedback.

### [`b6eb1c6`](https://github.com/Alyx-ML/Mabel/commit/b6eb1c6b973fc7fa33845df93d17f4201128dbb8) — Enable hands-free duplex voice

- Replaced manual hold-to-talk interaction with continuous listening.
- Added automatic speech capture and end-of-utterance detection.
- Added spoken greeting, interruption, mute, and stop behaviour.
- Expanded the Worker chat and voice request handling.

### [`bdd4492`](https://github.com/Alyx-ML/Mabel/commit/bdd44920503a5dc35c0ec69bd51ca6461d720129) — Restore custom frontend implementation

- Reverted the preceding removal and restored the Mabel browser frontend files unchanged.

### [`17c2a83`](https://github.com/Alyx-ML/Mabel/commit/17c2a835ea385b26820b4089964f81e1e5c5327b) — Remove custom frontend implementation

- Temporarily removed the Mabel HTML, configuration, stylesheet, and browser script.
- This change was completely reversed by `bdd4492`.

### [`9053893`](https://github.com/Alyx-ML/Mabel/commit/905389307239278a90790b3f86e7579fae6f6a89) — Create Mabel voice companion

- Created the Mabel GitHub Pages browser interface.
- Added the central Mabel configuration and identity prompt.
- Added the initial microphone, chat, voice, and avatar implementation.
- Added the Cloudflare Worker project and Workers AI binding.
- Added the initial Mabel portrait asset.
