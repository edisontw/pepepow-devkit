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

## Deploy on production host

```bash
rm -rf /tmp/pepewpay-dist

git clone --depth 1 --branch pepewpay-dist \
  https://github.com/edisontw/pepepow-devkit.git \
  /tmp/pepewpay-dist

cat /tmp/pepewpay-dist/DEPLOYMENT.txt

sudo install -d -m 0755 /var/www/pay
sudo rm -rf /var/www/pay/*
sudo cp -a /tmp/pepewpay-dist/. /var/www/pay/
sudo rm -rf /var/www/pay/.git
sudo chown -R root:root /var/www/pay
sudo find /var/www/pay -type d -exec chmod 0755 {} +
sudo find /var/www/pay -type f -exec chmod 0644 {} +
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
