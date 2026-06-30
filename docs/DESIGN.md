---
name: Singularity Scanner Design System
colors:
  surface: '#131315'
  surface-dim: '#131315'
  surface-bright: '#39393b'
  surface-container-lowest: '#0e0e10'
  surface-container-low: '#1c1b1d'
  surface-container: '#201f22'
  surface-container-high: '#2a2a2c'
  surface-container-highest: '#353437'
  on-surface: '#e5e1e4'
  on-surface-variant: '#bbcabe'
  inverse-surface: '#e5e1e4'
  inverse-on-surface: '#313032'
  outline: '#869489'
  outline-variant: '#3d4a41'
  surface-tint: '#51df9c'
  primary: '#60eca8'
  on-primary: '#003822'
  primary-container: '#3ecf8e'
  on-primary-container: '#005434'
  inverse-primary: '#006c45'
  secondary: '#b3ccc0'
  on-secondary: '#1f352d'
  secondary-container: '#354b42'
  on-secondary-container: '#a2bbaf'
  tertiary: '#ffc7ae'
  on-tertiary: '#561f00'
  tertiary-container: '#ffa072'
  on-tertiary-container: '#78350f'
  error: '#ffb4ab'
  on-error: '#690005'
  error-container: '#93000a'
  on-error-container: '#ffdad6'
  primary-fixed: '#71fcb6'
  primary-fixed-dim: '#51df9c'
  on-primary-fixed: '#002112'
  on-primary-fixed-variant: '#005233'
  secondary-fixed: '#cfe8dc'
  secondary-fixed-dim: '#b3ccc0'
  on-secondary-fixed: '#091f18'
  on-secondary-fixed-variant: '#354b42'
  tertiary-fixed: '#ffdbcc'
  tertiary-fixed-dim: '#ffb694'
  on-tertiary-fixed: '#351000'
  on-tertiary-fixed-variant: '#76330d'
  background: '#131315'
  on-background: '#e5e1e4'
  surface-variant: '#353437'
  zinc-950: '#09090b'
  zinc-800: '#27272a'
  emerald-glow: rgba(62, 207, 142, 0.15)
  terminal-gray: '#71717a'
typography:
  display-lg:
    fontFamily: Geist
    fontSize: 64px
    fontWeight: '700'
    lineHeight: 72px
    letterSpacing: -0.02em
  display-lg-mobile:
    fontFamily: Geist
    fontSize: 40px
    fontWeight: '700'
    lineHeight: 48px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Geist
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.01em
  body-base:
    fontFamily: Geist
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  mono-code:
    fontFamily: JetBrains Mono
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  label-caps:
    fontFamily: Geist
    fontSize: 12px
    fontWeight: '600'
    lineHeight: 16px
    letterSpacing: 0.05em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  grid-unit: 8px
  container-max: 1280px
  gutter: 24px
  margin-mobile: 16px
---

## Brand & Style
The brand personality is high-precision, technical, and forward-leaning. It targets developers and AI engineers who value performance and transparency. This design system evokes a sense of "observing the machine"—a window into complex AI processes that feels both advanced and under control.

The visual style is **Modern Technical Minimalism** with heavy influences from **Glassmorphism**. It utilizes a deep Zinc-950 base to ground the UI, allowing high-vibrancy Emerald accents to serve as functional signals and focal points. Grid patterns and subtle glowing indicators create a sense of digital infrastructure and real-time computation.

## Colors
The palette is dominated by `Zinc-950` to create a "true dark" environment that reduces eye strain and emphasizes technical data. 

- **Primary Emerald (#3ecf8e):** Used exclusively for primary actions, success states, and active status indicators.
- **Secondary Sage/Gray (#637a70):** Used for inactive states, borders, and secondary text to provide depth without competing with the primary emerald.
- **Surface Layering:** Backgrounds should utilize the `zinc-950` base, while cards and containers use a slightly elevated `zinc-900` or a semi-transparent glass effect.
- **Glows:** Apply the `emerald-glow` as a soft backdrop blur behind key graphics or active "live" components to simulate high-energy computing.

## Typography
Typography is split between **Geist** for the narrative and interface elements, and **JetBrains Mono** for all data-driven or "output" content.

- **Geist:** Used for headlines and body copy. Keep tracking tight on large headlines to maintain a modern, sleek feel.
- **JetBrains Mono:** Used for timestamps, hash values, terminal outputs, and numerical metrics. This font signals "truth" and technical accuracy.
- **Visual Hierarchy:** Use `label-caps` for section headers (e.g., "SYSTEM STATUS") to create a clear structural skeleton for the landing page.

## Layout & Spacing
The layout uses a **Fixed Grid** system for desktop, centered within the viewport, and transitions to a fluid single-column for mobile.

- **Grid:** A 12-column grid with a subtle background "blueprint" line pattern (Zinc-900) visible behind the content.
- **Rhythm:** All spacing (padding, margins, gaps) should be multiples of the 8px `grid-unit`.
- **Sections:** Large vertical gaps (120px - 160px) should separate major landing page features to allow the "dark" aesthetic to breathe and prevent visual clutter.

## Elevation & Depth
Depth in this system is achieved through **Tonal Layers** and **Glassmorphism**, rather than traditional shadows.

- **Surfaces:** Use 1px borders (#27272a) on containers instead of heavy shadows. 
- **Glass Effect:** For modals or floating cards, use a `backdrop-filter: blur(12px)` with a semi-transparent Zinc-900 fill.
- **Glow Elements:** Small, high-intensity blurs (10px-20px) behind primary emerald icons create a "status light" effect that suggests the UI is powered on and active.

## Shapes
The shape language is **Soft (0.25rem)**. This provides a professional, geometric feel that avoids the "playfulness" of highly rounded corners while remaining more accessible than sharp 0px edges. 

Buttons and input fields should strictly follow the `rounded` (4px) scale. Larger containers (cards) may use `rounded-lg` (8px) for better visual framing.

## Components
- **Buttons:**
    - *Primary:* Solid Emerald (#3ecf8e) with black text. No shadow, but a subtle outer emerald glow on hover.
    - *Ghost:* 1px border of Zinc-800, text in White.
- **Chips / Badges:** Small, rectangular badges with JetBrains Mono text. For status indicators, include a small 6px circular "LED" dot next to the text.
- **Input Fields:** Deep Zinc-950 background with a 1px Zinc-800 border. On focus, the border transitions to Emerald with a 2px outer glow.
- **Cards:** Use a semi-transparent "glass" background. Headers within cards should be separated by a 1px horizontal rule.
- **Terminal Component:** A dedicated container with a #000 background, 1px border, and JetBrains Mono text. Include "Traffic Light" controls in the top-left to mimic a MacOS terminal window.
- **Status Indicators:** Use pulsing animations for "Active" states, utilizing the Primary Emerald color with a CSS pulse effect to denote real-time scanning.