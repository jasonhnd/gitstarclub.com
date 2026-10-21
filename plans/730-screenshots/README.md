# Weekly source note screenshots

The same synthetic two-repository weekly page is server-rendered in English and
Japanese, then captured in headless Playwright Chromium at 1440 and 390 pixels.
One row represents imported history and the other an existing observation.
Before uses the legacy whole-period provenance object; after adds the new mixed
scope. The legacy rendering is unchanged by the new reader. Both captures use
the repository's PostCSS/Tailwind stylesheet, light mode and reduced motion.
All browser network requests are blocked. These are local presentation evidence,
not live-data, hydration or owner acceptance.

| Locale / width | Before | After |
| --- | --- | --- |
| English / 1440 | [Before](en-1440-before.png) | [After](en-1440-after.png) |
| English / 390 | [Before](en-390-before.png) | [After](en-390-after.png) |
| Japanese / 1440 | [Before](ja-1440-before.png) | [After](ja-1440-after.png) |
| Japanese / 390 | [Before](ja-390-before.png) | [After](ja-390-after.png) |

All eight captures report no document-level horizontal overflow. The longer
mixed note wraps within the existing note paragraph and adds no new UI element.
