# PepewPay Production Deployment

PepewPay is built in GitHub Actions. The production chain host does not need Node.js.

## Generated artifact branch

A successful `main` CI run publishes static files to:

```text
pepewpay-dist
```

The branch contains only deployable files plus:

```text
DEPLOYMENT.txt
```

which records the source commit used for the build.

## Current production target

Initial rollout:

```text
https://light.pepepow.net/pay/
```

Static filesystem path:

```text
/var/www/pay
```

Nginx configuration is maintained in:

```text
edisontw/pepepow-electrumx-service/deploy/nginx/pepew-light
```

## Production repository authentication

`pepepow-devkit` is private. Production should use a dedicated, repository-scoped,
read-only SSH deploy key rather than a long-lived PAT or account password.

Generate the key on the production host so the private key never leaves the host:

```bash
install -d -m 0700 ~/.ssh

ssh-keygen -t ed25519 \
  -f ~/.ssh/pepepow-devkit-deploy \
  -C "pepewpay production deploy key" \
  -N ""

chmod 600 ~/.ssh/pepepow-devkit-deploy
chmod 644 ~/.ssh/pepepow-devkit-deploy.pub

cat ~/.ssh/pepepow-devkit-deploy.pub
```

Add only the public key to GitHub:

```text
edisontw/pepepow-devkit
  -> Settings
  -> Deploy keys
  -> Add deploy key
  -> Allow write access: OFF
```

Use a dedicated SSH host alias so this key is not selected for unrelated GitHub
repositories:

```sshconfig
Host github-pepepow-devkit
    HostName github.com
    User git
    IdentityFile ~/.ssh/pepepow-devkit-deploy
    IdentitiesOnly yes
```

Before first use, verify GitHub's SSH host fingerprint against the current official
GitHub documentation, then add the verified host key to `~/.ssh/known_hosts`.

Test the repository-scoped credential:

```bash
ssh -T github-pepepow-devkit
```

GitHub normally reports successful authentication while denying shell access.

## Deploy on production host

```bash
rm -rf /tmp/pepewpay-dist

git clone --depth 1 --branch pepewpay-dist \
  git@github-pepepow-devkit:edisontw/pepepow-devkit.git \
  /tmp/pepewpay-dist

cat /tmp/pepewpay-dist/DEPLOYMENT.txt

sudo rm -rf /var/www/pay.new
sudo install -d -m 0755 /var/www/pay.new
sudo cp -a /tmp/pepewpay-dist/. /var/www/pay.new/
sudo rm -rf /var/www/pay.new/.git
sudo chown -R root:root /var/www/pay.new
sudo find /var/www/pay.new -type d -exec chmod 0755 {} +
sudo find /var/www/pay.new -type f -exec chmod 0644 {} +

sudo rm -rf /var/www/pay.previous
if [ -d /var/www/pay ]; then
  sudo mv /var/www/pay /var/www/pay.previous
fi
sudo mv /var/www/pay.new /var/www/pay
```

Then update/reload Nginx from the service repository:

```bash
cd /home/ubuntu/pepepow-electrumx-service

git pull --ff-only

sudo cp deploy/nginx/pepew-light /etc/nginx/sites-available/pepew-light
sudo ln -sfn /etc/nginx/sites-available/pepew-light /etc/nginx/sites-enabled/pepew-light

sudo nginx -t
sudo systemctl reload nginx
```

## Verify

```bash
curl -I https://light.pepepow.net/pay/
curl -I https://light.pepepow.net/pay/sw.js
curl -s https://light.pepepow.net/pay/ | head
```

For persisted status E2E, open:

```text
https://light.pepepow.net/pay/?payment_id=pay_<high-entropy-id>
```

Expected behavior:

- persisted address/amount fields are read-only
- QR contains the canonical `pepew:` URI
- wallet handoff uses public address/amount only
- status polling uses `GET /api/v1/payments/{payment_id}`
- no merchant API key exists in the browser
- paid transactions advance through persisted watcher state

## Rollback

The frontend is static and independent of the backend process.

To temporarily remove the production UI without affecting Payment API/watcher state:

```bash
sudo mv /var/www/pay /var/www/pay.disabled
sudo systemctl reload nginx
```

For a version rollback, deploy an earlier `pepewpay-dist` branch commit or a saved copy of `/var/www/pay`.

Do not install Node.js on the production host solely for PepewPay.
