# Character-first C2 rebuild

## Build
- Fix the current test/type error and make memory load a required readiness gate, preserving all saved data and per-user isolation.
- Inspect the supplied character archive. If a `.blend` can be converted here, export a textured GLB and render it as the primary C2 surface; otherwise keep the existing muted state videos as an explicit fallback without overstating model support.
- Rework the first screen around the character with compact Browser, Chat, Memory, and Setup controls; keep chat as a face-safe glass overlay and Browser as a full-height in-app sheet.
- Route typed and spoken input through one structured command path, with safe URL validation, honest embed/playback outcomes, and visible execution status.
- Harden THINKING, TALKING, transient reactions, session greeting, recognition, audio, browser listeners, and stale async cleanup.

## Technical details
- Use React Three Fiber only for a validated GLB/GLTF; `.blend` is never loaded in the browser.
- Keep the double-buffered, permanently muted video player as fallback for unsupported or failed 3D states.
- Keep existing server-side memory storage and Hinglish behavior; add backend/load/operation diagnostics without clearing on startup.
- Add regression tests for memory readiness, command safety/routing, greeting timing, and state reset rules.

## Verification
- Run focused tests and TypeScript checks, inspect the current build signal, and exercise memory, browser commands, state recovery, and 320/390/430px layouts in the live preview.
- Report the exact model/conversion result, browser embedding limitations, and any unavailable external capability.
