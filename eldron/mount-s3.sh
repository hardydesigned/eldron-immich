#!/bin/bash
set -euo pipefail

# /mnt/s3 = Bucket (strikt nur lesend) + lokaler Ordner für die XMP-Sidecars, die Immich neben die Originale schreibt.
mkdir -p /mnt/s3 /sc-data/sidecars
export RCLONE_CONFIG_MEDIA_TYPE=union
export RCLONE_CONFIG_MEDIA_UPSTREAMS="hetzner:${S3_BUCKET}:ro /sc-data/sidecars"
export RCLONE_CONFIG_MEDIA_CREATE_POLICY=ff
export RCLONE_CONFIG_MEDIA_ACTION_POLICY=all
export RCLONE_CONFIG_MEDIA_SEARCH_POLICY=ff
rclone mount media: /mnt/s3 \
	--daemon \
	--allow-other \
	--dir-cache-time 1m \
	--vfs-cache-mode writes \
	--log-file /tmp/rclone.log

node /sc/bridge.ts &
/sc/loop.sh &

exec start.sh
