# XShow Deploy

## Fastest launch path

This repo is ready for a simple Render deploy with one web service and one persistent disk.

What this setup does:

- Hosts the Python app publicly.
- Persists `xshow.db` and uploaded videos on a mounted disk.
- Keeps your creator upload cookie secure over HTTPS.

## Before you deploy

1. Put this project in a GitHub repo.
2. Keep `.gitignore` as-is so local uploads and the local database do not get committed.
3. Decide your production creator key for `XSHOW_ADMIN_KEY`.

## Deploy on Render

1. Create a new Render Blueprint from your GitHub repo.
2. Let Render read `render.yaml`.
3. When prompted, set `XSHOW_ADMIN_KEY` to your private creator password.
4. Deploy the service.

Render will:

- Start the app with `python app.py`
- Bind it to `0.0.0.0`
- Mount persistent storage at `/opt/render/project/src/storage`
- Use `/healthz` for health checks

## Add your real domain

1. Open the Render service settings.
2. Add your custom domain.
3. Point your DNS records to the Render target.
4. Verify the domain in Render.

Render automatically provisions TLS after verification.

## Important launch note

This is the fastest MVP production path, not the final-scale architecture.

It is good for launch-week traffic, but the next upgrade should be:

- Postgres instead of SQLite
- Cloud object storage for videos instead of storing large files on the app disk

That upgrade is best when you want heavier traffic, better media durability, or multi-instance scaling.
