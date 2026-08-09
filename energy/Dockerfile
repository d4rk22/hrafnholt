FROM python:3.14-alpine@sha256:a1321512d6a287428c50dcdf2ab3857761127e03a23b1f648e9c1c0de59288f8

ARG RAVENHILL_VERSION=0.1.0-dev
ARG RAVENHILL_REVISION=unknown
ARG RAVENHILL_SOURCE=https://github.com/d4rk22/ravenhill
LABEL org.opencontainers.image.title="Ravenhill energy sidecar" \
      org.opencontainers.image.description="Optional energy collector for Ravenhill" \
      org.opencontainers.image.version="${RAVENHILL_VERSION}" \
      org.opencontainers.image.revision="${RAVENHILL_REVISION}" \
      org.opencontainers.image.source="${RAVENHILL_SOURCE}" \
      org.opencontainers.image.licenses="Apache-2.0"

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    ENERGY_PORT=8080 \
    RAVENHILL_CONFIG=/etc/ravenhill/ravenhill.yml
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
COPY LICENSE NOTICE /usr/share/licenses/ravenhill/
RUN addgroup -S -g 10001 ravenhill-energy \
    && adduser -S -D -H -u 10001 -G ravenhill-energy ravenhill-energy
USER ravenhill-energy
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8080/health', timeout=3)"
CMD ["python", "app.py"]
