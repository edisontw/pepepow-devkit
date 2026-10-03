#!/usr/bin/env bash
set -euo pipefail

echo '== host =='
hostname
uname -a
if command -v lsb_release >/dev/null 2>&1; then lsb_release -ds; fi

echo '== resources =='
free -h || true
df -h / || true

echo '== node =='
if command -v node >/dev/null 2>&1; then node --version; else echo 'node: MISSING'; fi
if command -v npm >/dev/null 2>&1; then npm --version; else echo 'npm: MISSING'; fi

echo '== apache =='
if command -v apache2ctl >/dev/null 2>&1; then
  apache2ctl -t
  apache2ctl -M 2>/dev/null | grep -E 'proxy(_http)?_module' || true
else
  echo 'apache2ctl: MISSING'
fi

echo '== candidate localhost ports =='
ss -ltnp | grep -E ':(8790|8791)\b' || echo '8790/8791 free'

echo '== existing PEPEW processes =='
ps -eo pid,comm,args | grep -E 'PEPEPOW|apache2|node' | grep -v grep | head -n 40 || true
