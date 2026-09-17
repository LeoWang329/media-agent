# 6c8644d9-79d5-4ae6-a2fd-5f3343d71b42 implementation handoff

This archive is the source of truth for turning the design into production code. Start from `index.html`, then preserve the visual system, responsive behavior, and interactions found in the exported files.

## Implementation target
- Build production UI from the exported design, not a loose reinterpretation.
- Preserve typography scale, spacing rhythm, color tokens, border radii, shadows, motion timing, and component states.
- Replace static placeholders only when the target app has real data or functional equivalents.
- Keep generated product UI free of Open Design chrome, preview labels, or design-process annotations.
- Treat this handoff as a visual contract: if implementation choices conflict, match the exported pixels and behavior first, then refactor internals.

## Source map
- Primary entry: `index.html`
- HTML screens detected: 5
- Stylesheets detected: 2
- Script/component files detected: 7
- Supporting assets detected: 67

## Responsive contract
Validate the implementation across this 2025–2026 viewport matrix:
- Mobile compact: 360×800
- Mobile standard: 390×844
- Mobile large: 430×932
- Foldable / small tablet: 600×960
- Tablet portrait: 820×1180
- Tablet landscape: 1024×768
- Laptop: 1366×768
- Desktop: 1440×900
- Wide desktop: 1920×1080

For responsive web exports, treat these as a modern breakpoint system for one adaptive web experience, not three fixed screenshots. Do not split responsive web into unrelated native app screens unless the project explicitly includes native targets. Use semantic layout thresholds, fluid `clamp()` type/spacing, and container queries where component width matters more than viewport width. Preserve any CSS media queries, container queries, fluid `clamp()` scales, and layout changes already present in the exported files.

## Design fidelity contract
- Extract reusable tokens before writing components: background, surface, foreground, muted text, border, accent, radius, shadow, spacing, type scale, and motion duration/easing.
- Map product screens, in-app modules/components, optional landing page, and optional OS widget surfaces before coding. Keep these surfaces separate in the target architecture.
- Match layout geometry: max-widths, gutters, grid columns, card proportions, sticky/fixed elements, and viewport-specific navigation.
- Preserve real copy, labels, and data shown in the export. Do not replace specific text with generic marketing filler.
- Preserve interactive affordances: hover, focus, pressed, disabled, loading, validation, copy/share, tab/accordion, modal/sheet, and keyboard states where present.
- Preserve accessibility semantics when converting: headings stay hierarchical, controls remain buttons/links/inputs, focus states stay visible.
- Do not keep prototype-only annotations, frame labels, or Open Design chrome in the production UI.

## CJX-ready UX contract
- Use `DESIGN-MANIFEST.json` as the machine-readable map for screens, app modules, OS widgets, landing pages, tokens, interactions, and viewport checks.
- Screen-file-first: when multiple user-facing surfaces exist, implement each HTML screen as its own route/file. Treat `index.html` as a launcher/overview when the manifest marks it that way, not as a combined final UI.
- If `landing.html`, app screens, platform screens, or OS widget files exist, preserve those boundaries in the target app instead of merging them into one page.
- A single self-contained `index.html` is acceptable only when the export truly contains one user-facing screen and its CSS/JS are structured enough to extract tokens, components, states, and behavior.
- If separate `css/` or `js/` files exist, treat them as source of truth for token/component/interactions before porting to React, Vue, SwiftUI, Compose, or another target stack.
- In-app modules/components are product UI blocks inside the app. OS widgets are home-screen/lock-screen/quick-access surfaces outside the app. Do not merge those concepts.

## Color and brand contract
- Use the exported design tokens and product/domain context as the color source of truth.
- Do not introduce warm beige / cream / peach / pink / orange-brown background washes unless they are already explicit brand/reference colors in the export.
- A stylesheet or design/token file was detected; inspect it for canonical color variables before choosing framework theme tokens.

## Implementation sequence for AI coding tools
1. Open `index.html` and `DESIGN-MANIFEST.json`; identify every screen file, launcher/overview file, app module, and interaction before coding.
2. If multiple HTML screens exist, map them to separate routes/surfaces first; do not merge `landing.html`, product app screens, platform screens, or OS widgets into one route.
3. Extract a token table from CSS/root styles and inline styles before building framework components.
4. Build product screens and domain-specific in-app modules from largest layout regions down to controls; avoid starting with isolated atoms that lose spatial intent.
5. Port responsive behavior across the modern viewport matrix and test each semantic breakpoint before cleanup.
6. Port interactions and states, then replace static placeholders only with real app data or functional equivalents.
7. Keep optional landing page and OS widget surfaces as separate surfaces if present.
8. Compare final screenshots against the export at 360×800, 390×844, 430×932, 820×1180, 1024×768, 1366×768, 1440×900, and 1920×1080 before declaring done.

## Entry points
- `canvas.html`
- `home.html`
- `index.html`
- `settings.html`
- `setup.html`

## Styles
- `shared/app.css`
- `shared/canvas.css`

## Scripts/components
- `shared/app.js`
- `shared/canvas-data.js`
- `shared/canvas-graph.js`
- `shared/canvas-overlays.js`
- `shared/canvas-panel.js`
- `shared/model-form.js`
- `shared/prompts-data.js`

## Assets and supporting files
- `img/blue-crossing.jpg`
- `img/gen/a1-heroine-portrait.jpg`
- `img/gen/a2-heroine-back.jpg`
- `img/gen/a3-neon-alley.jpg`
- `img/gen/a4-sodium-lamp.jpg`
- `img/gen/a5-red-lanterns.jpg`
- `img/gen/a6-convenience-store.jpg`
- `img/gen/a7-umbrella-drops.jpg`
- `img/gen/a8-heroine-turn.jpg`
- `img/gen/a9-home-windows.jpg`
- `img/gen/b1-samoyed-cafe.jpg`
- `img/gen/b2-watch-product.jpg`
- `img/gen/b3-cat-fridge.jpg`
- `img/gen/b4-night-runner.jpg`
- `img/gen/b5-grandma-kitchen.jpg`
- `img/gen/b6-paper-plane-subway.jpg`
- `img/gen/b7-snow-suv.jpg`
- `img/gen/b8-graduation.jpg`
- `img/gen/b9-fireworks-river.jpg`
- `img/gen/c1-puddle-step.jpg`
- `img/gen/c2-taxi-rain.jpg`
- `img/gen/c3-bus-stop.jpg`
- `img/gen/c4-crosswalk-top.jpg`
- `img/gen/c5-window-drops.jpg`
- `img/gen/c6-noodle-stall.jpg`
- `img/gen/c7-subway-entrance.jpg`
- `img/gen/c8-lamp-silhouette.jpg`
- `img/gen/c9-scarf-closeup.jpg`
- `img/gen/sheet-a.png`
- `img/gen/sheet-b.png`
- `img/gen/sheet-c.png`
- `img/girl-plaid-bw.jpg`
- `img/girl-plaid-umbrella.jpg`
- `img/lamp-blue.jpg`
- `img/lamp-harbor.jpg`
- `img/lamp-sodium.jpg`
- `img/neon-alley.jpg`
- `img/red-lanterns.jpg`
- `img/shopping-street.jpg`
- `img/sign-tower.jpg`
- `img/umbrella-red.jpg`
- `img/walker-clear-umbrella.jpg`
- `img/wet-street.jpg`
- `plugin-source/skill-plugin-mu49fzp8/open-design.json`
- `plugin-source/skill-plugin-mu49fzp8/references/provenance.json`
- `plugin-source/skill-plugin-mu49fzp8/references/source-1-design-direction.md`
- `plugin-source/skill-plugin-mu49fzp8/SKILL.md`
- `plugin-source/skill-plugin-mu49g20l/open-design.json`
- `plugin-source/skill-plugin-mu49g20l/references/provenance.json`
- `plugin-source/skill-plugin-mu49g20l/references/source-1-design-direction.md`
- `plugin-source/skill-plugin-mu49g20l/SKILL.md`
- `plugin-source/skill-plugin-mu49g2pr/open-design.json`
- `plugin-source/skill-plugin-mu49g2pr/references/provenance.json`
- `plugin-source/skill-plugin-mu49g2pr/references/source-1-design-direction.md`
- `plugin-source/skill-plugin-mu49g2pr/SKILL.md`
- `review/after-canvas-1440.jpg`
- `review/after-canvas-390-drawer.jpg`
- `review/before-canvas-1440.jpg`
- `review/before-canvas-390-drawer.jpg`
- `review/before-canvas-390-graph.jpg`
- `review/before-home-1440.jpg`
- `review/before-upload-list.jpg`
- `review/design-direction.md`
- `review/fix-edges-1440.jpg`
- `review/step1-canvas-1440-dark.jpg`
- `review/step1-canvas-1440-light.jpg`
- `review/step1-canvas-390-drawer.jpg`

## Coding checklist for AI tools
1. Inspect `index.html` and `DESIGN-MANIFEST.json` first and identify reusable components before coding.
2. Implement each user-facing screen file as its own route/surface; keep launcher, landing, app, platform, and OS widget files separate.
3. Extract design tokens into the target stack: colors, type scale, spacing, radius, shadows, and motion.
4. Implement layout with real 2025–2026 responsive breakpoints, fluid type/spacing, and container-query-aware component behavior; test with no horizontal overflow.
5. Preserve interactive controls, hover/focus/pressed states, form behavior, validation, and copy actions where present.
6. Implement domain-specific in-app modules with real states; do not flatten them into generic cards.
7. Keep landing page, product screens, and OS widget/quick-access surfaces separate when present.
8. Confirm the production result visually matches the exported design before refactoring internals.
9. Reject implementation shortcuts that flatten the design into generic cards, generic gradients, placeholder stats, or framework-default typography.
10. If a detail is ambiguous, keep the exported HTML/CSS/JS behavior rather than inventing a new pattern.
