# syntax=docker/dockerfile:1

# Caddy image official ไม่มี DNS provider ของ DuckDNS ติดมาด้วย ต้อง build เองด้วย xcaddy
# เพื่อให้ขอใบรับรอง HTTPS แบบ DNS-01 ได้ (ดูเหตุผลใน Caddyfile)
FROM caddy:2-builder-alpine AS builder
RUN xcaddy build --with github.com/caddy-dns/duckdns

FROM caddy:2-alpine
COPY --from=builder /usr/bin/caddy /usr/bin/caddy
