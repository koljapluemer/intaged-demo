# Deployment

These steps deploy theadoc once, to a DigitalOcean droplet running Ubuntu 26.04 LTS. Docker Compose runs the app, and Caddy serves it with automatic HTTPS.

The examples use the names `demo.example.com` and `sync.demo.example.com`, the user `deploy`, and the IP `203.0.113.10`. Replace them with your own values.

## Before you start

- A domain whose DNS records you can edit.
- An SSH key on your machine (`ssh-keygen -t ed25519` if you have none). Upload the public key in the DigitalOcean control panel under **Settings → Security → SSH keys**.
- An OpenRouter inference key with a fixed spending limit and no reset ($10 is plenty for a demo). See [README.md](README.md#openrouter-budget).

## 1. Create the droplet

In the control panel, choose **Create → Droplets** and set:

- **Image:** Ubuntu 26.04 (LTS) x64
- **Size:** Basic, Regular, 2 GB RAM / 1 vCPU ($12/mo). The 1 GB size runs out of memory while the image builds.
- **Authentication:** SSH key (pick the key you uploaded)
- **Backups:** enable daily backups (+30%, $3.60/mo)
- **Monitoring:** keep it enabled

Write down the droplet's public IPv4 address.

## 2. Create the firewall

Use DigitalOcean's Cloud Firewall instead of UFW. Docker writes its own iptables rules, so traffic to published ports bypasses UFW. The Cloud Firewall filters traffic before it reaches the droplet.

Choose **Create → Cloud Firewalls**, name the firewall `theadoc`, and set these inbound rules:

| Type   | Protocol | Port |
|--------|----------|------|
| SSH    | TCP      | 22   |
| HTTP   | TCP      | 80   |
| HTTPS  | TCP      | 443  |
| Custom | UDP      | 443  |

UDP 443 is for HTTP/3. Keep the default outbound rules (all traffic allowed). The app needs outbound access to OpenRouter and npm. Under **Apply to Droplets**, select the droplet.

## 3. Point DNS at the droplet

At your DNS provider, create two A records:

```
demo.example.com       A  203.0.113.10
sync.demo.example.com  A  203.0.113.10
```

## 4. Prepare the server

Log in as root:

```sh
ssh root@203.0.113.10
```

Update the system and create the deploy user. `adduser` asks you for a password, which `sudo` will use:

```sh
apt update && apt full-upgrade -y
adduser deploy
usermod -aG sudo deploy
rsync --archive --chown=deploy:deploy ~/.ssh /home/deploy
```

Disable root login and password login. Name the file `00-…`: sshd uses the first value it reads, so this file takes precedence over the `50-cloud-init.conf` that the image ships with.

```sh
cat > /etc/ssh/sshd_config.d/00-hardening.conf <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
EOF
sshd -t && systemctl restart ssh
sshd -T | grep -E '^(permitrootlogin|passwordauthentication|kbdinteractiveauthentication) '
```

All three values should print `no`. Keep this root session open. In a **second terminal**, confirm that the new user can log in and use sudo:

```sh
ssh deploy@203.0.113.10
sudo whoami   # prints: root
```

When that works, close the root session. Run all remaining steps as `deploy`.

Add swap so that memory peaks during the build don't kill it. DigitalOcean droplets have no swap by default.

```sh
sudo fallocate -l 2G /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

Ubuntu installs security updates automatically. Also let it reboot at night when an update needs a reboot. The containers start again on their own after a reboot.

```sh
sudo tee /etc/apt/apt.conf.d/52unattended-upgrades-reboot <<'EOF'
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "04:00";
EOF
```

## 5. Install Docker and just

Install Docker Engine from Docker's own apt repository, not from Ubuntu's `docker.io` package:

```sh
sudo apt install -y ca-certificates curl
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $(. /etc/os-release && echo "${UBUNTU_CODENAME:-$VERSION_CODENAME}")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin just
```

Docker's default log driver never rotates logs, so they eventually fill the disk. Switch to the `local` driver, which rotates them:

```sh
echo '{ "log-driver": "local" }' | sudo tee /etc/docker/daemon.json
sudo systemctl restart docker
```

Let `deploy` run Docker without sudo. Membership in the `docker` group is equivalent to root access. Log out and back in so the group change takes effect:

```sh
sudo usermod -aG docker deploy
exit
```

```sh
ssh deploy@203.0.113.10
docker run --rm hello-world
```

## 6. Configure the app

```sh
git clone https://github.com/koljapluemer/theadoc.git
cd theadoc/web-demo
mkdir -p data
sudo chown 1000:1000 data   # the container runs as UID 1000
```

Write `.env`:

```sh
cat > .env <<'EOF'
APP_DOMAIN=demo.example.com
SYNC_DOMAIN=sync.demo.example.com
VITE_SYNC_URL=wss://sync.demo.example.com
ACME_EMAIL=you@example.com
GOOGLE_GENERATIVE_AI_API_KEY=
GOOGLE_GENERATIVE_AI_MODEL=gemini-3.7-flash
OPENROUTER_API_KEY=sk-or-v1-...
OPENROUTER_MODEL=openai/gpt-5.6-terra
EOF
echo "ADMIN_TOKEN=$(openssl rand -hex 32)" >> .env
chmod 600 .env
```

Leave the scheme off the domains. A bare name makes Caddy obtain a Let's Encrypt certificate.

## 7. Start the app

Check that both names resolve to the droplet, and wait if they don't yet:

```sh
getent hosts demo.example.com sync.demo.example.com
```

Then build and start:

```sh
just up
```

The first build takes a few minutes. Then check that it worked:

```sh
docker compose ps                                   # theadoc should show (healthy)
curl -fsS https://demo.example.com/api/health       # {"ok":true,...}
curl -fsS https://sync.demo.example.com/            # theadoc sync is running
```

Unlock document creation in your own browser. Print the admin link:

```sh
echo "https://demo.example.com/admin#$(grep '^ADMIN_TOKEN=' .env | cut -d= -f2)"
```

Open that link once in each browser you create documents from. The "New document" buttons then appear. Keep the link private: anyone who has it can create documents. Anyone who has a document's URL can edit that document and generate widgets in it, and there is no index of documents. See [README.md](README.md#access) for details.

If HTTPS fails, read Caddy's log with `docker compose logs caddy`. The usual causes are DNS records that haven't propagated yet, or a firewall rule for port 80 or 443 that is missing.

## Operating it

Logs:

```sh
just logs
```

Generation run logs are also appended to `data/runs/<UTC date>.jsonl`. To copy them into your local checkout, set `THEADOC_SSH=deploy@203.0.113.10` in your local `.env` and run `just pull-runs` there (see [README.md](README.md#measuring-and-choosing-a-model)).

Deploy a new version:

```sh
cd ~/theadoc/web-demo
git pull --ff-only
just up
docker image prune -f
```

To roll back, run `git checkout <previous-commit>`, then `just up`.

To rotate the admin token, replace `ADMIN_TOKEN` in `.env`, run `just up`, and open the new admin link.

Never run `docker compose down -v`. It deletes Caddy's certificates. Never delete `data/`, which holds every document and widget.

Backups: DigitalOcean's daily backups cover the whole disk, `data/` included. To restore, use **Droplet → Backups → Restore**.
