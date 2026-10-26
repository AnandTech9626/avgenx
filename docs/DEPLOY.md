# Deploying AVGENX Academy

## What the app needs

* **One always-on Node.js process** (Node 22.5 or newer) with a **persistent disk** for two files: the account database (`data/avgenx.db`) and the Excel account list (`accounts.xlsx`).
* **HTTPS** in front of it.
* Run **one copy** of the server. Do not use PM2 cluster mode or several replicas: the sign-in limits and the Excel file watcher assume a single process. One process comfortably serves the numbers below.

Netlify and Vercel cannot host it as it is (no persistent disk, no long-running process). See the end of this file.

## How many people at once

Each person signs in on their own device and gets their own session, verified by the server on every request. Two people on two devices never see or affect each other, whatever their roles.

Measured with `node scripts/load-test.mjs 100 2` (two rounds of 100 people acting at the same instant, on a 2-CPU machine): every person got their own sign-in page, signed in with their own ID, loaded the app and was identified correctly; a third signed out mid-run without affecting anyone else; **0 errors**. Pages are compressed (the app is 240 KB instead of 917 KB). The slowest step is signing in, because password checking is deliberately expensive: if 100 people press "Sign in" in the same second, the last waits about 2.5 s. In normal use (people arriving over a few minutes) it is well under a second.

| People using it at once | Server size |
|---|---|
| Up to about 100 | 1 vCPU, 1 GB RAM |
| 100 to 300 | 2 vCPU, 2 GB RAM |
| More | Move accounts to PostgreSQL and run several copies behind a load balancer (planned work) |

**Shared computers.** Sessions live in the browser's cookies, so two people using the *same browser on the same computer* share one session: the second person sees the first one's account until they sign out. On lab PCs: always use **Sign out**, close the browser at the end (the session cookie ends with it), and set `SESSION_IDLE_MINUTES` low (for example 30 to 120). To test two roles on one computer, use a normal window and a private window, or two browser profiles.

## Option A: a small Linux server (recommended)

Any VPS works: DigitalOcean, AWS Lightsail, Hetzner, Azure, Google Cloud. Ubuntu 24.04 is assumed.

**1. Create the server and point your domain at it.** Create an A record such as `lms.yourdomain.com` with the server's IP address.

**2. Install Node 22 and Caddy.**
```bash
sudo apt update && sudo apt -y upgrade
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt update && sudo apt install -y caddy
node -v   # must be v22.5 or newer
```

**3. Upload the app.** Copy the project folder (without `node_modules`) to `/opt/avgenx-academy` with WinSCP, or `git clone` it there. Then:
```bash
sudo useradd --system --home /opt/avgenx-academy avgenx
cd /opt/avgenx-academy
sudo npm ci
sudo npm run build
sudo mkdir -p data backups
sudo chown -R avgenx:avgenx /opt/avgenx-academy
```

**4. Put your account list in place.** Upload your real `accounts.xlsx` to `/opt/avgenx-academy/accounts.xlsx`, with at least one active Super Administrator row and real people instead of the starter rows. Then `sudo chown avgenx:avgenx /opt/avgenx-academy/accounts.xlsx && sudo chmod 640 /opt/avgenx-academy/accounts.xlsx`.

**5. Configure and start the service.**
```bash
sudo cp deploy/avgenx.env.example /etc/avgenx.env
sudo nano /etc/avgenx.env          # check the values
sudo chown root:avgenx /etc/avgenx.env && sudo chmod 640 /etc/avgenx.env
sudo cp deploy/avgenx.service /etc/systemd/system/avgenx.service
sudo systemctl daemon-reload
sudo systemctl enable --now avgenx
sudo journalctl -u avgenx -f      # you should see "AVGENX Academy server v..." and "is running"
```

**6. Turn on HTTPS.**
```bash
sudo cp deploy/Caddyfile /etc/caddy/Caddyfile
sudo nano /etc/caddy/Caddyfile     # replace lms.yourdomain.com with your domain
sudo systemctl reload caddy
```
Open `https://lms.yourdomain.com`. You should see the sign-in page.

**7. Firewall.** Allow only SSH and web traffic:
```bash
sudo ufw allow OpenSSH && sudo ufw allow 80 && sudo ufw allow 443 && sudo ufw enable
```

**8. Backups.** Add a daily backup at 02:30:
```bash
sudo crontab -u avgenx -e
# add this line:
30 2 * * * cd /opt/avgenx-academy && /usr/bin/node --disable-warning=ExperimentalWarning server/cli.mjs backup --dir /opt/avgenx-academy/backups
```
Copy the `backups` folder off the server regularly (for example weekly with WinSCP). It contains password hashes, the Excel file shows passwords, so keep the copies private.

### Day-to-day

* **Change who can sign in:** download `accounts.xlsx` with WinSCP, edit it in Excel, upload it back. The server applies it within seconds; the Sync result column shows OK or the problem per row.
* **See logs:** `sudo journalctl -u avgenx -n 100`
* **Update the app:** upload the new version (keep `data/`, `backups/` and `accounts.xlsx`), then `cd /opt/avgenx-academy && sudo npm ci && sudo npm run build && sudo chown -R avgenx:avgenx . && sudo systemctl restart avgenx`. Restarting signs everyone out (set `KEEP_SESSIONS=true` in `/etc/avgenx.env` to avoid that).

## Option B: your own Windows PC with Cloudflare Tunnel (for a demo)

Good for showing it to a few people for a day. Your PC must stay on with both windows open.

```powershell
winget install --id Cloudflare.cloudflared
cd C:\path\to\avgenx-academy
npm run build
$env:NODE_ENV="production"; $env:TRUST_PROXY="true"; $env:HOST="127.0.0.1"; npm start
```
In a second PowerShell window:
```powershell
cloudflared tunnel --url http://localhost:8080
```
Share the `https://....trycloudflare.com` address it prints. It changes every time you restart the tunnel; a fixed address needs a free Cloudflare account and a domain.

## Option C: Render, Railway or Fly.io (Docker)

Connect the repository; the platform builds the included `Dockerfile` (not yet built in our test environment, so watch the first build). Add a **persistent volume mounted at `/data`**, set `TRUST_PROXY=true`, and keep the service at **one instance**. Put `accounts.xlsx` on the volume at `/data/accounts.xlsx` using the platform's shell or file tools; editing it later works the same way, which is less convenient than Option A.

## Why not Netlify or Vercel

They run code as short-lived functions with no disk that survives, so the database, the Excel file and the file watcher cannot live there. You can either put only the static preview (`dist/preview.html`, sample data, no real sign-in) on Netlify, or keep a Netlify address in front of a real server with a `_redirects` rule such as `/*  https://your-server.example.com/:splat  200`.

## Checklist before real people use it

* Real people in `accounts.xlsx`, starter rows removed, at least one active Super Administrator.
* `NODE_ENV=production`, HTTPS working, `TRUST_PROXY=true` behind Caddy or a platform proxy.
* `accounts.xlsx`, `/etc/avgenx.env` and `data/` readable only by administrators.
* Daily backups running and copied off the server.
* Remember: learning records (courses, submissions, grades) are still sample data in each browser. Sign-in and accounts are real and shared; a mentor's grading is not yet visible to the student. Moving those records to the server is the next piece of work.
