# Tarik Campara's portfolio

The personal site at [tarikcampara0.github.io](https://tarikcampara0.github.io). It's plain HTML, CSS and JavaScript with no build step.

## View it locally

Open `index.html` in a browser, or serve the folder:

```bash
python -m http.server 4173
```

## Files

- `index.html`: all the content.
- `styles.css`: colours and type sizes are defined at the top, under `:root`.
- `script.js`: the mobile menu, entrance animation and the deployment replay.
- `assets/`: DeployOps screenshots and one credited photograph. `credits.json` records where it came from.

## Keeping it accurate

The "Run a deployment" section in `script.js` replays logs recorded from the real [DeployOps](https://github.com/tarikcampara0/DeployOps) pipeline. If the pipeline's steps or messages change, record them again from `GET /api/v1/deployments/{id}/logs`. The screenshots in `assets/` come from `DeployOps/docs/images/`.

The "How it's tested" paragraph makes specific claims, including the number of tests and that the AWS provider hasn't run in a real account. Update it when those change.

GitHub Pages publishes the `main` branch, so pushing there updates the live site.
