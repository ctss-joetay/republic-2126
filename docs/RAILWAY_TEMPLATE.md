# Republic 2126 as a Railway template

This is how to turn the repo into a one-click **Deploy on Railway** template that any school can
use. A school that deploys it gets its own copy of the game, with its own rooms and its own
passwords. Nothing is shared with any other school.

Railway builds templates in its dashboard, not from a file in the repo, so this is a set of
dashboard steps. You only do it once.

## Before you start

- The template must point at a **public** GitHub repo, or other schools' Railway accounts cannot
  read the code.
- Nothing in `main` depends on a particular domain. QR codes and links are built from whatever
  address the page was opened on.

## 1. Create the template

1. In Railway, open **Workspace settings → Templates → New Template**.
2. **Add New → GitHub Repo**, and paste the public repo's URL. Add `/tree/main` to the end to pin
   the branch.
3. Name the service `republic-2126`.

## 2. Service settings

In the service's **Settings** tab:

| Setting | Value | Why |
|---|---|---|
| Public networking | **Generate domain** (HTTP) | Teachers and students need a URL |
| Healthcheck path | `/health` | Railway waits for the server before switching traffic |
| Replicas | **1** | Rooms live in one process's memory; two replicas would split them |
| Start command | leave blank | `railway.json` already sets `node server.js` |

## 3. Volume

Right-click the service → **Attach Volume**, mount path **`/data`**.

The server saves every room and the passwords from the setup page to `/data`. Without a volume,
both are lost on every redeploy, and the school would have to run setup again.

## 4. Variables

In the service's **Variables** tab, add these four. The descriptions are what the deploying
teacher sees, so they are written for them.

| Variable | Default value | Description to show |
|---|---|---|
| `SETUP_CODE` | `${{secret(10, "ABCDEFGHJKMNPQRSTUVWXYZ23456789")}}` | One-time code for the /setup page. Leave as it is. |
| `ADMIN_KEY` | *(leave empty, mark optional)* | Leave blank to choose it on the /setup page. At least 16 characters. |
| `HALL_KEY` | *(leave empty, mark optional)* | Leave blank to choose it on the /setup page. At least 8 characters. |
| `ROOM_TTL_DAYS` | `14` | Days an untouched room is kept. |

`SETUP_CODE` is generated fresh for every deploy, so no two schools share one. It only works
while no admin password exists. Once setup is done it does nothing.

## 5. Create and share

Click **Create Template**. Railway gives you a URL like `https://railway.com/deploy/abcd12`.

Put this button in the README, with your template's URL:

```markdown
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/abcd12)
```

To list it in Railway's public marketplace as well, use **Publish** on the template's page.

## What the deploying teacher does

1. Click **Deploy on Railway**, sign in, and press **Deploy**. Leave the passwords blank.
2. When it finishes, open the service's **Variables** tab and copy `SETUP_CODE`.
   (It is also printed in the deploy log, under `SETUP CODE:`.)
3. Open `https://<their-domain>/setup`, paste the code, and choose or generate the admin password
   and hall key. Write both down.
4. Open `/admin` and create a class room for each class.

## Changing a password later

Setup only runs once. After that, set `ADMIN_KEY` or `HALL_KEY` in the Variables tab. A Railway
variable always wins over the password saved by the setup page.

To run setup again from scratch, delete `/data/keys.json` from the volume and redeploy.
