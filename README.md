# Avatar Talkie

Build a working, testable C2 AI companion web app inspired by the user's existing React/TypeScript project. This is not a static mockup. The existing source architecture includes React/Vite, @google/genai, Express server, src/components/avatar/AvatarVideoPlayer.tsx, AvatarTouchLayer.tsx, AvatarVideoStateManager.ts, src/memory/MemoryManager.ts, src/modules/LiveSession.ts, AudioStreamer.ts, AudioPlayer.ts, src/config/voiceConfig.ts and GPT-SoVITS provider. Preserve the architecture where practical and make the implementation easy to integrate with those source files. The source archive could not be attached into this Lovable run, so do not claim you imported its exact files. Build a functional app and clearly note where the original assets need to be uploaded.

Priority 1 — avatar video animation: build a reliable state machine IDLE, THINKING, TALKING, UPSET, PERSONAL_BOUNDARY. Idle loops; thinking shows while generating a response; talking shows only while AI voice output is actually speaking; temporary upset/boundary states return safely to idle/previous appropriate state. Create a prominent 9:16 avatar video area with explicit asset mapping and settings to upload/select the five files: Character_idle_loop_animation_20260919112236.mp4, thinking.mp4, talking.mp4, upset.mp4, personal boundaries.mp4. Do not substitute generated still photos for the actual video character. If assets aren't present, show an honest upload/configuration state rather than fake animation. Fix source switching, load/error handling, stale play promises, double-buffer races, cleanup and blank-frame flicker. ALL video elements must always be muted=true, volume=0 and defaultMuted=true, including after source changes. Video audio must never play; only the selected voice engine may speak.

Priority 2 — Hindi/Hinglish: C2 must answer in Hindi/Hinglish when user speaks/writes Hindi/Hinglish, and English only when the user uses English or explicitly asks for English. Default preferred language to Hinglish/Hindi with a setting to change it. Improve Romanized Hindi, Devanagari and mixed Hinglish handling, rather than a handful of keywords. Apply language instructions to Gemini prompts, fallback responses, chat UI and TTS routing. Do not misroute Romanized Hinglish to English by default. Use configured Gemini voice if available and keep GPT-SoVITS optional, clearly showing when it is not configured.

Priority 3 — persistent memory: implement actual save, retrieve, update, forget and clear operations with per-user isolation and persistence across refresh/restart. If no cloud database is configured, use safe server-side persistence. Never say a memory was saved/deleted unless the write succeeded. Add a visible memory panel, explicit controls and an easy memory test. Do not mix users' memories.

Priority 4 — stability: prevent duplicate live connections, leaked listeners, overlapping voice playback, unhandled promises, reconnect loops and React effect cleanup bugs. Handle microphone permissions, missing/invalid API key, quota/rate limits, offline voice provider and connection drops with recoverable error messages. Never expose secrets in client logs. Keep user-controlled connect/disconnect and mute controls.

Touch interaction: configurable touch overlay. Protected zones remain disabled until user explicitly enables/configures them in settings. Touching an enabled protected zone plays personal boundaries.mp4 muted once with cooldown; ordinary taps must not trigger it. Include adjustable zone positions and cooldown; never make the entire avatar a protected zone by default.

Design: polished, mobile-first Android-friendly companion interface with prominent video avatar, chat, mic/connect controls, connection and voice status, memory/settings panels and diagnostics. Preserve useful functions; avoid unnecessary dependencies.

Quality gates: run available TypeScript/build checks and fix failures. Include diagnostics/test actions for video loading/state changes, language detection, memory persistence and connection cleanup. Never claim checks passed unless actually run. Deliver a live preview URL and state clearly that the five original video assets and Gemini/GPT-SoVITS credentials must be configured if not included.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://avatar-talkie.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/3f01d7e7-d199-4199-a36f-744d5f1197ab).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
