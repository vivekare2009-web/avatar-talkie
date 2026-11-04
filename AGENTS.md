<!-- LOVABLE:BEGIN -->
> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.
<!-- LOVABLE:END -->

- Keep companion behavior rules in browser-safe pure helpers with regression tests; calibration and touch must use the same frame coordinates.
- Keep video visibility owned by the double-buffer player, with source-load tokens and a front ref; state changes must not replace a visible frame before the next clip is ready.
- Use TanStack Start server functions for internal companion calls; preserve the current memory store while updating presentation.
- Treat entered token rates as estimates for visible text only; never present these as provider billing or workspace credits.
- Store imported character packages in browser IndexedDB and render validated GLB/GLTF/FBX with React Three Fiber; keep muted state videos as the failure fallback so a bad model cannot break C2.
- Keep camera presets/framing in browser-safe helpers and Studio controls outside the portrait canvas so mobile controls never obscure the character.
- Load Bun test declarations without Bun global runtime types; this browser/Worker app must retain the standard fetch contract.
- Keep conversation prompt, tag preparation, send admission and idle eligibility in browser-safe pure helpers; all C2 speech uses one token-owned controller so foreground check-ins cannot overlap playback.
- Persist AI denial/credit pauses in the service-only companion_ai_pause table; automatic check-ins remain parked until a fresh user request succeeds, preventing retries across restarts.
