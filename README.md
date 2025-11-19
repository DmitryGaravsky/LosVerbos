# Los Verbos

[Los Verbos](https://dmitrygaravsky.github.io/LosVerbos/) is a mobile-friendly Spanish verb conjugation trainer with bilingual prompts and offline support.

## Using The Trainer

- Pick any verb from the selector to load its conjugations and example sentences.
- Review the highlighted tense badge, read the contextual sentence in Spanish, and check the Russian/English hints.
- Use the suggestion buttons to compare alternative conjugations; on touch devices you can double-tap to confirm quickly.

## Install As A PWA

- On iOS (Safari) choose **Share → Add to Home Screen** for a standalone experience.
- On Android (Chrome) tap **⋮ → Install App** to pin the trainer with offline access.

## Local Development

- Run `npm run build` to generate the single-file bundle under `dist/`.
- Serve the `dist/` folder with any static file server (or use VS Code Live Server) to test manifest and service worker behaviour locally.
