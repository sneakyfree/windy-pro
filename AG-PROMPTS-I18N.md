# Antigravity Prompts — Windy Pro i18n & Translation Work
## Created: 27 Feb 2026 by Kit 0C3 Charlie
## Feed these to AG in order. Each is self-contained.

---

## PROMPT 1: Complete Website i18n Translations

I'm building the Windy Pro website (windypro.thewindstorm.uk). We've added a language selector and i18n system. I need you to complete translations for additional languages in our i18n.json file.

The file lives at: `/home/sneakyfree/windy-pro/src/client/web/public/landing/i18n.json`
AND must be copied to: `/home/sneakyfree/windy-pro/src/client/web/dist/landing/i18n.json`

We already have complete translations for: en, es, fr, zh, ar, pt, de, hi

I need COMPLETE translations added for: Japanese (ja), Korean (ko), Russian (ru), Turkish (tr), Italian (it), Vietnamese (vi), Thai (th), Indonesian (id), Dutch (nl), Polish (pl)

Use the English (en) keys as your template — there are about 60 keys covering nav, hero, features, translate section, compare, download, and footer. Translate ALL keys for each language.

Rules:
- Natural/native-sounding translations — NOT literal Google Translate quality
- Adapt marketing tone for each culture
- Keep product names UNTRANSLATED: "Windy Pro", "WindyTune", "Windy Translate", "Green Strobe"
- Keep prices in USD ($79, $8.99/mo)
- Arabic is already RTL-handled in the CSS

Read the existing i18n.json file, add the new languages, write the updated file back, and copy to dist.

---

## PROMPT 2: Wizard i18n System

The Windy Pro installation wizard is at: `/home/sneakyfree/windy-pro/installer-v2/screens/wizard.html`

It's a single-page Electron wizard with 9 screens. All text is currently in English. I need to internationalize it.

Requirements:
1. Create `/home/sneakyfree/windy-pro/installer-v2/wizard-i18n.json` with translations
2. The wizard receives a `?lang=` URL parameter from the website
3. All user-visible text should get `data-i18n` attributes
4. The wizard should display in the user's selected language
5. Start with: English (en), Spanish (es), French (fr), Chinese (zh), Arabic (ar), Portuguese (pt), German (de)

The 9 wizard screens contain these user-visible strings to translate:

**Screen 0 - Welcome:**
- "Welcome to Windy Pro"
- "Push a button. Talk. Your words appear."
- "15 proprietary voice engines"
- "Handcrafted for accuracy"
- "One-time purchase, yours forever"
- "No subscriptions. No cloud. No compromises."
- "Get Started 🌪️"
- Quote attribution text

**Screen 1 - Hardware Scan:**
- "Scanning Your Hardware"
- "Processor", "Memory", "Graphics Card", "Storage", "Network Speed", "Power Source"
- "Scan Complete!" / various status messages
- "Continue →" / "← Back"

**Screen 2 - Account:**
- "Your Account"
- "Sign In", "Create Account", "Try Free Tier"
- Email/password labels
- "5-device limit" notice
- Error/success messages

**Screen 3 - Language Profiling:**
- "Your Languages"
- "What languages do you speak day-to-day?"
- "This helps us pick the best engines for you."
- Search placeholder: "Type to search languages..."
- "⭐ Popular" / "🌍 All Languages" headers
- "+ Add" / "✅ Added" labels
- "⚖️ Equal Split" / "🗑️ Clear All" buttons
- "Why we ask" info box text
- "Select at least 1 language →" / "Continue with X languages →"

**Screen 4 - Translation Upsell:**
- "You Speak X Languages!"
- "Unlock real-time conversation translation"
- Feature labels: "100% Offline", "Private Forever", "Sub-Second"
- Pricing: "Try it monthly" / "Own it forever"
- "⭐ BEST VALUE — Save 60%"
- "Pay once. Translate forever."
- "Cancel anytime. No commitment."
- Competitor names stay in English
- "Maybe later — I can add this from Settings"

**Screen 5 - Learn:**
- "Meet Your 15 Voice Engines"
- "Lighter Engines" / "Heavier Engines"
- Family descriptions: "Windy Core", "Windy Edge", "Windy Lingua"
- Table headers: "Fit", "Engine", "Family", "Size", "Speed", "Needs", "Strength"
- FAQ questions and answers
- "YOUR MACHINE:" label
- "runs great" / "tight fit" / "won't run" labels

**Screen 6 - Choose:**
- "Choose Your Engines"
- Package names: "Light", "Optimal/Recommended", "Power User"
- "Install Selected →"
- Engine count labels

**Screen 7 - Download/Install:**
- "Installing Windy Pro..."
- Progress labels: "Downloading...", "Installing...", "Verifying..."
- Brand cards (the rotating fun facts — translate these too)
- "models" → "engines" everywhere

**Screen 8 - Complete:**
- "You're Ready! 🌪️"
- Shortcut labels and descriptions
- "What's Next" items
- "Launch Windy Pro 🚀"

For each language, provide ALL strings translated. Return:
1. The complete wizard-i18n.json file
2. A JavaScript function to add to wizard.html that: reads ?lang= param, loads the JSON, applies translations to all data-i18n elements
3. Instructions for which HTML elements need data-i18n attributes (can be done as a sed script or manual list)

---

## PROMPT 3: Add Missing Languages to Language Picker (reach 99)

The Windy Pro installation wizard has a language picker with 68 languages. We need to expand to 99.

The existing languages are defined in the SUPPORTED_LANGUAGES array in:
`/home/sneakyfree/windy-pro/installer-v2/screens/wizard.html`

Read the file, find the SUPPORTED_LANGUAGES array, and add 31 more languages to reach 99 total.

For each new language provide:
- code: ISO 639-1 code
- name: English name  
- native: Name in native script
- flag: Flag emoji (use country most associated with the language)
- popular: true/false (true only for top-20 most spoken languages)

Prioritize by global speaker count. Languages NOT to duplicate (already in the list): en, es, fr, de, pt, it, zh, zh-tw, ja, ko, ar, hi, ru, tr, vi, th, nl, pl, sv, no, da, fi, id, ms, tl, uk, cs, ro, hu, el, he, fa, ur, bn, ta, te, sw, am, ha, yo, ig, zu, af, ca, eu, bg, hr, sk, sl, lt, lv, et, ka, hy, az, kk, uz, mn, my, km, lo, ne, si, ml, kn, mr, gu, pa.

Write the updated SUPPORTED_LANGUAGES array back into wizard.html.

---

## PROMPT 4: DNA Strand Master Plan Update — i18n Strand

Update `/home/sneakyfree/windy-pro/DNA_STRAND_MASTER_PLAN.md` to add Strand G: Internationalization.

Read the file first to understand the existing format (Strands A through F exist).

Add:

### Strand G: Internationalization (i18n)
- **G1:** Website i18n — auto-detect via navigator.language, language selector in nav, i18n.json translation files, RTL support for Arabic/Hebrew/Urdu/Persian, localStorage persistence
- **G2:** Wizard i18n — URL param passthrough (?lang=), all 9 screens translated, language-aware engine recommendations
- **G3:** In-App i18n — Windy Pro desktop app UI in user's language (future)
- **G4:** Translation Pipeline — how we maintain translations for 12+ website languages and 7+ wizard languages. Tooling, CI validation, community contribution workflow.
- **G5:** Language Chain Architecture — website language → ?lang= URL param → wizard language → pre-selected primary language → app settings. One continuous experience.

Also update Strand F to add:
- **F4:** Wizard i18n integration

Key decisions to document:
- "Engines" not "models" in all user-facing text (decided 27 Feb 2026)
- $8.99/mo monthly option alongside $79 one-time for Translate (decided 27 Feb 2026)
- Website auto-detects language from browser, user can override, choice persists
- 12 languages on website, 7 in wizard (expanding to match)

Version bump to 1.4.0. Add changelog entries crediting Kit 0C3 Charlie + Grant.

---

## NOTES FOR AG:
- The website serves from BOTH public/landing/ AND dist/landing/ — update BOTH
- The wizard is at installer-v2/screens/wizard.html — it's a HUGE file (~130KB), be careful with edits
- All "models" in user-facing text should say "engines" instead
- Product names never translated: Windy Pro, WindyTune, Windy Translate, Green Strobe
- The terminology standard table is at the top of the DNA plan — respect it
