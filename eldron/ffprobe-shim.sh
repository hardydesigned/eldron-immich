#!/bin/bash
# Immich 3.2 liest für den Keyframe-Index jedes Video komplett (ffprobe packet=...). Über einen S3-Mount heißt das:
# ganze Datei herunterladen. Der Index wird nur für Echtzeit-Transcoding gebraucht (hier aus) – für /mnt/s3 liefern wir ihn leer.
for arg in "$@"; do
	if [[ "$arg" == packet=* && "${!#}" == /mnt/s3/* ]]; then exit 0; fi
done
exec /usr/bin/ffprobe "$@"
