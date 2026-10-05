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

## 4. Variables — this is the wizard

Railway's deploy page shows a box for every **required** variable that has no value, with your
description underneath, and will not deploy until each is filled in. So the deploying teacher
types the two passwords right there, and the site works the moment it is up. Nothing else to
find or enter.

In the service's **Variables** tab, add these four. The descriptions are what the deploying
teacher sees, so they are written for them.

| Variable | Value in the template | Required? | Description to show |
|---|---|---|---|
| `ADMIN_KEY` | *(leave empty)* | **Required** | Admin password: opens /admin, where you create class rooms. Keep it to yourself. At least 16 characters. |
| `HALL_KEY` | *(leave empty)* | **Required** | Hall key: opens a hall room for the whole cohort. Give it to whoever runs the event. At least 8 characters, different from the admin password. |
| `SETUP_CODE` | `${{secret(10, "ABCDEFGHJKMNPQRSTUVWXYZ23456789")}}` | optional | Backup only. Leave as it is. |
| `ROOM_TTL_DAYS` | `14` | optional | Days an untouched room is kept. |

Railway cannot check a password's length. If someone types an admin password shorter than 16
characters, the server ignores it and falls back to the `/setup` page instead, which asks for
`SETUP_CODE` (in the same Variables tab) and lets them choose again. That backup is the only
time a setup code is ever needed.

## 5. Create and share

Click **Create Template**. Railway gives you a URL like `https://railway.com/deploy/abcd12`.

Put this button in the README, with your template's URL:

```markdown
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/deploy/abcd12)
```

To list it in Railway's public marketplace as well, use **Publish** on the template's page.

## What the deploying teacher does

1. Click **Deploy on Railway** and sign in.
2. Type an **admin password** and a **hall key** into the two boxes. Write both down.
3. Press **Deploy**, wait for it to finish, and open the site's address.
4. Open `/admin`, enter the admin password, and create a class room for each class.

If the site says it has no admin password yet, the admin password was too short. Open
`/setup` and follow the page; the code it asks for is `SETUP_CODE` in the Variables tab.

## Changing a password later

Setup only runs once. After that, set `ADMIN_KEY` or `HALL_KEY` in the Variables tab. A Railway
variable always wins over the password saved by the setup page.

To run setup again from scratch, delete `/data/keys.json` from the volume and redeploy.
