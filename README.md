# Tarik Campara's portfolio

The personal site at [tarikcampara0.github.io](https://tarikcampara0.github.io). It's plain HTML, CSS and JavaScript with no build step.

## View it locally

Serve the folder, because the mini DeployOps can't load its database engine from a file opened directly:

```bash
python -m http.server 4173
```

## Files

- `index.html`: all the content.
- `styles.css`: colours and type sizes are defined at the top, under `:root`.
- `script.js`: the mobile menu and entrance animation.
- `demo.js`: the mini DeployOps in the "Try it yourself" section.
- `assets/`: DeployOps screenshots and one credited photograph. `credits.json` records where it came from. `vendor/` holds [sql.js](https://github.com/sql-js/sql.js) 1.10.3 (MIT), SQLite compiled for the browser.

## Keeping it accurate

The mini DeployOps in `demo.js` is a browser-sized copy of the real [DeployOps](https://github.com/tarikcampara0/DeployOps) pipeline, with its migrations, checks and failure messages written out by hand. If the real ones change, update them here too. The screenshots in `assets/` come from `DeployOps/docs/images/`.

The "How it's tested" paragraph makes specific claims, including the number of tests and that the AWS provider hasn't run in a real account. Update it when those change.

GitHub Pages publishes the `main` branch, so pushing there updates the live site.
