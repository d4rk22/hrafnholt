FROM python:3.13-alpine@sha256:399babc8b49529dabfd9c922f2b5eea81d611e4512e3ed250d75bd2e7683f4b0

ARG HRAFNHOLT_VERSION=0.1.1-dev
ARG HRAFNHOLT_REVISION=unknown
ARG HRAFNHOLT_SOURCE=https://github.com/d4rk22/hrafnholt
LABEL org.opencontainers.image.title="Hrafnholt energy sidecar" \
      org.opencontainers.image.description="Optional energy collector for Hrafnholt" \
      org.opencontainers.image.version="${HRAFNHOLT_VERSION}" \
      org.opencontainers.image.revision="${HRAFNHOLT_REVISION}" \
      org.opencontainers.image.source="${HRAFNHOLT_SOURCE}" \
      org.opencontainers.image.licenses="Apache-2.0"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ENERGY_PORT=8080 \
    HRAFNHOLT_CONFIG=/etc/hrafnholt/hrafnholt.yml
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && rm -rf \
      /usr/local/lib/python3.13/ensurepip \
      /usr/local/lib/python3.13/idlelib \
      /usr/local/lib/python3.13/site-packages/pip \
      /usr/local/lib/python3.13/site-packages/pip-*.dist-info \
    && rm -f \
      /usr/local/bin/idle \
      /usr/local/bin/idle3 \
      /usr/local/bin/idle3.13 \
      /usr/local/bin/pip \
      /usr/local/bin/pip3 \
      /usr/local/bin/pip3.13
COPY app.py ./
COPY LICENSE NOTICE /usr/share/licenses/hrafnholt/
RUN addgroup -S -g 10001 hrafnholt-energy \
    && adduser -S -D -H -u 10001 -G hrafnholt-energy hrafnholt-energy
USER hrafnholt-energy
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3)"
CMD ["python", "app.py"]
