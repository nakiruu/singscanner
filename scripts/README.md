# Deployment

Single Debian 12 LXC running **Postgres + Node 24 + the app**, fronted by Nginx Proxy Manager for TLS + domain routing.

## First-time bootstrap

On a fresh Debian LXC, as **root**:

```bash
curl -fsSL https://raw.githubusercontent.com/nakiruu/singscanner/main/scripts/init-lxc.sh -o init-lxc.sh
chmod +x init-lxc.sh
./init-lxc.sh
```

The script is idempotent. It will:

1. Install Postgres, Node 24, git, build-essential.
2. Create the `singscanner` system user.
3. Create the Postgres role + database (generates a random password and prints it once).
4. Clone the repo to `/opt/singscanner`.
5. Write `.env` with `DATABASE_URL=postgresql://...@127.0.0.1:5432/...` and a fresh `NEXTAUTH_SECRET`.
6. `npm ci`, `prisma migrate deploy`, `npm run build`.
7. Install + enable the systemd unit (`/etc/systemd/system/singscanner.service`).
8. Grant `singscanner` passwordless `systemctl restart singscanner` (for `deploy.sh`).
9. Smoke-test `/api/status` before exiting.

**Save the printed Postgres password.** It's only shown once and is also written into `.env`.

### Env overrides

```bash
INSTALL_DIR=/srv/singscanner \
DB_NAME=sing_prod \
BRANCH=main \
./init-lxc.sh
```

Available: `REPO_URL`, `BRANCH`, `INSTALL_DIR`, `SERVICE_USER`, `DB_NAME`, `DB_USER`, `DB_PASS`.

## Nginx Proxy Manager

Add a proxy host:

- **Domain:** `singscanner.yourdomain.com`
- **Forward to:** `http://<lxc-ip>:3000`
- **Block common exploits:** on
- **Websockets Support:** **on** ← required for the `/api/scan/stream` SSE feed
- **SSL:** request Let's Encrypt cert + force SSL

Then update `.env` on the LXC:

```
NEXTAUTH_URL=https://singscanner.yourdomain.com
```

…and restart: `sudo systemctl restart singscanner`.

## Ongoing deploys

After pushing to `main` from your dev machine:

```bash
ssh root@<lxc-ip>          # or whichever account has sudo
sudo -u singscanner /opt/singscanner/scripts/deploy.sh
```

`deploy.sh` will:

- refuse to run with uncommitted changes
- `git pull` and log advanced commits
- only `npm ci` when `package-lock.json` shifted
- `prisma generate` when `prisma/schema.prisma` shifted
- always `prisma migrate deploy` (no-op when up to date)
- rebuild, restart, and smoke-test `/api/status`

Overrides: `REPO_DIR`, `SERVICE_NAME`, `BRANCH`.

## Useful one-liners

```bash
systemctl status singscanner                 # current state
journalctl -u singscanner -f                 # tail logs
journalctl -u singscanner -n 200 --no-pager  # last 200 lines

# Browse the DB from your laptop (SSH tunnel):
ssh -L 5555:127.0.0.1:5432 root@<lxc-ip>
# then on your laptop:
DATABASE_URL="postgresql://singscanner:<pass>@127.0.0.1:5555/singscanner" npx prisma studio
```

## Files in this directory

- `init-lxc.sh` — first-time bootstrap (run as root, once).
- `deploy.sh` — ongoing deploys (run as `singscanner`).
- `singscanner.service` — the systemd unit installed by `init-lxc.sh`.
