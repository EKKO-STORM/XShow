# XShow

XShow is a trailer-first video website for AI-made cinematic releases. It includes:

- A dynamic homepage with a featured trailer stage
- Dedicated watch pages for each trailer
- Category and tag organization
- A private creator upload flow

## Local run

Start the app:

```bash
python3 app.py
```

Or choose a custom port:

```bash
python3 app.py 8765
```

Open the site in your browser and use the creator key to unlock uploads.

Default local creator key:

```bash
xshow-director
```

## Important environment variables

- `PORT`: server port
- `HOST`: bind host
- `XSHOW_ADMIN_KEY`: private creator access key
- `XSHOW_SESSION_SECRET`: session signing secret
- `XSHOW_SESSION_COOKIE_SECURE`: set to `true` in production
- `XSHOW_STORAGE_DIR`: shared storage root for production
- `XSHOW_DATA_DIR`: optional custom database directory
- `XSHOW_UPLOAD_DIR`: optional custom upload directory
- `XSHOW_DB_PATH`: optional custom database path

## Deploy

This repo includes a ready-to-use Render blueprint in [render.yaml](./render.yaml).

Quick deployment steps are in [DEPLOY.md](./DEPLOY.md).

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/EKKO-STORM/XShow)

## Production note

The current launch setup is optimized for speed:

- App server on Render
- SQLite on a persistent disk
- Uploaded videos on the same persistent disk

That is good for launch week. The next upgrade path is:

- Render Postgres for metadata
- Cloudflare R2 for video storage
